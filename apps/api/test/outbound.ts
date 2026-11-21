// Mocks the API's outbound calls (Turnstile siteverify, Telegram sendMessage) for every test.
// The main Worker runs in the same isolate as the tests, so spying on globalThis.fetch
// also intercepts its calls (v3 plan, R4). Tests change behaviour via `outbound`.

import { beforeEach, vi } from "vitest";

export type TurnstileMode = "ok" | "failed" | "http-error" | "network-error";
export type TelegramMode = "ok" | "failed" | "network-error";

export const outbound = {
  turnstile: "ok" as TurnstileMode,
  telegram: "ok" as TelegramMode,
  /** Request bodies sent to each service, in order. */
  turnstileCalls: [] as Array<Record<string, unknown>>,
  telegramCalls: [] as Array<{ url: string; body: Record<string, unknown> }>,
};

const realFetch = globalThis.fetch;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  outbound.turnstile = "ok";
  outbound.telegram = "ok";
  outbound.turnstileCalls = [];
  outbound.telegramCalls = [];

  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : {};

    if (url.startsWith("https://challenges.cloudflare.com/turnstile/")) {
      outbound.turnstileCalls.push(body);
      switch (outbound.turnstile) {
        case "ok":
          return json({ success: true, hostname: "localhost" });
        case "failed":
          return json({ success: false, "error-codes": ["invalid-input-response"] });
        case "http-error":
          return json({}, 500);
        case "network-error":
          throw new TypeError("fetch failed");
      }
    }

    if (url.startsWith("https://api.telegram.org/")) {
      outbound.telegramCalls.push({ url, body });
      switch (outbound.telegram) {
        case "ok":
          return json({ ok: true, result: { message_id: 1 } });
        case "failed":
          return json({ ok: false, description: "Bad Request: chat not found" }, 400);
        case "network-error":
          throw new TypeError("fetch failed");
      }
    }

    return realFetch(input, init);
  });
});
