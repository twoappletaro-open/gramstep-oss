import { Hono } from "hono";
import type { Env } from "../../env.js";
import {
  CreateConversionPointInputSchema,
  UpdateConversionPointInputSchema,
  RecordConversionEventInputSchema,
} from "@gramstep/shared";
import { createCVTracker } from "../../services/cv-tracker.js";

export const conversionRoutes = new Hono<{ Bindings: Env }>();

// --- Conversion Points CRUD ---

conversionRoutes.get("/points", async (c) => {
  const accountId = c.get("accountId" as never) as string;
  const tracker = createCVTracker({ db: c.env.DB, now: () => Math.floor(Date.now() / 1000) });
  const result = await tracker.listPoints(accountId);
  if (!result.ok) {
    return c.json({ error: result.error.message }, 500);
  }
  return c.json(result.value, 200);
});

conversionRoutes.post("/points", async (c) => {
  const accountId = c.get("accountId" as never) as string;
  const body = await c.req.json();
  const parsed = CreateConversionPointInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "入力が不正です", details: parsed.error.issues }, 400);
  }

  const tracker = createCVTracker({ db: c.env.DB, now: () => Math.floor(Date.now() / 1000) });
  const result = await tracker.createPoint(accountId, parsed.data);
  if (!result.ok) {
    return c.json({ error: result.error.message }, 500);
  }
  return c.json(result.value, 201);
});

conversionRoutes.get("/points/:id", async (c) => {
  const accountId = c.get("accountId" as never) as string;
  const pointId = c.req.param("id");
  const tracker = createCVTracker({ db: c.env.DB, now: () => Math.floor(Date.now() / 1000) });
  const result = await tracker.getPoint(pointId, accountId);
  if (!result.ok) {
    const status = result.error.code === "NOT_FOUND" ? 404 : 500;
    return c.json({ error: result.error.message }, status);
  }
  return c.json(result.value, 200);
});

conversionRoutes.put("/points/:id", async (c) => {
  const accountId = c.get("accountId" as never) as string;
  const pointId = c.req.param("id");
  const body = await c.req.json();
  const parsed = UpdateConversionPointInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "入力が不正です", details: parsed.error.issues }, 400);
  }

  const tracker = createCVTracker({ db: c.env.DB, now: () => Math.floor(Date.now() / 1000) });
  const result = await tracker.updatePoint(pointId, accountId, parsed.data);
  if (!result.ok) {
    const status = result.error.code === "NOT_FOUND" ? 404 : 500;
    return c.json({ error: result.error.message }, status);
  }
  return c.json(result.value, 200);
});

conversionRoutes.delete("/points/:id", async (c) => {
  const accountId = c.get("accountId" as never) as string;
  const pointId = c.req.param("id");
  const tracker = createCVTracker({ db: c.env.DB, now: () => Math.floor(Date.now() / 1000) });
  const result = await tracker.deletePoint(pointId, accountId);
  if (!result.ok) {
    return c.json({ error: result.error.message }, 500);
  }
  return c.newResponse(null, 204);
});

// --- Conversion Events ---

conversionRoutes.post("/events", async (c) => {
  const accountId = c.get("accountId" as never) as string;
  const body = await c.req.json();
  const parsed = RecordConversionEventInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "入力が不正です", details: parsed.error.issues }, 400);
  }

  const tracker = createCVTracker({ db: c.env.DB, now: () => Math.floor(Date.now() / 1000) });
  const result = await tracker.recordEvent(accountId, parsed.data);
  if (!result.ok) {
    const status = result.error.code === "NOT_FOUND" ? 404 : 500;
    return c.json({ error: result.error.message }, status);
  }
  return c.json(result.value, 201);
});

conversionRoutes.get("/events", async (c) => {
  const accountId = c.get("accountId" as never) as string;
  const pointId = c.req.query("point_id");
  const igUserId = c.req.query("ig_user_id");
  const scenarioId = c.req.query("scenario_id");
  const limit = Number(c.req.query("limit") ?? "50");

  const tracker = createCVTracker({ db: c.env.DB, now: () => Math.floor(Date.now() / 1000) });
  const result = await tracker.listEvents(accountId, pointId, igUserId, scenarioId, limit);
  if (!result.ok) {
    return c.json({ error: result.error.message }, 500);
  }
  return c.json(result.value, 200);
});

// --- Reports ---

conversionRoutes.get("/report", async (c) => {
  const accountId = c.get("accountId" as never) as string;
  const scenarioId = c.req.query("scenario_id");

  const tracker = createCVTracker({ db: c.env.DB, now: () => Math.floor(Date.now() / 1000) });
  const result = await tracker.getReport(accountId, scenarioId);
  if (!result.ok) {
    return c.json({ error: result.error.message }, 500);
  }
  return c.json(result.value, 200);
});
