import { httpServerHandler } from "cloudflare:node";
import { env } from "cloudflare:workers";
import cors from "cors";
import express, { type ErrorRequestHandler } from "express";
import { addDemoReservations, applyAction, listDay, type AdminAction } from "./admin";
import { login, logout, requireAdmin } from "./auth";
import { cancelByToken, createReservation, getAvailability, getReservation } from "./booking";
import { adminChatList, adminChatTranscript, chatHistory, replyToChat, startChat } from "./chat/service";
import { clock } from "./clock";
import { ALLOWED_ORIGINS } from "./config";
import { HttpError } from "./errors";
import { handoffInBackground, notifyInBackground } from "./notify";
import type { TelegramConfig } from "./telegram";
import { verifyTurnstile } from "./turnstile";
import {
  adminCancelBody,
  adminChatsQuery,
  adminDayQuery,
  availabilityQuery,
  chatMessageBody,
  chatStartBody,
  loginBody,
  parse,
  reservationBody,
} from "./validation";

// Secrets may be absent locally; notifications are then skipped (v3 plan, P3).
function telegramConfig(): TelegramConfig {
  return { botToken: env.TELEGRAM_BOT_TOKEN, chatId: env.TELEGRAM_CHAT_ID };
}


const app = express();

app.use(cors({ origin: ALLOWED_ORIGINS }));
app.use(express.json({ limit: "10kb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/availability", async (req, res) => {
  const { date, guests } = parse(availabilityQuery, req.query);
  const times = await getAvailability(env.DB, date, guests, clock.now());
  res.json({ date, guests, times });
});

app.post("/reservations", async (req, res) => {
  // Cloudflare always sets CF-Connecting-IP in production. Only local/test calls may lack
  // it; they share the "unknown" bucket, which is acceptable there (v2 plan, R1.2).
  const key = req.get("cf-connecting-ip") ?? "unknown";
  const { success } = await env.CREATE_LIMITER.limit({ key });
  if (!success) {
    throw new HttpError(429, "RATE_LIMITED", "Too many booking requests. Try again in a minute.");
  }
  const { turnstileToken, ...input } = parse(reservationBody, req.body ?? {});

  // Bot check after validation, so a single-use token is spent only on a valid request (ADR-019).
  if (!turnstileToken) {
    throw new HttpError(400, "VERIFICATION_FAILED", "Bot check token is missing.");
  }
  const verdict = await verifyTurnstile(env.TURNSTILE_SECRET, turnstileToken, req.get("cf-connecting-ip"));
  if (verdict === "failed") {
    throw new HttpError(400, "VERIFICATION_FAILED", "Bot check failed or expired. Try again.");
  }
  if (verdict === "unavailable") {
    throw new HttpError(503, "VERIFICATION_UNAVAILABLE", "Bot check is unavailable. Try again later.");
  }

  const { reservation, token, row } = await createReservation(env.DB, input, clock.now());
  notifyInBackground(env.DB, telegramConfig(), "created", row, clock.now);
  res.status(201).json({ reservation, token });
});

app.get("/reservations/:token", async (req, res) => {
  res.json({ reservation: await getReservation(env.DB, req.params.token) });
});

app.post("/reservations/:token/cancel", async (req, res) => {
  const { reservation, row } = await cancelByToken(env.DB, req.params.token, clock.now());
  notifyInBackground(env.DB, telegramConfig(), "cancelled", row, clock.now);
  res.json({ reservation });
});

// --- Chat (v5): docs/api.md → Chat, ADR-023/024 --------------------------------------------

async function limitChat(ip: string | undefined): Promise<void> {
  const { success } = await env.CHAT_LIMITER.limit({ key: ip ?? "unknown" });
  if (!success) throw new HttpError(429, "RATE_LIMITED", "Too many chat messages. Try again in a minute.");
}

/** The site the reservation link points to: the calling allowed origin, else the live site. */
function siteUrl(origin: string | undefined): string {
  return origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]!;
}

function chatToken(header: string | undefined): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec(header ?? "");
  return match ? match[1]! : null;
}

app.post("/chat/sessions", async (req, res) => {
  await limitChat(req.get("cf-connecting-ip"));
  const { turnstileToken, locale, engine } = parse(chatStartBody, req.body ?? {});
  // One bot check per conversation; it also covers bookings made in it (ADR-023).
  const verdict = await verifyTurnstile(env.TURNSTILE_SECRET, turnstileToken, req.get("cf-connecting-ip"));
  if (verdict === "failed") throw new HttpError(400, "VERIFICATION_FAILED", "Bot check failed or expired. Try again.");
  if (verdict === "unavailable") throw new HttpError(503, "VERIFICATION_UNAVAILABLE", "Bot check is unavailable. Try again later.");
  res.status(201).json(await startChat(env.DB, locale, siteUrl(req.get("origin")), clock.now(), engine));
});

