import { Hono } from "hono";
import type { Env } from "../env.js";
import { checkHealth } from "../services/health-check.js";

export const healthRoute = new Hono<{ Bindings: Env }>();

healthRoute.get("/health", async (c) => {
  const result = await checkHealth(c.env.DB, c.env.KV, c.env.SEND_QUEUE);
  const status = result.status === "ok" ? 200 : 503;
  return c.json(result, status);
});
