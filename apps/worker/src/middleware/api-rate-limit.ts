import type { MiddlewareHandler } from "hono";
import type { Env } from "../env.js";

export interface ApiRateLimitOptions {
  maxRequests: number;
  windowSeconds: number;
}

interface BucketEntry {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, BucketEntry>();

/** テスト用: バケットをリセットする */
export function resetRateLimitBuckets(): void {
  buckets.clear();
}

function getClientKey(
  ip: string | undefined,
  apiKey: string | undefined,
): string {
  if (apiKey) return `apikey:${apiKey}`;
  return `ip:${ip ?? "unknown"}`;
}

export function apiRateLimit(
  options: ApiRateLimitOptions,
): MiddlewareHandler<{ Bindings: Env }> {
  return async (c, next) => {
    const ip = c.req.header("CF-Connecting-IP");
    const apiKey = c.req.header("X-API-Key");
    const key = getClientKey(ip, apiKey);

    const now = Math.floor(Date.now() / 1000);
    let entry = buckets.get(key);

    if (!entry || now >= entry.resetAt) {
      entry = { count: 0, resetAt: now + options.windowSeconds };
      buckets.set(key, entry);
    }

    entry.count += 1;

    if (entry.count > options.maxRequests) {
      const retryAfter = entry.resetAt - now;
      return c.json(
        { error: "Too many requests" },
        {
          status: 429,
          headers: { "Retry-After": String(retryAfter) },
        },
      );
    }

    await next();
  };
}
