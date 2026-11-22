// Daily neuron budget of the AI chat (v6 P5, ADR-027). Cloudflare's free quota is 10,000 neurons
// per UTC day; we stop at 9,000 to keep headroom for concurrent requests.

export const DAILY_NEURON_BUDGET = 9_000;

export function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export async function neuronsUsed(db: D1Database, now: Date): Promise<number> {
  const row = await db.prepare("SELECT neurons FROM ai_usage WHERE day = ?").bind(utcDay(now)).first<{ neurons: number }>();
  return row?.neurons ?? 0;
}

export async function addNeurons(db: D1Database, now: Date, neurons: number): Promise<void> {
  if (neurons <= 0) return;
  await db
    .prepare("INSERT INTO ai_usage (day, neurons) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET neurons = neurons + excluded.neurons")
    .bind(utcDay(now), neurons)
    .run();
}

export async function budgetLeft(db: D1Database, now: Date): Promise<boolean> {
  return (await neuronsUsed(db, now)) < DAILY_NEURON_BUDGET;
}