app.post("/chat/sessions/current/messages", async (req, res) => {
  await limitChat(req.get("cf-connecting-ip"));
  const input = parse(chatMessageBody, req.body ?? {});
  const { turn, effects } = await replyToChat(env.DB, chatToken(req.get("authorization")), input, siteUrl(req.get("origin")), clock.now());
  // Same notifications as the form and the guest page (ADR-018); a person hand-off (v5 plan, P7).
  if (effects.booked) notifyInBackground(env.DB, telegramConfig(), "created", effects.booked, clock.now);
  if (effects.cancelled) notifyInBackground(env.DB, telegramConfig(), "cancelled", effects.cancelled, clock.now);
  if (effects.person) handoffInBackground(telegramConfig(), effects.person);
  res.json({ turn });
});

app.get("/chat/sessions/current", async (req, res) => {
  res.json(await chatHistory(env.DB, chatToken(req.get("authorization")), clock.now()));
});

// --- Admin (v4): docs/api.md → Admin, ADR-020…022 -----------------------------------------

/** Login and demo data share one per-IP limiter (v4 plan, P3); prefixes keep the counts apart. */
async function limitAdmin(kind: string, ip: string | undefined): Promise<void> {
  const { success } = await env.LOGIN_LIMITER.limit({ key: `${kind}:${ip ?? "unknown"}` });
  if (!success) throw new HttpError(429, "RATE_LIMITED", "Too many attempts. Try again in a minute.");
}

app.post("/admin/login", async (req, res) => {
  await limitAdmin("login", req.get("cf-connecting-ip"));
  const { username, password } = parse(loginBody, req.body ?? {});
  const account = { username: env.ADMIN_USERNAME, password: env.ADMIN_PASSWORD };
  res.json(await login(env.DB, account, username, password, clock.now()));
});

const admin = express.Router();
admin.use(requireAdmin(() => env.DB, () => clock.now()));

admin.post("/logout", async (_req, res) => {
  await logout(env.DB, res.locals.sessionHash);
  res.json({ ok: true });
});

admin.get("/reservations", async (req, res) => {
  const { date } = parse(adminDayQuery, req.query);
  res.json({ date, reservations: await listDay(env.DB, date) });
});

for (const action of ["confirm", "cancel", "no-show"] as AdminAction[]) {
  admin.post(`/reservations/:id/${action}`, async (req, res) => {
    const reason = action === "cancel" ? parse(adminCancelBody, req.body ?? {}).reason : null;
    // No Telegram for admin actions: demo visitors would spam the owner's chat (ADR-021).
    res.json({ reservation: await applyAction(env.DB, req.params.id, action, clock.now(), reason) });
  });
}

admin.post("/demo-reservations", async (req, res) => {
  await limitAdmin("demo", req.get("cf-connecting-ip"));
  res.status(201).json({ created: await addDemoReservations(env.DB, clock.now()) });
});

admin.get("/chats", async (req, res) => {
  const { engine } = parse(adminChatsQuery, req.query);
  res.json({ chats: await adminChatList(env.DB, clock.now(), engine) });
});

admin.get("/chats/:id", async (req, res) => {
  res.json(await adminChatTranscript(env.DB, req.params.id));
});

app.use("/admin", admin);

app.use((_req, _res, next) => {
  next(new HttpError(404, "NOT_FOUND", "Route not found."));
});

// Every error becomes the JSON shape documented in docs/api.md; no internals leak.
const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof HttpError) {
    res.status(error.status).json({
      error: {
        code: error.code,
        message: error.message,
        ...(error.fields && Object.keys(error.fields).length > 0 ? { fields: error.fields } : {}),
      },
    });
    return;
  }
  // Body errors from express.json() (http-errors with a client status), v2 plan R1.1.
  if (error?.type === "entity.parse.failed") {
    res.status(400).json({ error: { code: "VALIDATION", message: "Body is not valid JSON." } });
    return;
  }
  if (error?.type === "entity.too.large") {
    res.status(413).json({
      error: { code: "PAYLOAD_TOO_LARGE", message: "Request body is larger than 10 KB." },
    });
    return;
  }
  const status = Number(error?.status ?? error?.statusCode);
  if (status >= 400 && status < 500) {
    res.status(400).json({ error: { code: "VALIDATION", message: "Request body could not be read." } });
    return;
  }
  console.error(error);
  res.status(500).json({ error: { code: "INTERNAL", message: "Something went wrong." } });
};
app.use(errorHandler);

app.listen(3000);
export default httpServerHandler({ port: 3000 });
