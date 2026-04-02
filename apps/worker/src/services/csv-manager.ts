import { ok, err, createAppError } from "@gramstep/shared";
import type { Result } from "@gramstep/shared";
import type { AppError } from "@gramstep/shared";
import type { IgUser } from "@gramstep/db";
import { generateId } from "@gramstep/db";

export interface CsvExportFilters {
  score_min?: number;
  score_max?: number;
  follower_status?: string;
  last_interaction_after?: number;
  is_opted_out?: boolean;
  tags?: string[];
}

export interface ImportResult {
  imported: number;
  skipped: number;
  errors: ImportError[];
}

export interface ImportError {
  row: number;
  message: string;
}

const CSV_EXPORT_COLUMNS = [
  "id",
  "ig_scoped_id",
  "ig_username",
  "display_name",
  "follower_status",
  "is_opted_out",
  "is_blocked",
  "score",
  "tags",
  "metadata",
  "timezone",
  "preferred_delivery_hour",
  "created_at",
  "last_interaction_at",
] as const;

function sanitizeCsvInjection(value: string): string {
  // CSV Injection対策: 式として解釈される先頭文字にシングルクォートを付与
  if (value.length > 0 && /^[=+\-@\t\r]/.test(value)) {
    return `'${value}`;
  }
  return value;
}

function escapeCsvField(value: string): string {
  const sanitized = sanitizeCsvInjection(value);
  if (sanitized.includes(",") || sanitized.includes('"') || sanitized.includes("\n")) {
    return `"${sanitized.replace(/"/g, '""')}"`;
  }
  return sanitized;
}

function buildExportFilterClauses(
  accountId: string,
  filters: CsvExportFilters,
): { whereClauses: string[]; bindings: unknown[] } {
  const whereClauses: string[] = ["account_id = ?", "is_deleted = 0"];
  const bindings: unknown[] = [accountId];

  if (filters.score_min !== undefined) {
    whereClauses.push("score >= ?");
    bindings.push(filters.score_min);
  }
  if (filters.score_max !== undefined) {
    whereClauses.push("score <= ?");
    bindings.push(filters.score_max);
  }
  if (filters.follower_status !== undefined) {
    whereClauses.push("follower_status = ?");
    bindings.push(filters.follower_status);
  }
  if (filters.last_interaction_after !== undefined) {
    whereClauses.push("last_interaction_at >= ?");
    bindings.push(filters.last_interaction_after);
  }
  if (filters.is_opted_out !== undefined) {
    whereClauses.push("is_opted_out = ?");
    bindings.push(filters.is_opted_out ? 1 : 0);
  }
  if (filters.tags !== undefined && filters.tags.length > 0) {
    const placeholders = filters.tags.map(() => "?").join(", ");
    whereClauses.push(
      `id IN (SELECT ig_user_id FROM ig_user_tags WHERE tag_id IN (${placeholders}))`,
    );
    bindings.push(...filters.tags);
  }

  return { whereClauses, bindings };
}

export async function exportCsv(
  db: D1Database,
  accountId: string,
  filters: CsvExportFilters,
): Promise<Result<string, AppError>> {
  const { whereClauses, bindings } = buildExportFilterClauses(accountId, filters);
  const where = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

  const usersResult = await db
    .prepare(`SELECT * FROM ig_users ${where} ORDER BY created_at DESC`)
    .bind(...bindings)
    .all<IgUser>();

  const users = usersResult.results;

  // Fetch all tags for this account
  const tagsResult = await db
    .prepare("SELECT * FROM tags WHERE account_id = ?")
    .bind(accountId)
    .all<{ id: string; name: string }>();

  const tagNameMap = new Map<string, string>();
  for (const tag of tagsResult.results) {
    tagNameMap.set(tag.id, tag.name);
  }

  // Fetch all user-tag assignments
  const userTagsResult = await db
    .prepare(
      `SELECT ig_user_id, tag_id FROM ig_user_tags
       WHERE ig_user_id IN (SELECT id FROM ig_users ${where})`,
    )
    .bind(...bindings)
    .all<{ ig_user_id: string; tag_id: string }>();

  const userTagsMap = new Map<string, string[]>();
  for (const ut of userTagsResult.results) {
    const tagName = tagNameMap.get(ut.tag_id);
    if (tagName) {
      const existing = userTagsMap.get(ut.ig_user_id) ?? [];
      existing.push(tagName);
      userTagsMap.set(ut.ig_user_id, existing);
    }
  }

  const lines: string[] = [];
  lines.push(CSV_EXPORT_COLUMNS.join(","));

  for (const user of users) {
    const tagNames = userTagsMap.get(user.id) ?? [];
    const row = [
      user.id,
      user.ig_scoped_id,
      user.ig_username ?? "",
      user.display_name ?? "",
      user.follower_status ?? "",
      String(user.is_opted_out),
      String(user.is_blocked),
      String(user.score),
      tagNames.join(";"),
      user.metadata,
      user.timezone ?? "",
      user.preferred_delivery_hour !== null ? String(user.preferred_delivery_hour) : "",
      String(user.created_at),
      user.last_interaction_at !== null ? String(user.last_interaction_at) : "",
    ];
    lines.push(row.map(escapeCsvField).join(","));
  }

  return ok(lines.join("\n") + "\n");
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ",") {
        fields.push(current);
        current = "";
      } else {
        current += char;
      }
    }
  }
  fields.push(current);
  return fields;
}

