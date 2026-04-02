import { Hono } from "hono";
import type { Env } from "../../env.js";
import { SetIceBreakersInputSchema } from "@gramstep/shared";
import { createProfileManager } from "../../services/profile-manager.js";
import { MockInstagramClient } from "@gramstep/ig-sdk";
import type { Account } from "@gramstep/db";
import { decryptToken, generateAppSecretProof } from "../../services/crypto.js";

export const iceBreakerRoutes = new Hono<{ Bindings: Env }>();

async function getAccountInfo(
  db: D1Database,
  accountId: string,
  encryptionKey: string,
  appSecret: string,
): Promise<{ igUserId: string; accessToken: string; appSecretProof: string } | null> {
  const account = await db
    .prepare("SELECT ig_user_id, access_token_encrypted FROM accounts WHERE id = ?")
    .bind(accountId)
    .first<Pick<Account, "ig_user_id" | "access_token_encrypted">>();
  if (!account) return null;

  const decryptResult = await decryptToken(account.access_token_encrypted, encryptionKey);
  if (!decryptResult.ok) return null;

  const proof = await generateAppSecretProof(decryptResult.value, appSecret);

  return {
    igUserId: account.ig_user_id,
    accessToken: decryptResult.value,
    appSecretProof: proof,
  };
}

// NOTE: MockInstagramClient is used as HttpInstagramClient is not yet implemented.
// When a real client is available, replace MockInstagramClient with it.

iceBreakerRoutes.get("/", async (c) => {
  const accountId = c.get("accountId" as never) as string;
  const info = await getAccountInfo(c.env.DB, accountId, c.env.ENCRYPTION_KEY, c.env.META_APP_SECRET);
  if (!info) {
    return c.json({ error: "Account not found or token invalid" }, 404);
  }

  const manager = createProfileManager({
    db: c.env.DB,
    now: () => Math.floor(Date.now() / 1000),
    igClient: new MockInstagramClient(),
    accessToken: info.appSecretProof,
    igUserId: info.igUserId,
  });
  const result = await manager.listIceBreakers(accountId);
  if (!result.ok) {
    return c.json({ error: result.error.message }, 500);
  }
  return c.json(result.value, 200);
});

iceBreakerRoutes.post("/", async (c) => {
  const accountId = c.get("accountId" as never) as string;
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  const parsed = SetIceBreakersInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "入力が不正です", details: parsed.error.issues }, 400);
  }

  const info = await getAccountInfo(c.env.DB, accountId, c.env.ENCRYPTION_KEY, c.env.META_APP_SECRET);
  if (!info) {
    return c.json({ error: "Account not found or token invalid" }, 404);
  }

  const manager = createProfileManager({
    db: c.env.DB,
    now: () => Math.floor(Date.now() / 1000),
    igClient: new MockInstagramClient(),
    accessToken: info.appSecretProof,
    igUserId: info.igUserId,
  });
  const result = await manager.setIceBreakers(accountId, parsed.data);
  if (!result.ok) {
    const status = result.error.code === "VALIDATION_ERROR" ? 400 : 500;
    return c.json({ error: result.error.message }, status);
  }
  return c.json(result.value, 201);
});

iceBreakerRoutes.delete("/", async (c) => {
  const accountId = c.get("accountId" as never) as string;
  const info = await getAccountInfo(c.env.DB, accountId, c.env.ENCRYPTION_KEY, c.env.META_APP_SECRET);
  if (!info) {
    return c.json({ error: "Account not found or token invalid" }, 404);
  }

  const manager = createProfileManager({
    db: c.env.DB,
    now: () => Math.floor(Date.now() / 1000),
    igClient: new MockInstagramClient(),
    accessToken: info.appSecretProof,
    igUserId: info.igUserId,
  });
  const result = await manager.deleteIceBreakers(accountId);
  if (!result.ok) {
    return c.json({ error: result.error.message }, 500);
  }
  return c.newResponse(null, 204);
});

iceBreakerRoutes.post("/sync", async (c) => {
  const accountId = c.get("accountId" as never) as string;
  const info = await getAccountInfo(c.env.DB, accountId, c.env.ENCRYPTION_KEY, c.env.META_APP_SECRET);
  if (!info) {
    return c.json({ error: "Account not found or token invalid" }, 404);
  }

  const manager = createProfileManager({
    db: c.env.DB,
    now: () => Math.floor(Date.now() / 1000),
    igClient: new MockInstagramClient(),
    accessToken: info.appSecretProof,
    igUserId: info.igUserId,
  });
  const result = await manager.syncIceBreakers(accountId);
  if (!result.ok) {
    return c.json({ error: result.error.message }, 500);
  }
  return c.json({ synced: true }, 200);
});
