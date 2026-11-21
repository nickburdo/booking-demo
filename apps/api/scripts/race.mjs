#!/usr/bin/env node
// Race demo: fires N concurrent bookings for 4 guests at one date/time and shows that
// exactly as many succeed as there are 4-seat tables (4). Created reservations are
// cancelled at the end. Not a test: a demo you run against a local or live API.
//
// Usage:
//   node scripts/race.mjs [--base URL] [--date YYYY-MM-DD] [--time HH:MM] [--n 8]
//
// Defaults: base http://localhost:8787, date = 7 days from today (Kyiv), time = the
// latest start time still free for 4 guests on that date, n = 8.
// Note: POST /reservations is rate-limited to 10 per minute per IP, so keep n ≤ 10 and
// wait a minute between runs against the same API.

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .reduce((pairs, arg, i, all) => (arg.startsWith("--") ? [...pairs, [arg.slice(2), all[i + 1]]] : pairs), []),
);

const base = (args.base ?? "http://localhost:8787").replace(/\/$/, "");
const n = Number(args.n ?? 8);
const guests = 4;

function kyivDate(daysAhead) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv" }).format(new Date());
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + daysAhead);
  return d.toISOString().slice(0, 10);
}

async function json(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

const date = args.date ?? kyivDate(7);
let time = args.time;
if (!time) {
  const res = await fetch(`${base}/availability?date=${date}&guests=${guests}`);
  const body = await json(res);
  if (!res.ok || !body.times?.length) {
    console.error(`No free time on ${date}:`, body);
    process.exit(1);
  }
  time = body.times.at(-1);
}

console.log(`API:    ${base}`);
console.log(`Target: ${date} ${time}, ${guests} guests, ${n} concurrent requests\n`);

const started = performance.now();
const results = await Promise.all(
  Array.from({ length: n }, async (_, i) => {
    const res = await fetch(`${base}/reservations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ date, time, guests, name: `Race ${i + 1}`, phone: "+380000000000" }),
    });
    return { i: i + 1, status: res.status, body: await json(res) };
  }),
);
const ms = Math.round(performance.now() - started);

for (const r of results) {
  const detail = r.status === 201 ? `reservation ${r.body.reservation.id}` : r.body.error?.code ?? r.body;
  console.log(`  request ${String(r.i).padStart(2)}: ${r.status}  ${detail}`);
}

const created = results.filter((r) => r.status === 201);
const taken = results.filter((r) => r.body.error?.code === "SLOT_TAKEN");
const other = results.length - created.length - taken.length;
console.log(`\n${created.length} booked, ${taken.length} SLOT_TAKEN, ${other} other — in ${ms} ms`);
console.log(created.length <= 4 ? "OK: no more bookings than 4-seat tables." : "FAIL: double booking!");

// Clean up: cancel what was created.
for (const r of created) {
  await fetch(`${base}/reservations/${r.body.token}/cancel`, { method: "POST" });
}
console.log(`Cancelled ${created.length} reservation(s).`);

process.exit(created.length <= 4 && other === 0 ? 0 : 1);
