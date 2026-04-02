import { Hono } from "hono";
import type { Env } from "../../env.js";
import { CreateApiKeyInputSchema, UpdateApiKeyInputSchema } from "@gramstep/shared";
import { createApiKeyManager } from "../../services/api-key-manager.js";

export const apiKeyRoutes = new Hono<{ Bindings: Env }>();

apiKeyRoutes.get("/", async (c) => {
  const accountId = c.get("accountId" as never) as string;
  const mgr = createApiKeyManager({ db: c.env.DB, now: () => Math.floor(Date.now() / 1000) });
  const result = await mgr.list(accountId);
  if (!result.ok) {
    return c.json({ error: result.error.message }, 500);
  }
  return c.json(result.value, 200);
});

apiKeyRoutes.post("/", async (c) => {
  const accountId = c.get("accountId" as never) as string;
  const body = await c.req.json();
  const parsed = CreateApiKeyInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "入力が不正です", details: parsed.error.issues }, 400);
  }

  const mgr = createApiKeyManager({ db: c.env.DB, now: () => Math.floor(Date.now() / 1000) });
  const result = await mgr.create(accountId, parsed.data);
  if (!result.ok) {
    return c.json({ error: result.error.message }, 500);
  }
  // Return raw_key only on creation - it won't be retrievable later
  return c.json(result.value, 201);
});

apiKeyRoutes.get("/:id", async (c) => {
  const accountId = c.get("accountId" as never) as string;
  const keyId = c.req.param("id");
  const mgr = createApiKeyManager({ db: c.env.DB, now: () => Math.floor(Date.now() / 1000) });
  const result = await mgr.get(keyId, accountId);
  if (!result.ok) {
    const status = result.error.code === "NOT_FOUND" ? 404 : 500;
    return c.json({ error: result.error.message }, status);
  }
  return c.json(result.value, 200);
});

apiKeyRoutes.put("/:id", async (c) => {
  const accountId = c.get("accountId" as never) as string;
  const keyId = c.req.param("id");
  const body = await c.req.json();
  const parsed = UpdateApiKeyInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "入力が不正です", details: parsed.error.issues }, 400);
  }

  const mgr = createApiKeyManager({ db: c.env.DB, now: () => Math.floor(Date.now() / 1000) });
  const result = await mgr.update(keyId, accountId, parsed.data);
  if (!result.ok) {
    const status = result.error.code === "NOT_FOUND" ? 404 : 500;
    return c.json({ error: result.error.message }, status);
  }
  return c.json(result.value, 200);
});

apiKeyRoutes.post("/:id/revoke", async (c) => {
  const accountId = c.get("accountId" as never) as string;
  const keyId = c.req.param("id");
  const mgr = createApiKeyManager({ db: c.env.DB, now: () => Math.floor(Date.now() / 1000) });
  const result = await mgr.revoke(keyId, accountId);
  if (!result.ok) {
    const status = result.error.code === "NOT_FOUND" ? 404 : 500;
    return c.json({ error: result.error.message }, status);
  }
  return c.newResponse(null, 204);
});

apiKeyRoutes.post("/:id/rotate", async (c) => {
  const accountId = c.get("accountId" as never) as string;
  const keyId = c.req.param("id");
  const mgr = createApiKeyManager({ db: c.env.DB, now: () => Math.floor(Date.now() / 1000) });
  const result = await mgr.rotate(keyId, accountId);
  if (!result.ok) {
    const status = result.error.code === "NOT_FOUND" ? 404 : 500;
    return c.json({ error: result.error.message }, status);
  }
  return c.json(result.value, 201);
});

apiKeyRoutes.delete("/:id", async (c) => {
  const accountId = c.get("accountId" as never) as string;
  const keyId = c.req.param("id");
  const mgr = createApiKeyManager({ db: c.env.DB, now: () => Math.floor(Date.now() / 1000) });
  const result = await mgr.deleteKey(keyId, accountId);
  if (!result.ok) {
    return c.json({ error: result.error.message }, 500);
  }
  return c.newResponse(null, 204);
});
