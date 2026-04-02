import { Hono } from "hono";
import type { Env } from "../../env.js";
import { SetPersistentMenuInputSchema } from "@gramstep/shared";
import { createProfileManager } from "../../services/profile-manager.js";
import { MockInstagramClient } from "@gramstep/ig-sdk";
import { getResolvedAppContext } from "../../services/app-failover.js";

export const persistentMenuRoutes = new Hono<{ Bindings: Env }>();

// NOTE: MockInstagramClient is used as HttpInstagramClient is not yet implemented.
// When a real client is available, replace MockInstagramClient with it.

persistentMenuRoutes.get("/", async (c) => {
  const accountId = c.get("accountId" as never) as string;
  let info;
  try {
    info = await getResolvedAppContext(c.env, accountId);
  } catch {
    return c.json({ error: "Account not found or token invalid" }, 404);
  }

  const manager = createProfileManager({
    db: c.env.DB,
    now: () => Math.floor(Date.now() / 1000),
    igClient: new MockInstagramClient(),
    accessToken: info.accessToken,
    igUserId: info.igUserId,
  });
  const result = await manager.listPersistentMenu(accountId);
  if (!result.ok) {
    return c.json({ error: result.error.message }, 500);
  }
  return c.json(result.value, 200);
});

persistentMenuRoutes.post("/", async (c) => {
  const accountId = c.get("accountId" as never) as string;
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  const parsed = SetPersistentMenuInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "入力が不正です", details: parsed.error.issues }, 400);
  }

  let info;
  try {
    info = await getResolvedAppContext(c.env, accountId);
  } catch {
    return c.json({ error: "Account not found or token invalid" }, 404);
  }

  const manager = createProfileManager({
    db: c.env.DB,
    now: () => Math.floor(Date.now() / 1000),
    igClient: new MockInstagramClient(),
    accessToken: info.accessToken,
    igUserId: info.igUserId,
  });
  const result = await manager.setPersistentMenu(accountId, parsed.data);
  if (!result.ok) {
    const status = result.error.code === "VALIDATION_ERROR" ? 400 : 500;
    return c.json({ error: result.error.message }, status);
  }
  return c.json(result.value, 201);
});

persistentMenuRoutes.delete("/", async (c) => {
  const accountId = c.get("accountId" as never) as string;
  let info;
  try {
    info = await getResolvedAppContext(c.env, accountId);
  } catch {
    return c.json({ error: "Account not found or token invalid" }, 404);
  }

  const manager = createProfileManager({
    db: c.env.DB,
    now: () => Math.floor(Date.now() / 1000),
    igClient: new MockInstagramClient(),
    accessToken: info.accessToken,
    igUserId: info.igUserId,
  });
  const result = await manager.deletePersistentMenu(accountId);
  if (!result.ok) {
    return c.json({ error: result.error.message }, 500);
  }
  return c.newResponse(null, 204);
});

persistentMenuRoutes.post("/sync", async (c) => {
  const accountId = c.get("accountId" as never) as string;
  let info;
  try {
    info = await getResolvedAppContext(c.env, accountId);
  } catch {
    return c.json({ error: "Account not found or token invalid" }, 404);
  }

  const manager = createProfileManager({
    db: c.env.DB,
    now: () => Math.floor(Date.now() / 1000),
    igClient: new MockInstagramClient(),
    accessToken: info.accessToken,
    igUserId: info.igUserId,
  });
  const result = await manager.syncPersistentMenu(accountId);
  if (!result.ok) {
    return c.json({ error: result.error.message }, 500);
  }
  return c.json({ synced: true }, 200);
});
