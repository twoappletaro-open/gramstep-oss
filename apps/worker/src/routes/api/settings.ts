import { Hono } from "hono";
import type { Env } from "../../env.js";

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

export { settingsRoutes };