export async function importCsv(
  db: D1Database,
  accountId: string,
  csvContent: string,
): Promise<Result<ImportResult, AppError>> {
  const lines = csvContent.split("\n").filter((l) => l.trim().length > 0);

  if (lines.length < 2) {
    return err(createAppError("VALIDATION_ERROR", "CSV must have a header row and at least one data row"));
  }

  const headerLine = lines[0];
  if (!headerLine) {
    return err(createAppError("VALIDATION_ERROR", "CSV header is missing"));
  }
  const header = parseCsvLine(headerLine);
  const usernameIdx = header.indexOf("ig_username");
  const displayNameIdx = header.indexOf("display_name");
  const followerStatusIdx = header.indexOf("follower_status");
  const scoreIdx = header.indexOf("score");
  const tagsIdx = header.indexOf("tags");
  const metadataIdx = header.indexOf("metadata");

  if (usernameIdx === -1) {
    return err(createAppError("VALIDATION_ERROR", "CSV must contain ig_username column"));
  }

  const errors: ImportError[] = [];
  let imported = 0;
  let skipped = 0;

  for (let i = 1; i < lines.length; i++) {
    const currentLine = lines[i];
    if (!currentLine) continue;
    const fields = parseCsvLine(currentLine);
    const rowNum = i + 1;

    const igUsername = fields[usernameIdx]?.trim();
    if (!igUsername) {
      errors.push({ row: rowNum, message: "ig_username is required" });
      continue;
    }

    // Check for existing user
    const existing = await db
      .prepare("SELECT id FROM ig_users WHERE account_id = ? AND ig_username = ? AND is_deleted = 0")
      .bind(accountId, igUsername)
      .first<{ id: string }>();

    if (existing) {
      skipped++;
      continue;
    }

    const id = generateId();
    const now = Math.floor(Date.now() / 1000);
    const displayName = displayNameIdx >= 0 ? (fields[displayNameIdx]?.trim() ?? null) : null;
    const followerStatus = followerStatusIdx >= 0 ? (fields[followerStatusIdx]?.trim() || "unknown") : "unknown";
    const score = scoreIdx >= 0 ? parseInt(fields[scoreIdx] ?? "0", 10) || 0 : 0;
    const metadata = metadataIdx >= 0 ? (fields[metadataIdx]?.trim() || "{}") : "{}";

    await db
      .prepare(
        `INSERT INTO ig_users (id, account_id, ig_scoped_id, ig_username, display_name, follower_status, score, metadata, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, accountId, `import_${igUsername}`, igUsername, displayName, followerStatus, score, metadata, now, now)
      .run();

    // Handle tags
    const tagsField = tagsIdx >= 0 ? fields[tagsIdx]?.trim() : "";
    if (tagsField) {
      const tagNames = tagsField.split(";").map((t) => t.trim()).filter((t) => t.length > 0);
      for (const tagName of tagNames) {
        const tag = await db
          .prepare("SELECT id FROM tags WHERE account_id = ? AND name = ?")
          .bind(accountId, tagName)
          .first<{ id: string }>();

        if (tag) {
          await db
            .prepare("INSERT OR IGNORE INTO ig_user_tags (ig_user_id, tag_id, created_at) VALUES (?, ?, ?)")
            .bind(id, tag.id, now)
            .run();
        }
      }
    }

    imported++;
  }

  return ok({ imported, skipped, errors });
}
