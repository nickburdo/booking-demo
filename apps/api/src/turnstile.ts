// Cloudflare Turnstile server-side check (ADR-019). Fail closed: if Turnstile cannot be
// reached or answers garbage, the caller refuses the request.

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export type TurnstileResult = "ok" | "failed" | "unavailable";

export async function verifyTurnstile(
  secret: string | undefined,
  token: string,
  remoteIp: string | undefined,
): Promise<TurnstileResult> {
  if (!secret) {
    console.error("TURNSTILE_SECRET is not configured");
    return "unavailable";
  }
  try {
    const res = await fetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret, response: token, remoteip: remoteIp }),
    });
    if (!res.ok) {
      console.error(`Turnstile siteverify answered HTTP ${res.status}`);
      return "unavailable";
    }
    const data = (await res.json()) as { success?: boolean; "error-codes"?: string[] };
    if (data.success === true) return "ok";
    console.warn("Turnstile rejected a token:", data["error-codes"]);
    return "failed";
  } catch (error) {
    console.error("Turnstile siteverify unreachable:", error);
    return "unavailable";
  }
}
