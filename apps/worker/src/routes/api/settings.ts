import { Hono } from "hono";
import type { Env } from "../../env.js";
import {
  AppSlotSchema,
  AppFailoverConfigSchema,
  SecondaryMetaAppSchema,
} from "@gramstep/shared";
import {
  getAccountFailoverStatus,
  saveAppFailoverConfig,
  switchAccountAppSlot,
} from "../../services/app-failover.js";

const settingsRoutes = new Hono<{ Bindings: Env }>();

// PUT /api/settings/privacy-policy — プライバシーポリシーHTML保存
settingsRoutes.put("/privacy-policy", async (c) => {
  const body = await c.req.json() as { html?: string };
  if (!body.html || typeof body.html !== "string") {
    return c.json({ error: "html field required" }, 400);
  }

  // 100KB制限
  if (body.html.length > 100_000) {
    return c.json({ error: "Policy HTML too large (max 100KB)" }, 400);
  }

  await c.env.KV.put("privacy_policy_html", body.html);
  return c.json({ ok: true });
});

// GET /api/settings/privacy-policy — 現在のポリシーHTML取得
settingsRoutes.get("/privacy-policy", async (c) => {
  const html = await c.env.KV.get("privacy_policy_html");
  return c.json({ html: html ?? null });
});

settingsRoutes.get("/app-failover", async (c) => {
  const accountId = c.get("accountId" as never) as string;
  if (!accountId) {
    return c.json({ error: "account_id required" }, 400);
  }

  const status = await getAccountFailoverStatus(c.env, accountId, c.req.url);
  if (!status) {
    return c.json({ error: "Account not found" }, 404);
  }

  return c.json(status);
});

settingsRoutes.put("/app-failover", async (c) => {
  const accountId = c.get("accountId" as never) as string;
  if (!accountId) {
    return c.json({ error: "account_id required" }, 400);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const parsedSecondary = SecondaryMetaAppSchema.safeParse(body);
  if (!parsedSecondary.success) {
    return c.json({ error: "secondary app config is invalid", details: parsedSecondary.error.issues }, 400);
  }

  const config = AppFailoverConfigSchema.parse({
    secondaryApp: parsedSecondary.data,
  });
  await saveAppFailoverConfig(c.env.KV, accountId, config);
  const status = await getAccountFailoverStatus(c.env, accountId, c.req.url);
  return c.json({ ok: true, status });
});

settingsRoutes.delete("/app-failover", async (c) => {
  const accountId = c.get("accountId" as never) as string;
  if (!accountId) {
    return c.json({ error: "account_id required" }, 400);
  }

  await saveAppFailoverConfig(c.env.KV, accountId, AppFailoverConfigSchema.parse({ secondaryApp: null }));
  const status = await getAccountFailoverStatus(c.env, accountId, c.req.url);
  return c.json({ ok: true, status });
});

settingsRoutes.post("/app-failover/switch", async (c) => {
  const accountId = c.get("accountId" as never) as string;
  if (!accountId) {
    return c.json({ error: "account_id required" }, 400);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const slotResult = AppSlotSchema.safeParse((body as { slot?: unknown } | null)?.slot);
  if (!slotResult.success) {
    return c.json({ error: "slot must be primary or secondary" }, 400);
  }

  try {
    const result = await switchAccountAppSlot(c.env, accountId, slotResult.data);
    const status = await getAccountFailoverStatus(c.env, accountId, c.req.url);
    return c.json({
      ok: true,
      ...result,
      status,
    });
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : "Failed to switch app slot" },
      400,
    );
  }
});

export { settingsRoutes };
