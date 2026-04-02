import { Hono } from "hono";
import type { Env } from "../../env.js";
import {
  UpdateUserInputSchema,
  UserFiltersSchema,
  UpdateMetadataInputSchema,
  AddTagInputSchema,
} from "@gramstep/shared";
import {
  listUsers,
  getUser,
  updateUser,
  addTag,
  removeTag,
  updateMetadata,
  setOptOut,
  setBlocked,
  resetFirstTriggerHistory,
  registerUserAsTestAccount,
  unregisterUserAsTestAccount,
} from "../../services/user-manager.js";
import { exportCsv } from "../../services/csv-manager.js";
import type { CsvExportFilters } from "../../services/csv-manager.js";
import { importCsv } from "../../services/csv-manager.js";
import { fetchAndStoreProfileImage } from "../../services/profile-image.js";

const ERROR_STATUS_MAP = {
  NOT_FOUND: 404,
  VALIDATION_ERROR: 400,
  CONFLICT: 409,
  EXTERNAL_API_ERROR: 502,
  FORBIDDEN: 403,
} as const;

type UserErrorStatus = (typeof ERROR_STATUS_MAP)[keyof typeof ERROR_STATUS_MAP] | 500;

function errorStatus(code: string): UserErrorStatus {
  return ERROR_STATUS_MAP[code as keyof typeof ERROR_STATUS_MAP] ?? 500;
}

export const userRoutes = new Hono<{ Bindings: Env }>();

// GET /api/users
userRoutes.get("/", async (c) => {
  const accountId = c.get("accountId" as never) as string;
  const parsed = UserFiltersSchema.safeParse(Object.fromEntries(new URL(c.req.url).searchParams));
  if (!parsed.success) {
    return c.json({ error: "Invalid filters", details: parsed.error.flatten() }, 400);
  }

  const result = await listUsers(c.env.DB, accountId, parsed.data);
  if (!result.ok) {
    return c.json({ error: result.error.message }, errorStatus(result.error.code));
  }
  return c.json(result.value);
});

// GET /api/users/export — must be before /:id to avoid matching "export" as id
userRoutes.get("/export", async (c) => {
  const accountId = c.get("accountId" as never) as string;
  const params = Object.fromEntries(new URL(c.req.url).searchParams);
  const filters: CsvExportFilters = {};
  if (params.score_min) filters.score_min = Number(params.score_min);
  if (params.score_max) filters.score_max = Number(params.score_max);
  if (params.follower_status) filters.follower_status = params.follower_status;
  if (params.last_interaction_after) filters.last_interaction_after = Number(params.last_interaction_after);
  if (params.is_opted_out) filters.is_opted_out = params.is_opted_out === "true";
  if (params.tags) filters.tags = params.tags.split(",");

  const result = await exportCsv(c.env.DB, accountId, filters);
  if (!result.ok) {
    return c.json({ error: result.error.message }, errorStatus(result.error.code));
  }
  return new Response(result.value, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": "attachment; filename=users.csv",
    },
  });
});

// POST /api/users/import — must be before /:id to avoid matching "import" as id
userRoutes.post("/import", async (c) => {
  const accountId = c.get("accountId" as never) as string;
  const contentType = c.req.header("content-type") ?? "";

  let csvContent: string;
  if (contentType.includes("multipart/form-data")) {
    const formData = await c.req.formData();
    const file = formData.get("file");
    if (!file || !(file instanceof File)) {
      return c.json({ error: "CSV file is required" }, 400);
    }
    csvContent = await file.text();
  } else {
    csvContent = await c.req.text();
  }

  const result = await importCsv(c.env.DB, accountId, csvContent);
  if (!result.ok) {
    return c.json({ error: result.error.message }, errorStatus(result.error.code));
  }
  return c.json(result.value);
});

// GET /api/users/:id
userRoutes.get("/:id", async (c) => {
  const accountId = c.get("accountId" as never) as string;
  const userId = c.req.param("id");

  const result = await getUser(c.env.DB, accountId, userId);
  if (!result.ok) {
    return c.json({ error: result.error.message }, errorStatus(result.error.code));
  }
  return c.json(result.value);
});

// PUT /api/users/:id
userRoutes.put("/:id", async (c) => {
  const accountId = c.get("accountId" as never) as string;
  const userId = c.req.param("id");
  const body = await c.req.json();
  const parsed = UpdateUserInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid input", details: parsed.error.flatten() }, 400);
  }

  const result = await updateUser(c.env.DB, accountId, userId, parsed.data);
  if (!result.ok) {
    return c.json({ error: result.error.message }, errorStatus(result.error.code));
  }
  return c.body(null, 204);
});

