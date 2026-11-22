// Workers AI model adapter (v6 P7, ADR-026). One place that calls the model and normalises the
// response shapes of the catalog: `{ response, tool_calls, usage }` and the OpenAI-style
// `{ choices[0].message, usage }`. Tests replace `aiModel.run`, so they never call the model.

import { env } from "cloudflare:workers";

/** Chosen in the v6 step 1.3 trial (ADR-026). */
export const AI_MODEL = "@cf/openai/gpt-oss-120b";
/** Workers AI prices of the model in neurons per million tokens ($0.35 / $0.75 at $0.011 per 1,000 neurons). */
export const NEURONS_PER_M = { input: 31_818, output: 68_182 };

export interface AiToolCall {
  id: string;
  name: string;
  /** Raw JSON text of the arguments (validated by the tool's schema before use). */
  arguments: string;
}

/** Conversation messages in the chat-completions shape the models accept. */
export type AiMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string; tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[] }
  | { role: "tool"; tool_call_id: string; content: string };

export interface AiTool {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface AiReply {
  text: string;
  toolCalls: AiToolCall[];
  usage: { input: number; output: number };
}

/** The model could not be used (Cloudflare's daily free quota or another failure). */
export class AiUnavailableError extends Error {
  constructor(readonly quota: boolean, message: string) {
    super(message);
    this.name = "AiUnavailableError";
  }
}

export function normaliseReply(raw: unknown): AiReply {
  const r = raw as Record<string, any> | null;
  const msg = r?.choices?.[0]?.message;
  const text = (msg ? msg.content : r?.response) ?? "";
  const rawCalls: any[] = (msg ? msg.tool_calls : r?.tool_calls) ?? [];
  const toolCalls = rawCalls.map((c, i): AiToolCall => {
    const fn = c.function ?? c;
    // gpt-oss can leak its channel markers into the name ("propose_booking<|channel|>analysis").
    const name = String(fn.name ?? "").split("<|")[0]!.trim();
    const args = typeof fn.arguments === "string" ? fn.arguments : JSON.stringify(fn.arguments ?? {});
    return { id: String(c.id ?? `call_${i}`), name, arguments: args };
  });
  const u = r?.usage ?? {};
  return {
    text: typeof text === "string" ? text.trim() : JSON.stringify(text),
    toolCalls,
    usage: { input: Number(u.prompt_tokens ?? 0), output: Number(u.completion_tokens ?? 0) },
  };
}

/**
 * One model call usually takes 2–7 s; Workers AI sometimes stalls for a minute (seen in v6 Phase 4).
 * After this long the guest gets "the AI is unavailable, try again" instead of waiting (P7).
 */
export const MODEL_TIMEOUT_MS = 25_000;

/** Rejects with AiUnavailableError if the promise does not settle in time. */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new AiUnavailableError(false, `model call timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export const aiModel = {
  async run(messages: AiMessage[], tools: AiTool[]): Promise<AiReply> {
    try {
      // The model id is a runtime constant; the binding's typed overloads do not list it.
      const call = (env.AI.run as (model: string, input: unknown) => Promise<unknown>)(AI_MODEL, {
        messages,
        tools,
        max_tokens: 600,
        temperature: 0.2,
      });
      const raw = await withTimeout(call, MODEL_TIMEOUT_MS);
      return normaliseReply(raw);
    } catch (error) {
      if (error instanceof AiUnavailableError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      // "You have used up your daily free allocation of 10,000 neurons" (code 3036).
      throw new AiUnavailableError(/3036|free allocation/i.test(message), message);
    }
  },
};

export function neuronsFor(usage: AiReply["usage"]): number {
  return Math.ceil((usage.input * NEURONS_PER_M.input + usage.output * NEURONS_PER_M.output) / 1_000_000);
}
