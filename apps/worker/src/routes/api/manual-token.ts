import { Hono } from "hono";
import type { Env } from "../../env.js";
import { encryptToken, generateAppSecretProof } from "../../services/crypto.js";
import { executeRun } from "@gramstep/db";
import { AppSlotSchema } from "@gramstep/shared";
import {
  clearSecondaryTokenForAccount,
  getAppFailoverConfig,
  saveSecondaryTokenForAccount,
  syncWebhookSubscriptionForSlot,
} from "../../services/app-failover.js";

const manualTokenRoutes = new Hono<{ Bindings: Env }>();

// POST /api/auth/manual-token — 手動生成トークンでアカウント接続
manualTokenRoutes.post("/manual-token", async (c) => {
  const body = await c.req.json() as { access_token?: string; ig_user_id?: string; slot?: string };
  if (!body.access_token || !body.ig_user_id) {
    return c.json({ error: "access_token and ig_user_id required" }, 400);
  }
  const accountId = c.req.header("x-account-id") ?? "";
  const slotResult = AppSlotSchema.safeParse(body.slot ?? "primary");
  if (!slotResult.success) {
    return c.json({ error: "slot must be primary or secondary" }, 400);
  }
  const slot = slotResult.data;

  const meRes = await fetch(
    `https://graph.instagram.com/${c.env.META_API_VERSION}/me?fields=user_id,username&access_token=${body.access_token}`,
  );
  const meData = await meRes.json() as { user_id?: string; username?: string };
  if (meData.user_id && meData.user_id !== body.ig_user_id) {
    return c.json({ error: "ig_user_id does not match the supplied access token" }, 400);
  }

  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + 60 * 24 * 3600; // 60日
  const resolvedIgUserId = meData.user_id ?? body.ig_user_id;

  if (slot === "secondary") {
    if (!accountId) {
      return c.json({ error: "x-account-id required for secondary token registration" }, 400);
    }

    const config = await getAppFailoverConfig(c.env.KV, accountId);
    if (!config.secondaryApp) {
      return c.json({ error: "Secondary app is not configured" }, 400);
    }

    const account = await c.env.DB.prepare("SELECT ig_user_id, ig_username FROM accounts WHERE id = ?")
      .bind(accountId)
      .first<{ ig_user_id: string | null; ig_username: string | null }>();
    if (!account) {
      return c.json({ error: "Account not found" }, 404);
    }
    if (account.ig_user_id && account.ig_user_id !== resolvedIgUserId) {
      return c.json({ error: "Secondary token belongs to a different Instagram account" }, 400);
    }

    const saved = await saveSecondaryTokenForAccount(c.env, accountId, {
      accessToken: body.access_token,
      igUserId: resolvedIgUserId,
      igUsername: meData.username ?? null,
      expiresAt,
    });
    if (!saved) {
      return c.json({ error: "Failed to save secondary token" }, 500);
    }

    const subscription = await syncWebhookSubscriptionForSlot(c.env, accountId, "secondary", "POST");
    if (!subscription.ok) {
      await clearSecondaryTokenForAccount(c.env, accountId);
      return c.json({ error: subscription.error ?? "Failed to subscribe secondary app webhook" }, 502);
    }

    return c.json({
      ok: true,
      slot: "secondary",
      username: meData.username ?? account.ig_username,
      ig_user_id: resolvedIgUserId,
      webhook_subscription: subscription,
      account_id: accountId,
    });
  }

  const encResult = await encryptToken(body.access_token, c.env.ENCRYPTION_KEY);
  if (!encResult.ok) {
    return c.json({ error: "Encryption failed" }, 500);
  }

  // DB更新
  if (accountId) {
    await executeRun(
      c.env.DB,
      `UPDATE accounts SET
        ig_user_id = ?,
        ig_username = ?,
        access_token_encrypted = ?,
        token_expires_at = ?,
        updated_at = ?
      WHERE id = ?`,
      resolvedIgUserId,
      meData.username ?? null,
      encResult.value,
      expiresAt,
      now,
      accountId,
    );
  } else {
    await executeRun(
      c.env.DB,
      `UPDATE accounts SET
        ig_user_id = ?,
        ig_username = ?,
        access_token_encrypted = ?,
        token_expires_at = ?,
        updated_at = ?
      WHERE ig_user_id = ? OR id = (SELECT id FROM accounts WHERE ig_username = 'pending_setup' LIMIT 1)`,
      resolvedIgUserId,
      meData.username ?? null,
      encResult.value,
      expiresAt,
      now,
      resolvedIgUserId,
    );
  }

  // KVトークンキャッシュ
  const account = accountId
    ? await c.env.DB.prepare("SELECT id FROM accounts WHERE id = ?").bind(accountId).first<{ id: string }>()
    : await c.env.DB.prepare("SELECT id FROM accounts WHERE ig_user_id = ?")
      .bind(resolvedIgUserId).first<{ id: string }>();
  if (account) {
    await c.env.KV.put(`token:${account.id}`, encResult.value, { expirationTtl: 3600 });
  }

  // Webhook購読
  const proof = await generateAppSecretProof(body.access_token, c.env.META_APP_SECRET);
  const subRes = await fetch(
    `https://graph.instagram.com/${c.env.META_API_VERSION}/${resolvedIgUserId}/subscribed_apps`, {
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
    slot: "primary",
    username: meData.username,
    ig_user_id: resolvedIgUserId,
    webhook_subscription: subData,
    account_id: account?.id,
  });
});

export { manualTokenRoutes };