// POST /api/users/:id/tags
userRoutes.post("/:id/tags", async (c) => {
  const accountId = c.get("accountId" as never) as string;
  const userId = c.req.param("id");
  const body = await c.req.json();
  const parsed = AddTagInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid input", details: parsed.error.flatten() }, 400);
  }

  const result = await addTag(c.env.DB, accountId, userId, parsed.data.tag_id);
  if (!result.ok) {
    return c.json({ error: result.error.message }, errorStatus(result.error.code));
  }
  return c.body(null, 201);
});

// DELETE /api/users/:id/tags/:tagId
userRoutes.delete("/:id/tags/:tagId", async (c) => {
  const userId = c.req.param("id");
  const tagId = c.req.param("tagId");

  const result = await removeTag(c.env.DB, userId, tagId);
  if (!result.ok) {
    return c.json({ error: result.error.message }, errorStatus(result.error.code));
  }
  return c.body(null, 204);
});

// PUT /api/users/:id/metadata
userRoutes.put("/:id/metadata", async (c) => {
  const userId = c.req.param("id");
  const body = await c.req.json();
  const parsed = UpdateMetadataInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid input", details: parsed.error.flatten() }, 400);
  }

  const result = await updateMetadata(c.env.DB, userId, parsed.data.key, parsed.data.value);
  if (!result.ok) {
    return c.json({ error: result.error.message }, errorStatus(result.error.code));
  }
  return c.body(null, 204);
});

// POST /api/users/:id/opt-out
userRoutes.post("/:id/opt-out", async (c) => {
  const accountId = c.get("accountId" as never) as string;
  const userId = c.req.param("id");

  const result = await setOptOut(c.env.DB, accountId, userId, true);
  if (!result.ok) {
    return c.json({ error: result.error.message }, errorStatus(result.error.code));
  }
  return c.body(null, 204);
});

// POST /api/users/:id/opt-in
userRoutes.post("/:id/opt-in", async (c) => {
  const accountId = c.get("accountId" as never) as string;
  const userId = c.req.param("id");

  const result = await setOptOut(c.env.DB, accountId, userId, false);
  if (!result.ok) {
    return c.json({ error: result.error.message }, errorStatus(result.error.code));
  }
  return c.body(null, 204);
});

// POST /api/users/:id/block
userRoutes.post("/:id/block", async (c) => {
  const accountId = c.get("accountId" as never) as string;
  const userId = c.req.param("id");

  const result = await setBlocked(c.env.DB, accountId, userId, true);
  if (!result.ok) {
    return c.json({ error: result.error.message }, errorStatus(result.error.code));
  }
  return c.body(null, 204);
});

// POST /api/users/:id/unblock
userRoutes.post("/:id/unblock", async (c) => {
  const accountId = c.get("accountId" as never) as string;
  const userId = c.req.param("id");

  const result = await setBlocked(c.env.DB, accountId, userId, false);
  if (!result.ok) {
    return c.json({ error: result.error.message }, errorStatus(result.error.code));
  }
  return c.body(null, 204);
});

// POST /api/users/:id/reset-first-trigger-history
userRoutes.post("/:id/reset-first-trigger-history", async (c) => {
  const accountId = c.get("accountId" as never) as string;
  const userId = c.req.param("id");

  const result = await resetFirstTriggerHistory(c.env.DB, accountId, userId);
  if (!result.ok) {
    return c.json({ error: result.error.message }, errorStatus(result.error.code));
  }
  return c.json(result.value);
});

// POST /api/users/:id/test-account
userRoutes.post("/:id/test-account", async (c) => {
  const accountId = c.get("accountId" as never) as string;
  const userId = c.req.param("id");

  const result = await registerUserAsTestAccount(c.env.DB, accountId, userId);
  if (!result.ok) {
    return c.json({ error: result.error.message }, errorStatus(result.error.code));
  }
  return c.json(result.value, result.value.changed ? 201 : 200);
});

// DELETE /api/users/:id/test-account
userRoutes.delete("/:id/test-account", async (c) => {
  const accountId = c.get("accountId" as never) as string;
  const userId = c.req.param("id");

  const result = await unregisterUserAsTestAccount(c.env.DB, accountId, userId);
  if (!result.ok) {
    return c.json({ error: result.error.message }, errorStatus(result.error.code));
  }
  return c.json(result.value);
});

// POST /api/users/:id/profile-image
userRoutes.post("/:id/profile-image", async (c) => {
  const accountId = c.get("accountId" as never) as string;
  const userId = c.req.param("id");
  const body = await c.req.json<{ ig_scoped_id: string; image_url: string; force?: boolean }>();

  if (!body.ig_scoped_id || !body.image_url) {
    return c.json({ error: "ig_scoped_id and image_url are required" }, 400);
  }

  const result = await fetchAndStoreProfileImage(
    c.env.DB,
    c.env.R2,
    accountId,
    userId,
    body.ig_scoped_id,
    body.image_url,
    fetch,
    body.force ?? false,
  );
  if (!result.ok) {
    return c.json({ error: result.error.message }, errorStatus(result.error.code));
  }
  return c.json({ r2_key: result.value });
});
