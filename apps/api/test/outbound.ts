// Mocks the API's outbound calls (Turnstile siteverify, Telegram sendMessage) for every test.
// The main Worker runs in the same isolate as the tests, so spying on globalThis.fetch
// also intercepts its calls (v3 plan, R4). Tests change behaviour via `outbound`.

import { beforeEach, vi } from "vitest";
import { aiModel, type AiMessage, type AiReply } from "../src/chat/ai/model";

export type TurnstileMode = "ok" | "failed" | "http-error" | "network-error";
export type TelegramMode = "ok" | "failed" | "network-error";

export const outbound = {
  turnstile: "ok" as TurnstileMode,
  telegram: "ok" as TelegramMode,
  /** Request bodies sent to each service, in order. */
  turnstileCalls: [] as Array<Record<string, unknown>>,
  telegramCalls: [] as Array<{ url: string; body: Record<string, unknown> }>,
  /** Delay before Telegram answers, per message text (to reorder messages in tests). */
  telegramDelayMs: (_text: string): number => 0,
  /** Texts of Telegram messages in the order their requests finished. */
  telegramDone: [] as string[],
  /**
   * v6: scripted model replies, used in order; each call records the messages it got. An empty
   * script fails the test, so tests never reach the real Workers AI (it has no local simulator).
   */
  aiReplies: [] as Array<AiReply | Error>,
  aiCalls: [] as AiMessage[][],
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
  outbound.telegramDelayMs = () => 0;
  outbound.telegramDone = [];
  outbound.aiReplies = [];
  outbound.aiCalls = [];
  vi.spyOn(aiModel, "run").mockImplementation(async (messages) => {
    outbound.aiCalls.push(messages);
    const next = outbound.aiReplies.shift();
    if (!next) throw new Error("Unexpected AI model call: no scripted reply left");
    if (next instanceof Error) throw next;
    return next;
  });

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
      const delay = outbound.telegramDelayMs(String(body.text ?? ""));
      if (delay) await new Promise((r) => setTimeout(r, delay));
      outbound.telegramDone.push(String(body.text ?? ""));
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
