import { Hono } from "hono";
import type { Env } from "../../env.js";
import { AnalyticsQuerySchema } from "@gramstep/shared";
import { getDeliveryMetrics, getAccountHealth } from "../../services/analytics-service.js";

export const analyticsRoutes = new Hono<{ Bindings: Env }>();

const ERROR_STATUS_MAP = {
  NOT_FOUND: 404,
  VALIDATION_ERROR: 400,
  D1_ERROR: 500,
} as const;

type AnalyticsErrorStatus = (typeof ERROR_STATUS_MAP)[keyof typeof ERROR_STATUS_MAP] | 500;

function errorStatus(code: string): AnalyticsErrorStatus {
  return ERROR_STATUS_MAP[code as keyof typeof ERROR_STATUS_MAP] ?? 500;
}

analyticsRoutes.get("/delivery", async (c) => {
  const accountId = c.get("accountId" as never) as string;
  const parsed = AnalyticsQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: "Invalid analytics query. Use period=7d|30d|90d or date_from/date_to in YYYY-MM-DD" }, 400);
  }

  const now = Math.floor(Date.now() / 1000);
  const result = await getDeliveryMetrics(c.env.DB, accountId, parsed.data, now);
  if (!result.ok) {
    return c.json({ error: result.error.message }, errorStatus(result.error.code));
  }
  return c.json(result.value);
});

analyticsRoutes.get("/health", async (c) => {
  const accountId = c.get("accountId" as never) as string;
  const now = Math.floor(Date.now() / 1000);

  const result = await getAccountHealth(c.env.DB, accountId, now);
  if (!result.ok) {
    return c.json({ error: result.error.message }, errorStatus(result.error.code));
  }
  return c.json(result.value);
});
