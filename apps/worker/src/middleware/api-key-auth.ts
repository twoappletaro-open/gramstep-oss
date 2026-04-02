import type { MiddlewareHandler } from "hono";
import type { Env } from "../env.js";

export interface ApiKeyInfo {
  id: string;
  accountId: string;
  scopes: string[];
}

export function requireApiKeyAuth(): MiddlewareHandler<{ Bindings: Env }> {
  return async (c, next) => {
    const apiKey = c.req.header("X-API-Key");
    if (!apiKey) {
      return c.json({ error: "API key required (X-API-Key header)" }, 401);
    }

    const keyHash = await hashApiKey(apiKey);

    const record = await c.env.DB.prepare(
      "SELECT id, account_id, scopes, expires_at, is_active FROM api_keys WHERE key_hash = ?",
    )
      .bind(keyHash)
      .first<{
        id: string;
        account_id: string;
        scopes: string;
        expires_at: number | null;
        is_active: number;
      }>();

    if (!record) {
      return c.json({ error: "Invalid API key" }, 401);
    }

    if (!record.is_active) {
      return c.json({ error: "API key is disabled" }, 401);
    }

    const now = Math.floor(Date.now() / 1000);
    if (record.expires_at !== null && record.expires_at <= now) {
      return c.json({ error: "API key has expired" }, 401);
    }

    const scopes: string[] = JSON.parse(record.scopes);
    const info: ApiKeyInfo = {
      id: record.id,
      accountId: record.account_id,
      scopes,
    };

    c.set("apiKey" as never, info as never);
    c.set("operator" as never, {
      id: `apikey:${record.id}`,
      role: "operator",
      accountId: record.account_id,
      totpVerified: false,
    } as never);

    await next();
  };
}

async function hashApiKey(key: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(key);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
