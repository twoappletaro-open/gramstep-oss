import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../../env.js";
import { createArchiveSearchService } from "../../services/archive-search.js";

export const archiveRoutes = new Hono<{ Bindings: Env }>();

const ArchiveSearchQuerySchema = z.object({
  dateFrom: z.coerce.number().int(),
  dateTo: z.coerce.number().int(),
  keyword: z.string().optional(),
  igUserId: z.string().optional(),
  direction: z.string().optional(),
  messageType: z.string().optional(),
  sourceType: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(20),
});

// GET /api/archive/search - R2アーカイブ検索
archiveRoutes.get("/search", async (c) => {
  const accountId = c.get("accountId" as never) as string | undefined;
  if (!accountId) {
    return c.json({ error: "Unauthorized: missing accountId" }, 401);
  }

  const parsed = ArchiveSearchQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: "Invalid query parameters", details: parsed.error.issues }, 400);
  }

  const svc = createArchiveSearchService({ r2: c.env.R2 });
  const result = await svc.searchArchive({ ...parsed.data, accountId });
  if (!result.ok) {
    const status = result.error.code === "VALIDATION_ERROR" ? 400 : 500;
    return c.json({ error: result.error.message }, status);
  }
  return c.json(result.value);
});

// GET /api/archive/csv - R2アーカイブCSVダウンロード
archiveRoutes.get("/csv", async (c) => {
  const accountId = c.get("accountId" as never) as string | undefined;
  if (!accountId) {
    return c.json({ error: "Unauthorized: missing accountId" }, 401);
  }

  const parsed = ArchiveSearchQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: "Invalid query parameters", details: parsed.error.issues }, 400);
  }

  const svc = createArchiveSearchService({ r2: c.env.R2 });
  const result = await svc.generateCsv({ ...parsed.data, accountId });
  if (!result.ok) {
    const status = result.error.code === "VALIDATION_ERROR" ? 400 : 500;
    return c.json({ error: result.error.message }, status);
  }

  return new Response(result.value, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="archive-${accountId}-${parsed.data.dateFrom}-${parsed.data.dateTo}.csv"`,
    },
  });
});
