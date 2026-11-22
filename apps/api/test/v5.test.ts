// v5: scripted chat (ADR-023/024) — engine flows, endpoints, limits, admin transcripts.
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handle, start, tokenFromLink } from "../src/chat/engine";
import type { ChatContext, ChatServices, ChatState } from "../src/chat/types";
import { HttpError } from "../src/errors";
import { booking, call, clearReservations, NOW, pinClock, postJson, THURSDAY, waitFor } from "./helpers";
import { outbound } from "./outbound";

beforeEach(async () => {
  pinClock();
  await clearReservations();
  await env.DB.batch([env.DB.prepare("DELETE FROM chat_sessions"), env.DB.prepare("DELETE FROM admin_sessions")]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// --- HTTP helpers ----------------------------------------------------------------------------

async function startChat(locale = "en", ip?: string) {
  const res = await postJson("/chat/sessions", { turnstileToken: "XXXX.DUMMY.TOKEN.XXXX", locale }, ip);
  return { res, body: (await res.json()) as any };
}

async function say(token: string, body: unknown, ip?: string) {
  const res = await call("/chat/sessions/current/messages", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    ip,
  });
  return { res, body: (await res.json()) as any };
}

const ids = (turn: any) => (turn.input.options ?? []).map((o: any) => o.id);
const texts = (turn: any) => turn.messages.map((m: any) => m.text).join("\n");

async function adminToken(): Promise<string> {
  const res = await postJson("/admin/login", { username: "demo", password: "test-admin-password" });
  return ((await res.json()) as any).token;
}

/** Walks the booking flow up to the summary; returns the chat token and the last turn. */
async function toSummary(name = "Olena Kovalenko") {
  const { body } = await startChat();
  const token = body.token;
  await say(token, { choice: "book" });
  await say(token, { choice: `d:${THURSDAY}` });
  await say(token, { choice: "g:2" });
  await say(token, { choice: "t:12:00" });
  await say(token, { text: name });
  await say(token, { text: "067 123 45 67" });
  const summary = await say(token, { choice: "skip" });
  return { token, summary };
}

// --- Engine (no HTTP, fake services) ---------------------------------------------------------

function fakeServices(overrides: Partial<ChatServices> = {}): ChatServices {
  return {
    availability: async () => ["12:00", "12:30"],
    book: async () => {
      throw new Error("not expected");
    },
    find: async () => {
      throw new HttpError(404, "NOT_FOUND", "x");
    },
    cancel: async () => {
      throw new Error("not expected");
    },
    ...overrides,
  };
}

function ctx(services: ChatServices, locale: "en" | "ru" | "uk" = "en"): ChatContext {
  return { locale, now: NOW, siteUrl: "https://site.test", services };
}

describe("chat engine", () => {
  it("greets in the guest's language with the main menu", () => {
    const { turn } = start(ctx(fakeServices(), "uk"));
    expect(turn.messages[0]!.text).toContain("Вітаю");
    expect(turn.input).toMatchObject({ kind: "choices" });
    expect(ids(turn)).toEqual(["book", "find", "faq", "person"]);
  });

  it("offers a week of dates per page, then 'later dates', up to the 30-day horizon", async () => {
    let { state } = start(ctx(fakeServices()));
    let r = await handle(ctx(fakeServices()), state, { choice: "book" });
    expect(ids(r.turn).slice(0, 2)).toEqual(["d:2026-12-02", "d:2026-12-03"]);
    expect(r.turn.input.kind === "choices" && r.turn.input.options[0]!.label).toBe("Today");
    expect(ids(r.turn)).toContain("more");
    for (let page = 1; page <= 4; page++) r = await handle(ctx(fakeServices()), r.state, { choice: "more" });
    // page 4 covers days 28..30 only, and there is nothing later
    expect(ids(r.turn)).toEqual(["d:2026-12-30", "d:2026-12-31", "d:2027-01-01", "menu"]);
    state = r.state;
    expect(state.step).toMatchObject({ at: "book.date", page: 4 });
  });

  it("goes back to the dates when nothing is free for the party", async () => {
    const services = fakeServices({ availability: async () => [] });
    let r = await handle(ctx(services), start(ctx(services)).state, { choice: "book" });
    r = await handle(ctx(services), r.state, { choice: `d:${THURSDAY}` });
    r = await handle(ctx(services), r.state, { choice: "g:4" });
    expect(texts(r.turn)).toContain("no free times for 4 guests");
    expect(r.state.step.at).toBe("book.date");
  });

  it("offers the remaining times when the slot was taken during the chat", async () => {
    const services = fakeServices({
      availability: async () => ["13:00"],
      book: async () => {
        throw new HttpError(409, "SLOT_TAKEN", "x");
      },
    });
    const state: ChatState = {
      step: { at: "book.confirm", booking: { date: THURSDAY, guests: 2, time: "12:00", name: "Olena", phone: "+380671234567" }, comment: null },
      awaiting: { kind: "choices", options: [{ id: "confirm", label: "Confirm booking" }] },
      personSent: false,
    };
    const r = await handle(ctx(services), state, { choice: "confirm" });
    expect(texts(r.turn)).toContain("someone has just taken that time");
    expect(ids(r.turn)).toContain("t:13:00");
    expect(r.effects.booked).toBeUndefined();
  });

  it("reads the token from a pasted link or a bare token", () => {
    const token = "fL2o1pFoEFEQ9G-BpRRSEupi-5qyvrjLrK-A4uaXutM";
    expect(tokenFromLink(`https://booking-demo-web.nick-burdo.workers.dev/uk/reservation#${token}`)).toBe(token);
    expect(tokenFromLink(`  ${token} `)).toBe(token);
    expect(tokenFromLink("hello there")).toBeNull();
    expect(tokenFromLink("https://example.com/reservation#short")).toBeNull();
  });
});

// --- Endpoints -------------------------------------------------------------------------------

describe("starting a conversation", () => {
  it("checks Turnstile once and returns a token and the first turn", async () => {
    const { res, body } = await startChat("ru");
    expect(res.status).toBe(201);
    expect(body.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(body.turn.messages).toHaveLength(3);
    expect(body.turn.messages[0].text).toContain("Здравствуйте");
    expect(outbound.turnstileCalls).toHaveLength(1);
  });

  it("refuses a failed bot check and a bad locale", async () => {
    outbound.turnstile = "failed";
    expect((await startChat()).res.status).toBe(400);
    outbound.turnstile = "ok";
    expect((await startChat("de")).res.status).toBe(400);
  });

  it("deletes conversations older than 7 days when a new one starts", async () => {
    const old = new Date(NOW.getTime() - 8 * 86_400_000).toISOString();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO chat_sessions (id, token_hash, locale, state, created_at, updated_at) VALUES ('old', 'h-old', 'en', '{}', ?, ?)").bind(old, old),
      env.DB.prepare("INSERT INTO chat_messages (session_id, seq, sender, text, created_at) VALUES ('old', 0, 'bot', 'hi', ?)").bind(old),
    ]);
    await startChat();
    const left = await env.DB.prepare("SELECT (SELECT COUNT(*) FROM chat_sessions WHERE id = 'old') AS s, (SELECT COUNT(*) FROM chat_messages WHERE session_id = 'old') AS m").first<any>();
    expect(left).toEqual({ s: 0, m: 0 });
  });
});

describe("booking through the chat", () => {
  it("books with the same rules as the form, notifies the owner and returns the private link", async () => {
    const { token, summary } = await toSummary();
    expect(texts(summary.body.turn)).toContain("Olena Kovalenko, +380671234567");
    const done = await say(token, { choice: "confirm" });
    expect(done.res.status).toBe(200);
    expect(texts(done.body.turn)).toMatch(/https:\/\/booking-demo-web\.nick-burdo\.workers\.dev\/reservation#[A-Za-z0-9_-]{43}/);

    const row = await env.DB.prepare("SELECT date, start_time, guests, name, phone, status FROM reservations").first<any>();
    expect(row).toEqual({ date: THURSDAY, start_time: "12:00", guests: 2, name: "Olena Kovalenko", phone: "+380671234567", status: "pending" });
    await waitFor(async () => outbound.telegramCalls.some((c) => String(c.body.text).startsWith("🆕")));
    const session = await env.DB.prepare("SELECT outcome, reservation_id FROM chat_sessions").first<any>();
    expect(session.outcome).toBe("booked");
    expect(session.reservation_id).not.toBeNull();
  });

  it("asks again for a bad phone or an empty name", async () => {
    const { body } = await startChat();
    const token = body.token;
    for (const choice of ["book", `d:${THURSDAY}`, "g:2", "t:12:00"]) await say(token, { choice });
    expect(texts((await say(token, { text: "   " })).body.turn)).toContain("Please type a name");
    await say(token, { text: "Olena" });
    const bad = await say(token, { text: "12345" });
    expect(texts(bad.body.turn)).toContain("doesn't look like a phone number");
    expect(bad.body.turn.input).toMatchObject({ kind: "text", field: "phone" });
  });

  it("links to the site the chat was used on (local origin)", async () => {
    const { token } = await toSummary();
    const res = await call("/chat/sessions/current/messages", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}`, origin: "http://localhost:3000" },
      body: JSON.stringify({ choice: "confirm" }),
    });
    expect(texts(((await res.json()) as any).turn)).toContain("http://localhost:3000/reservation#");
  });

  it("books once when 'confirm' is sent twice at the same time", async () => {
    const { token } = await toSummary();
    const results = await Promise.all([say(token, { choice: "confirm" }), say(token, { choice: "confirm" })]);
    const statuses = results.map((r) => r.res.status).sort();
    expect(statuses[0]).toBe(200);
    expect([400, 409]).toContain(statuses[1]);
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM reservations").first<{ n: number }>();
    expect(count!.n).toBe(1);
  });
});

describe("finding and cancelling a booking", () => {
  it("shows a booking from its link and cancels it on request", async () => {
    const made = (await (await postJson("/reservations", booking({ time: "15:00" }))).json()) as any;
    const { body } = await startChat();
    const token = body.token;
    await say(token, { choice: "find" });
    expect(texts((await say(token, { text: "not a link" })).body.turn)).toContain("doesn't look like a booking link");
    expect(texts((await say(token, { text: "https://x/reservation#AAAAAAAAAAAAAAAAAAAAAAAA" })).body.turn)).toContain("couldn't find");

    const found = await say(token, { text: `https://booking-demo-web.nick-burdo.workers.dev/reservation#${made.token}` });
    expect(texts(found.body.turn)).toContain("waiting for the café to confirm");
    expect(ids(found.body.turn)).toEqual(["cancel", "menu"]);
    await say(token, { choice: "cancel" });
    const cancelled = await say(token, { choice: "yes" });
    expect(texts(cancelled.body.turn)).toContain("The booking is cancelled");
    const status = await env.DB.prepare("SELECT status, cancelled_by FROM reservations").first<any>();
    expect(status).toEqual({ status: "cancelled", cancelled_by: "guest" });
    await waitFor(async () => outbound.telegramCalls.some((c) => String(c.body.text).startsWith("❌")));
  });
});

describe("questions and a person", () => {
  it("answers hours, address and menu from the shared café data", async () => {
    const { body } = await startChat();
    await say(body.token, { choice: "faq" });
    expect(texts((await say(body.token, { choice: "hours" })).body.turn)).toContain("Mon–Fri: 08:00–21:00");
    expect(texts((await say(body.token, { choice: "address" })).body.turn)).toContain("7 Lypova Alley");
    expect(texts((await say(body.token, { choice: "menuItems" })).body.turn)).toContain("Espresso — 55");
    const session = await env.DB.prepare("SELECT outcome FROM chat_sessions").first<any>();
    expect(session.outcome).toBe("questions");
  });

  it("passes a question to the owner once per conversation", async () => {
    const { body } = await startChat();
    const token = body.token;
    await say(token, { choice: "person" });
    await say(token, { text: "Can I bring a dog?" });
    await say(token, { text: "Taras" });
    const sent = await say(token, { text: "+380501112233" });
    expect(texts(sent.body.turn)).toContain("nobody will actually call you back");
    expect(ids(sent.body.turn)).not.toContain("person");
    await waitFor(async () => outbound.telegramCalls.some((c) => String(c.body.text).startsWith("💬")));
    const message = outbound.telegramCalls.find((c) => String(c.body.text).startsWith("💬"))!;
    expect(message.body.text).toBe(["💬 Питання з чату", "«Can I bring a dog?»", "Taras · +380501112233"].join("\n"));
    // "person" is no longer offered, so sending it is refused
    expect((await say(token, { choice: "person" })).res.status).toBe(400);
  });
});

describe("chat input checks and limits", () => {
  it("refuses choices that were not offered and text when choices are expected", async () => {
    const { body } = await startChat();
    expect((await say(body.token, { choice: "t:12:00" })).res.status).toBe(400);
    expect((await say(body.token, { text: "book" })).res.status).toBe(400);
    expect((await say(body.token, { choice: "book", text: "x" })).res.status).toBe(400);
  });

  it("answers 401 CHAT_EXPIRED without a token, with an unknown one, and after 2 hours of silence", async () => {
    const { body } = await startChat();
    const none = await call("/chat/sessions/current/messages", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ choice: "book" }) });
    expect(none.status).toBe(401);
    expect(((await none.json()) as any).error.code).toBe("CHAT_EXPIRED");
    expect((await say("unknown-token", { choice: "book" })).res.status).toBe(401);
    pinClock(new Date(NOW.getTime() + 2 * 3600_000 + 1000));
    expect((await say(body.token, { choice: "book" })).res.status).toBe(401);
  });

  it("stops a conversation at 60 guest messages", async () => {
    const { body } = await startChat();
    await env.DB.prepare("UPDATE chat_sessions SET guest_messages = 60").run();
    const r = await say(body.token, { choice: "book" });
    expect(r.res.status).toBe(409);
    expect(r.body.error.code).toBe("CHAT_LIMIT");
  });

  it("rate-limits chat requests per IP", async () => {
    const { body } = await startChat("en", "10.7.7.7"); // 1st request
    let last = 0;
    for (let i = 0; i < 30; i++) last = (await say(body.token, { choice: i % 2 ? "menu" : "faq" }, "10.7.7.7")).res.status;
    expect(last).toBe(429);
  });

  it("returns the conversation so far, to continue after a reload", async () => {
    const { body } = await startChat();
    await say(body.token, { choice: "faq" });
    const res = await call("/chat/sessions/current", { headers: { authorization: `Bearer ${body.token}` } });
    const history = (await res.json()) as any;
    expect(history.messages.map((m: any) => m.sender)).toEqual(["bot", "bot", "bot", "guest", "bot"]);
    expect(history.messages[3].text).toBe("Hours, address, menu");
    expect(ids(history)).toEqual(["hours", "address", "menuItems", "menu"]);
  });
});

describe("admin chat views", () => {
  it("lists conversations and shows transcripts with name and phone masked", async () => {
    const { token } = await toSummary("Olena Kovalenko");
    await say(token, { choice: "confirm" });
    const auth = await adminToken();
    const headers = { authorization: `Bearer ${auth}` };

    const list = (await (await call("/admin/chats", { headers })).json()) as any;
    expect(list.chats).toHaveLength(1);
    expect(list.chats[0]).toMatchObject({ locale: "en", outcome: "booked", reservationDate: THURSDAY });

    const res = await call(`/admin/chats/${list.chats[0].id}`, { headers });
    const transcript = (await res.json()) as any;
    const all = transcript.messages.map((m: any) => m.text).join("\n");
    expect(all).not.toContain("Kovalenko");
    expect(all).not.toContain("+380671234567");
    expect(all).not.toContain("067 123 45 67");
    expect(all).toContain("Olena K.");
    expect(all).toContain("+380 67 *** ** 67");
    expect((await call("/admin/chats/missing", { headers })).status).toBe(404);
    expect((await call("/admin/chats")).status).toBe(401);
  });
});
