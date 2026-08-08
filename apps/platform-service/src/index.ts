import "./env.js";
import express from "express";
import cors from "cors";
import { db } from "database";
import { sql } from "drizzle-orm";
import { authRouter } from "./routes/auth.router.js";
import { clientRouter } from "./routes/client.router.js";
import { modelRouter } from "./routes/model.route.js";

const app = express();

app.use(cors());
app.use(express.json());

app.use("/auth", authRouter);
app.use("/client", clientRouter);
app.use("/model", modelRouter);

app.get("/health", async (_req, res) => {
  await db.execute(sql`SELECT 1`);
  res.json({ status: "ok", db: "connected" });
});

const PORT = process.env["PORT"] ?? 3000;
// Bind loopback-only by default: Caddy (or a local dev client) is the only
// intended caller, and the service should never be reachable directly from
// outside the host. Override with HOST if a deployment ever needs otherwise.
const HOST = process.env["HOST"] ?? "127.0.0.1";
app.listen(Number(PORT), HOST, () => {
  console.log(`platform-service running on ${HOST}:${PORT}`);
});
