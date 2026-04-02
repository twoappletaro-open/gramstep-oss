import { Hono } from "hono";
import type { Env } from "../../env.js";
import { CreateBroadcastInputSchema } from "@gramstep/shared";
import { createBroadcastEngine } from "../../services/broadcast-engine.js";

export const broadcastRoutes = new Hono<{ Bindings: Env }>();

broadcastRoutes.post("/", async (c) => {
  const accountId = c.get("accountId" as never) as string;
  const body = await c.req.json();
  const parsed = CreateBroadcastInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "入力が不正です", details: parsed.error.issues }, 400);
  }

  const engine = createBroadcastEngine({
    db: c.env.DB,
    sendQueue: c.env.SEND_QUEUE,
    now: () => Math.floor(Date.now() / 1000),
  });

  const result = await engine.createBroadcast(accountId, parsed.data);
  if (!result.ok) {
    const status = result.error.code === "NOT_FOUND" ? 404 : 500;
    return c.json({ error: result.error.message }, status);
  }
  return c.json(result.value, 201);
});
