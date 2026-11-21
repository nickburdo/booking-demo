import { httpServerHandler } from "cloudflare:node";
import { env } from "cloudflare:workers";
import cors from "cors";
import express, { type ErrorRequestHandler } from "express";
import { cancelByToken, createReservation, getAvailability, getReservation } from "./booking";
import { clock } from "./clock";
import { HttpError } from "./errors";
import { notifyInBackground } from "./notify";
import type { TelegramConfig } from "./telegram";
import { verifyTurnstile } from "./turnstile";
import { availabilityQuery, parse, reservationBody } from "./validation";

// Secrets may be absent locally; notifications are then skipped (v3 plan, P3).
function telegramConfig(): TelegramConfig {
  return { botToken: env.TELEGRAM_BOT_TOKEN, chatId: env.TELEGRAM_CHAT_ID };
}

// Browser origins allowed to call the API (docs/api.md, ADR-015).
const ALLOWED_ORIGINS = ["https://booking-demo-web.nick-burdo.workers.dev", "http://localhost:3000"];

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
