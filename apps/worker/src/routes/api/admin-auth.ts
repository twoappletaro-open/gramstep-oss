import { Hono } from "hono";
import type { Env } from "../../env.js";
import {
  loginOperator,
  refreshAccessToken,
  verifyAccessToken,
  createAccessToken,
  hashPassword,
} from "../../services/admin-auth.js";
import type { AdminAuthDeps } from "../../services/admin-auth.js";
import { generateId } from "@gramstep/db";
import {
  setupTotp,
  enableTotp,
  verifyTotpForLogin,
} from "../../services/totp.js";
import { seedDemoData } from "../../services/bootstrap-demo-data.js";

const adminAuthRoutes = new Hono<{ Bindings: Env }>();

const REFRESH_COOKIE = "__Host-refresh";
const REFRESH_MAX_AGE = 604800; // 7日

function buildAdminDeps(env: Env): AdminAuthDeps {
  return {
    db: env.DB,
    jwtSecret: env.JWT_SECRET,
    refreshSecret: env.REFRESH_SECRET,
  };
}

function setRefreshCookie(c: { header: (name: string, value: string) => void }, token: string): void {
  c.header(
    "Set-Cookie",
    `${REFRESH_COOKIE}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${REFRESH_MAX_AGE}`,
  );
}

function clearRefreshCookie(c: { header: (name: string, value: string) => void }): void {
  c.header(
    "Set-Cookie",
    `${REFRESH_COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`,
  );
}

// POST /api/admin/auth/login
adminAuthRoutes.post("/login", async (c) => {
  let body: { email?: string; password?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid request body" }, 400);
  }

  if (!body.email || !body.password) {
    return c.json({ error: "Email and password are required" }, 400);
  }

  const deps = buildAdminDeps(c.env);
  const result = await loginOperator(body.email, body.password, deps);

  if (!result.ok) {
    const status = result.error.code === "INVALID_CREDENTIALS" ? 401 : 500;
    return c.json({ error: result.error.message }, status);
  }

  setRefreshCookie(c, result.value.refreshToken);

  return c.json({
    accessToken: result.value.accessToken,
    refreshToken: result.value.refreshToken,
    operator: result.value.operator,
    totpRequired: result.value.totpRequired,
  });
});

// POST /api/admin/auth/refresh
adminAuthRoutes.post("/refresh", async (c) => {
  // Cookie または リクエストbody からrefreshTokenを取得（クロスオリジン対応）
  const cookieHeader = c.req.header("Cookie") ?? "";
  const cookies = Object.fromEntries(
    cookieHeader.split(";").map((s) => {
      const [key, ...rest] = s.trim().split("=");
      return [key, rest.join("=")] as [string, string];
    }),
  );
  let refreshToken = cookies[REFRESH_COOKIE];

  if (!refreshToken) {
    try {
      const body = await c.req.json() as { refreshToken?: string };
      refreshToken = body.refreshToken;
    } catch {
      // bodyパース失敗は無視
    }
  }

  if (!refreshToken) {
    return c.json({ error: "No refresh token" }, 401);
  }

  const deps = buildAdminDeps(c.env);
  const result = await refreshAccessToken(refreshToken, deps);

  if (!result.ok) {
    clearRefreshCookie(c);
    const status =
      result.error.code === "INVALID_TOKEN" || result.error.code === "TOKEN_EXPIRED"
        ? 401
        : 404;
    return c.json({ error: result.error.message }, status);
  }

  setRefreshCookie(c, result.value.refreshToken);

  return c.json({
    accessToken: result.value.accessToken,
    refreshToken: result.value.refreshToken,
  });
});

// POST /api/admin/auth/logout
adminAuthRoutes.post("/logout", (c) => {
  clearRefreshCookie(c);
  return c.json({ success: true });
});

// ────────── TOTP Helper: extract operator from Bearer token ──────────

async function extractOperatorId(
  c: { req: { header: (name: string) => string | undefined }; env: Env },
): Promise<{ operatorId: string; role: string; totpVerified: boolean } | null> {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);
  const result = await verifyAccessToken(token, c.env.JWT_SECRET);
  if (!result.ok) return null;
  return {
    operatorId: result.value.sub,
    role: result.value.role,
    totpVerified: result.value.totpVerified,
  };
}

// POST /api/admin/auth/totp/setup
adminAuthRoutes.post("/totp/setup", async (c) => {
  const auth = await extractOperatorId(c);
  if (!auth) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const deps = buildAdminDeps(c.env);
  const result = await setupTotp(auth.operatorId, { db: deps.db, jwtSecret: deps.jwtSecret });

  if (!result.ok) {
    const status =
      result.error.code === "OPERATOR_NOT_FOUND" ? 404 :
      result.error.code === "TOTP_ALREADY_ENABLED" ? 409 : 500;
    return c.json({ error: result.error.message }, status);
  }

  return c.json({ secret: result.value.secret, uri: result.value.uri });
});

