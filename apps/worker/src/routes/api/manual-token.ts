import { Hono } from "hono";
import type { Env } from "../../env.js";
import { encryptToken, generateAppSecretProof } from "../../services/crypto.js";
import { executeRun } from "@gramstep/db";

const manualTokenRoutes = new Hono<{ Bindings: Env }>();

// POST /api/auth/manual-token — 手動生成トークンでアカウント接続
manualTokenRoutes.post("/manual-token", async (c) => {
  const body = await c.req.json() as { access_token?: string; ig_user_id?: string };
  if (!body.access_token || !body.ig_user_id) {
    return c.json({ error: "access_token and ig_user_id required" }, 400);
  }

  // トークン暗号化
  const encResult = await encryptToken(body.access_token, c.env.ENCRYPTION_KEY);
  if (!encResult.ok) {
    return c.json({ error: "Encryption failed" }, 500);
  }

  // /me でユーザー名取得
  const meRes = await fetch(`https://graph.instagram.com/${c.env.META_API_VERSION}/me?fields=user_id,username&access_token=${body.access_token}`);
  const meData = await meRes.json() as { user_id?: string; username?: string };

  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + 60 * 24 * 3600; // 60日

  // DB更新
  await executeRun(
    c.env.DB,
    `UPDATE accounts SET
      ig_user_id = ?,
      ig_username = ?,
      access_token_encrypted = ?,
      token_expires_at = ?,
      updated_at = ?
    WHERE ig_user_id = ? OR id = (SELECT id FROM accounts WHERE ig_username = 'pending_setup' LIMIT 1)`,
    body.ig_user_id,
    meData.username ?? null,
    encResult.value,
    expiresAt,
    now,
    body.ig_user_id,
  );

  // KVトークンキャッシュ
  const account = await c.env.DB.prepare("SELECT id FROM accounts WHERE ig_user_id = ?")
    .bind(body.ig_user_id).first<{ id: string }>();
  if (account) {
    await c.env.KV.put(`token:${account.id}`, encResult.value, { expirationTtl: 3600 });
  }

  // Webhook購読
  const proof = await generateAppSecretProof(body.access_token, c.env.META_APP_SECRET);
  const subRes = await fetch(
    `https://graph.instagram.com/${c.env.META_API_VERSION}/${body.ig_user_id}/subscribed_apps`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        subscribed_fields: "messages,messaging_postbacks,messaging_referral,messaging_seen,message_reactions",
        access_token: body.access_token,
        appsecret_proof: proof,
      }),
    },
  );
  const subData = await subRes.json();

  return c.json({
    ok: true,
    username: meData.username,
    ig_user_id: body.ig_user_id,
    webhook_subscription: subData,
    account_id: account?.id,
  });
});

export { manualTokenRoutes };
