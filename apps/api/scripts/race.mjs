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
// "--n" given without a value is an error, not the default.
const n = "n" in args ? Number(args.n) : 8;
const guests = 4;
const fourSeatTables = 4;

// The create endpoint allows 10 requests per minute per IP, so more would only measure the limiter.
if (!Number.isInteger(n) || n < 1 || n > 10) {
  console.error(`--n must be an integer from 1 to 10 (got ${args.n}).`);
  process.exit(2);
}

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
const limited = results.filter((r) => r.body.error?.code === "RATE_LIMITED");
const other = results.length - created.length - taken.length - limited.length;
console.log(
  `\n${created.length} booked, ${taken.length} SLOT_TAKEN, ${limited.length} RATE_LIMITED, ${other} other — in ${ms} ms`,
);

// The race really happened only if every request reached the booking logic and at least
// one won; double booking means more winners than 4-seat tables.
let ok = true;
if (created.length > fourSeatTables) {
  console.log("FAIL: double booking!");
  ok = false;
} else if (limited.length > 0) {
  console.log("INCONCLUSIVE: rate limit hit — wait a minute and run again.");
  ok = false;
} else if (other > 0 || created.length === 0) {
  console.log("INCONCLUSIVE: unexpected responses or no booking succeeded.");
  ok = false;
} else {
  console.log(`OK: ${created.length} booking(s), never more than ${fourSeatTables} 4-seat tables.`);
  if (created.length < Math.min(n, fourSeatTables)) {
    console.log(`Note: only ${created.length} 4-seat table(s) were free at ${time}; pick an empty time to see all 4.`);
  }
}

// Clean up: cancel what was created.
for (const r of created) {
  await fetch(`${base}/reservations/${r.body.token}/cancel`, { method: "POST" });
}
console.log(`Cancelled ${created.length} reservation(s).`);

// exitCode instead of process.exit(): exiting while fetch sockets are still closing can
// abort Node on Windows (libuv "UV_HANDLE_CLOSING" assertion).
process.exitCode = ok ? 0 : 1;
