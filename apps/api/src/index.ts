import { httpServerHandler } from "cloudflare:node";
import { env } from "cloudflare:workers";
import cors from "cors";
import express, { type ErrorRequestHandler } from "express";
import { cancelByToken, createReservation, getAvailability, getReservation } from "./booking";
import { clock } from "./clock";
import { HttpError } from "./errors";
import { availabilityQuery, parse, reservationBody } from "./validation";

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
  const key = req.get("cf-connecting-ip") ?? "unknown";
  const { success } = await env.CREATE_LIMITER.limit({ key });
  if (!success) {
    throw new HttpError(429, "RATE_LIMITED", "Too many booking requests. Try again in a minute.");
  }
  const input = parse(reservationBody, req.body ?? {});
  const result = await createReservation(env.DB, input, clock.now());
  res.status(201).json(result);
});

app.get("/reservations/:token", async (req, res) => {
  res.json({ reservation: await getReservation(env.DB, req.params.token) });
});

app.post("/reservations/:token/cancel", async (req, res) => {
  res.json({ reservation: await cancelByToken(env.DB, req.params.token, clock.now()) });
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
  // Malformed JSON body from express.json().
  if (error?.type === "entity.parse.failed") {
    res.status(400).json({ error: { code: "VALIDATION", message: "Body is not valid JSON." } });
    return;
  }
  console.error(error);
  res.status(500).json({ error: { code: "INTERNAL", message: "Something went wrong." } });
};
app.use(errorHandler);

app.listen(3000);
export default httpServerHandler({ port: 3000 });
