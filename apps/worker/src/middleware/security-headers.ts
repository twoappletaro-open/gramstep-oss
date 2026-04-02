import type { MiddlewareHandler } from "hono";
import type { Env } from "../env.js";

export function securityHeaders(): MiddlewareHandler<{ Bindings: Env }> {
  return async (c, next) => {
    const origin = c.req.header("Origin");
    const allowedOrigin = c.env.DASHBOARD_URL;

    // CORS preflight
    if (c.req.method === "OPTIONS") {
      if (origin && allowedOrigin && origin === allowedOrigin) {
        return new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key, x-account-id",
            "Access-Control-Max-Age": "86400",
          },
        });
      }
      return new Response(null, { status: 204 });
    }

    await next();

    // Security headers
    c.res.headers.set("X-Frame-Options", "DENY");
    c.res.headers.set("X-Content-Type-Options", "nosniff");
    c.res.headers.set(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains",
    );
    c.res.headers.set(
      "Content-Security-Policy",
      "default-src 'none'; frame-ancestors 'none'",
    );

    // CORS for allowed origin
    if (origin && allowedOrigin && origin === allowedOrigin) {
      c.res.headers.set("Access-Control-Allow-Origin", origin);
      c.res.headers.set("Access-Control-Allow-Credentials", "true");
    }
  };
}
