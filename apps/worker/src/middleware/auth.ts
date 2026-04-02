import type { MiddlewareHandler } from "hono";
import type { Env } from "../env.js";
import { verifyAccessToken } from "../services/admin-auth.js";
import type { OperatorRole } from "@gramstep/shared";
import { createAccountManager } from "../services/account-manager.js";

// ────────── Types ──────────

export interface AuthOperator {
  id: string;
  role: OperatorRole;
  accountId: string;
  totpVerified: boolean;
}

// ────────── Permission Matrix ──────────
// admin: full access
// operator: read + write (scenarios, triggers, users, broadcasts)
// viewer: read-only

export const PERMISSION_MATRIX: Record<OperatorRole, ReadonlySet<string>> = {
  admin: new Set([
    "read",
    "write",
    "delete",
    "manage_operators",
    "manage_accounts",
    "view_audit_logs",
    "manage_settings",
    "manage_api_keys",
  ]),
  operator: new Set([
    "read",
    "write",
    "delete",
  ]),
  viewer: new Set([
    "read",
  ]),
} as const;

export function hasPermission(
  role: OperatorRole,
  permission: string,
): boolean {
  return PERMISSION_MATRIX[role]?.has(permission) ?? false;
}

// ────────── Middleware: requireAuth ──────────

export function requireAuth(): MiddlewareHandler<{ Bindings: Env }> {
  return async (c, next) => {
    const authHeader = c.req.header("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return c.json({ error: "Authorization header required" }, 401);
    }

    const token = authHeader.slice(7);
    const result = await verifyAccessToken(token, c.env.JWT_SECRET);

    if (!result.ok) {
      const status = result.error.code === "TOKEN_EXPIRED" ? 401 : 401;
      return c.json({ error: result.error.message }, status);
    }

    const operator: AuthOperator = {
      id: result.value.sub,
      role: result.value.role as OperatorRole,
      accountId: result.value.accountId,
      totpVerified: result.value.totpVerified,
    };

    c.set("operator" as never, operator as never);
    await next();
  };
}

// ────────── Middleware: requireRole ──────────

export function requireRole(
  allowedRoles: OperatorRole[],
): MiddlewareHandler<{ Bindings: Env }> {
  return async (c, next) => {
    const operator = c.get("operator" as never) as AuthOperator | undefined;
    if (!operator) {
      return c.json({ error: "Authentication required" }, 401);
    }

    if (!allowedRoles.includes(operator.role)) {
      return c.json(
        { error: "Forbidden: insufficient role permissions" },
        403,
      );
    }

    await next();
  };
}

// ────────── Middleware: requireTotpVerified ──────────

export function requireTotpVerified(): MiddlewareHandler<{ Bindings: Env }> {
  return async (c, next) => {
    const operator = c.get("operator" as never) as AuthOperator | undefined;
    if (!operator) {
      return c.json({ error: "Authentication required" }, 401);
    }

    if (!operator.totpVerified) {
      return c.json(
        { error: "TOTP verification required" },
        403,
      );
    }

    await next();
  };
}

// ────────── Middleware: requirePermission ──────────

export function requirePermission(
  permission: string,
): MiddlewareHandler<{ Bindings: Env }> {
  return async (c, next) => {
    const operator = c.get("operator" as never) as AuthOperator | undefined;
    if (!operator) {
      return c.json({ error: "Authentication required" }, 401);
    }

    if (!hasPermission(operator.role, permission)) {
      return c.json(
        { error: `Forbidden: missing permission '${permission}'` },
        403,
      );
    }

    await next();
  };
}

// ────────── Middleware: requireAccountAccess ──────────
// adminロールはアクセス制御をバイパス（全アカウントにアクセス可能）
// operator/viewerはoperator_account_accessテーブルに基づくアクセス制御

export function requireAccountAccess(): MiddlewareHandler<{ Bindings: Env }> {
  return async (c, next) => {
    const operator = c.get("operator" as never) as AuthOperator | undefined;
    if (!operator) {
      return c.json({ error: "Authentication required" }, 401);
    }

    // adminは全アカウントにアクセス可能
    if (operator.role === "admin") {
      await next();
      return;
    }

    const accountId = operator.accountId;
    if (!accountId) {
      return c.json({ error: "Account context required" }, 403);
    }

    const mgr = createAccountManager({
      db: c.env.DB,
      kv: c.env.KV,
      now: () => Math.floor(Date.now() / 1000),
      metaAppSecret: c.env.META_APP_SECRET,
      metaApiVersion: c.env.META_API_VERSION,
      encryptionKey: c.env.ENCRYPTION_KEY,
    });

    const result = await mgr.hasAccess(operator.id, accountId);
    if (!result.ok || !result.value) {
      return c.json(
        { error: "Forbidden: no access to this account" },
        403,
      );
    }

    await next();
  };
}