// POST /api/admin/auth/totp/enable
adminAuthRoutes.post("/totp/enable", async (c) => {
  const auth = await extractOperatorId(c);
  if (!auth) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  let body: { code?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid request body" }, 400);
  }

  if (!body.code) {
    return c.json({ error: "TOTP code is required" }, 400);
  }

  const deps = buildAdminDeps(c.env);
  const result = await enableTotp(auth.operatorId, body.code, {
    db: deps.db,
    jwtSecret: deps.jwtSecret,
  });

  if (!result.ok) {
    const status =
      result.error.code === "INVALID_CODE" ? 400 :
      result.error.code === "TOTP_NOT_SETUP" ? 400 :
      result.error.code === "TOTP_ALREADY_ENABLED" ? 409 :
      result.error.code === "OPERATOR_NOT_FOUND" ? 404 : 500;
    return c.json({ error: result.error.message }, status);
  }

  return c.json({ success: true });
});

// POST /api/admin/auth/totp/verify (login second step)
adminAuthRoutes.post("/totp/verify", async (c) => {
  const auth = await extractOperatorId(c);
  if (!auth) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  let body: { code?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid request body" }, 400);
  }

  if (!body.code) {
    return c.json({ error: "TOTP code is required" }, 400);
  }

  const deps = buildAdminDeps(c.env);
  const verifyResult = await verifyTotpForLogin(auth.operatorId, body.code, {
    db: deps.db,
    jwtSecret: deps.jwtSecret,
  });

  if (!verifyResult.ok) {
    const status =
      verifyResult.error.code === "INVALID_CODE" ? 401 :
      verifyResult.error.code === "TOTP_NOT_SETUP" ? 400 :
      verifyResult.error.code === "OPERATOR_NOT_FOUND" ? 404 : 500;
    return c.json({ error: verifyResult.error.message }, status);
  }

  // Issue new access token with totp_verified: true
  const newAccessToken = await createAccessToken(
    {
      sub: auth.operatorId,
      role: auth.role,
      accountId: "",
      totpVerified: true,
    },
    deps.jwtSecret,
  );

  return c.json({ accessToken: newAccessToken });
});

// 初回セットアップ用オペレーターシード（オペレーター未登録時のみ動作）
adminAuthRoutes.post("/dev-seed", async (c) => {
  try {
    // 既存オペレーターがいる場合は拒否（セキュリティ: 初回のみ許可）
    const existing = await c.env.DB.prepare("SELECT id FROM operators LIMIT 1").first<{ id: string }>();
    if (existing) {
      return c.json({ ok: false, error: "管理者は既に作成済みです。このエンドポイントは無効化されました。" }, 403);
    }

    // ランダムパスワード生成（16文字、均一分布）
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%";
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    const randomPassword = Array.from(bytes, (b) => chars[b % chars.length]).join("");

    const id = generateId();
    const passwordHash = await hashPassword(randomPassword);
    const now = Math.floor(Date.now() / 1000);
    const workerOrigin = new URL(c.req.url).origin;

    // アカウントシード
    await c.env.DB.prepare(
      `INSERT OR IGNORE INTO accounts (id, ig_user_id, ig_username, access_token_encrypted, token_expires_at, timezone, health_score, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind("acc_default", "0", "pending_setup", "pending", 0, "Asia/Tokyo", "normal", now, now)
      .run();

    const demoSeed = await seedDemoData({
      db: c.env.DB,
      accountId: "acc_default",
      operatorId: id,
      workerOrigin,
      now,
    });

    // オペレーターシード（INSERT OR IGNORE でレース防止）
    let email = "admin@test.local";
    try {
      const body = await c.req.json() as { email?: string };
      if (body.email) email = body.email;
    } catch { /* body無しの場合デフォルト使用 */ }

    await c.env.DB.prepare(
      `INSERT OR IGNORE INTO operators (id, email, password_hash, role, totp_enabled, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
      .bind(id, email, passwordHash, "admin", 0, now)
      .run();

    await c.env.DB.prepare(
      `INSERT OR IGNORE INTO operator_account_access (operator_id, account_id)
       VALUES (?, ?)`,
    )
      .bind(id, "acc_default")
      .run();

    return c.json({ ok: true, operatorId: id, email, password: randomPassword, demoSeed });
  } catch (e: unknown) {
    return c.json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

export { adminAuthRoutes };
