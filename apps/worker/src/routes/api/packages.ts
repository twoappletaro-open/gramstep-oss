import { Hono } from "hono";
import type { Env } from "../../env.js";
import { createPackageEngine, type PackageEngineService } from "../../services/package-engine.js";
import { CreatePackageInputSchema, UpdatePackageInputSchema } from "@gramstep/shared";

const packageRoutes = new Hono<{ Bindings: Env }>();

type PackageErrorStatus = 400 | 404 | 409 | 500;

function errorStatus(code: string): PackageErrorStatus {
  switch (code) {
    case "NOT_FOUND":
      return 404;
    case "CONFLICT":
      return 409;
    case "VALIDATION_ERROR":
      return 400;
    default:
      return 500;
  }
}

function getEngine(env: Env): PackageEngineService {
  return createPackageEngine({ db: env.DB });
}

function getAccountId(c: { get: (key: string) => unknown }): string {
  return (c.get("accountId" as never) as string) ?? "";
}

packageRoutes.get("/", async (c) => {
  const engine = getEngine(c.env);
  const accountId = getAccountId(c);
  if (!accountId) {
    return c.json({ error: "Missing accountId" }, 400);
  }

  const result = await engine.listPackages(accountId);
  if (!result.ok) {
    return c.json({ error: result.error.message }, errorStatus(result.error.code));
  }
  return c.json(result.value);
});

packageRoutes.post("/", async (c) => {
  const engine = getEngine(c.env);
  const accountId = getAccountId(c);
  if (!accountId) {
    return c.json({ error: "Missing accountId" }, 400);
  }

  const body = await c.req.json();
  const parsed = CreatePackageInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.message }, 400);
  }

  const result = await engine.createPackage(accountId, parsed.data);
  if (!result.ok) {
    return c.json({ error: result.error.message }, errorStatus(result.error.code));
  }
  return c.json(result.value, 201);
});

packageRoutes.get("/:id", async (c) => {
  const engine = getEngine(c.env);
  const accountId = getAccountId(c);
  const id = c.req.param("id");
  if (!accountId) {
    return c.json({ error: "Missing accountId" }, 400);
  }

  const result = await engine.getPackage(id, accountId);
  if (!result.ok) {
    return c.json({ error: result.error.message }, errorStatus(result.error.code));
  }
  return c.json(result.value);
});

packageRoutes.put("/:id", async (c) => {
  const engine = getEngine(c.env);
  const accountId = getAccountId(c);
  const id = c.req.param("id");
  if (!accountId) {
    return c.json({ error: "Missing accountId" }, 400);
  }

  const body = await c.req.json();
  const parsed = UpdatePackageInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.message }, 400);
  }

  const result = await engine.updatePackage(id, accountId, parsed.data);
  if (!result.ok) {
    return c.json({ error: result.error.message }, errorStatus(result.error.code));
  }
  return c.json(result.value);
});

packageRoutes.delete("/:id", async (c) => {
  const engine = getEngine(c.env);
  const accountId = getAccountId(c);
  const id = c.req.param("id");
  if (!accountId) {
    return c.json({ error: "Missing accountId" }, 400);
  }

  const result = await engine.deletePackage(id, accountId);
  if (!result.ok) {
    return c.json({ error: result.error.message }, errorStatus(result.error.code));
  }
  return c.body(null, 204);
});

export { packageRoutes };

