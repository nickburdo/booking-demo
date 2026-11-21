import { httpServerHandler } from "cloudflare:node";
import express from "express";

const app = express();

app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.listen(3000);
export default httpServerHandler({ port: 3000 });
