import type { MessageLog } from "@gramstep/db";
import type { Result, AppError } from "@gramstep/shared";
import { ok, err, createAppError } from "@gramstep/shared";

// ────────── Types ──────────

export interface ArchiveSearchFilters {
  accountId: string;
  dateFrom?: number;
  dateTo?: number;
  keyword?: string;
  igUserId?: string;
  direction?: string;
  messageType?: string;
  sourceType?: string;
  page?: number;
  perPage?: number;
}

export interface ArchiveSearchResult {
  logs: MessageLog[];
  total: number;
  page: number;
  perPage: number;
}

export interface ArchiveSearchService {
  searchArchive(
    filters: ArchiveSearchFilters,
  ): Promise<Result<ArchiveSearchResult, AppError>>;
  generateCsv(
    filters: ArchiveSearchFilters,
  ): Promise<Result<string, AppError>>;
}

export interface ArchiveSearchDeps {
  r2: R2Bucket;
}

// ────────── Constants ──────────

const MAX_DATE_RANGE_DAYS = 31;
const DEFAULT_PER_PAGE = 20;
const MS_PER_DAY = 86400 * 1000;

// ────────── Helpers ──────────


function formatDate(year: number, month: number, day: number): string {
  const m = String(month).padStart(2, "0");
  const d = String(day).padStart(2, "0");
  return `${year}-${m}-${d}`;
}

function generateDateRange(from: number, to: number): string[] {
  const dates: string[] = [];
  const startMs = from * 1000;
  const endMs = to * 1000;

  let current = new Date(startMs);
  current.setUTCHours(0, 0, 0, 0);

  const endDate = new Date(endMs);
  endDate.setUTCHours(23, 59, 59, 999);

  while (current.getTime() <= endDate.getTime()) {
    dates.push(formatDate(
      current.getUTCFullYear(),
      current.getUTCMonth() + 1,
      current.getUTCDate(),
    ));
    current = new Date(current.getTime() + MS_PER_DAY);
  }

  return dates;
}

function matchesFilters(log: MessageLog, filters: ArchiveSearchFilters): boolean {
  if (filters.dateFrom !== undefined && log.created_at < filters.dateFrom) {
    return false;
  }
  if (filters.dateTo !== undefined && log.created_at > filters.dateTo) {
    return false;
  }
  if (filters.keyword && (!log.content || !log.content.includes(filters.keyword))) {
    return false;
  }
  if (filters.igUserId && log.ig_user_id !== filters.igUserId) {
    return false;
  }
  if (filters.direction && log.direction !== filters.direction) {
    return false;
  }
  if (filters.messageType && log.message_type !== filters.messageType) {
    return false;
  }
  if (filters.sourceType && log.source_type !== filters.sourceType) {
    return false;
  }
  return true;
}

function escapeCsvField(value: string | null | number): string {
  if (value === null || value === undefined) return "";
  let str = String(value);
  // CSV injection prevention: prefix dangerous leading characters
  const firstChar = str[0];
  if (str.length > 0 && firstChar !== undefined && "=+-@\t\r".includes(firstChar)) {
    str = `'${str}`;
  }
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// ────────── Factory ──────────

export function createArchiveSearchService(
  deps: ArchiveSearchDeps,
): ArchiveSearchService {
  const { r2 } = deps;

  async function fetchAndParseLogs(
    accountId: string,
    dateFrom: number,
    dateTo: number,
    filters: ArchiveSearchFilters,
  ): Promise<MessageLog[]> {
    const dates = generateDateRange(dateFrom, dateTo);
    const allLogs: MessageLog[] = [];

    // Group dates by month for R2 prefix listing
    const monthPrefixes = new Set<string>();
    for (const date of dates) {
      monthPrefixes.add(date.slice(0, 7)); // YYYY-MM
    }

    const dateSet = new Set(dates);

    for (const month of monthPrefixes) {
      const prefix = `archive/${accountId}/messages/${month}/`;
      let cursor: string | undefined;
      do {
        const listResult = await r2.list({ prefix, cursor });
        cursor = listResult.truncated ? listResult.cursor : undefined;

      for (const obj of listResult.objects) {
        // Extract date from key: archive/{account}/messages/YYYY-MM/YYYY-MM-DD.jsonl
        const dateMatch = obj.key.match(/(\d{4}-\d{2}-\d{2})\.jsonl$/);
        const matchedDate = dateMatch?.[1];
        if (!matchedDate || !dateSet.has(matchedDate)) continue;

        const objBody = await r2.get(obj.key);
        if (!objBody) continue;

        const text = await objBody.text();
        const lines = text.split("\n").filter((l) => l.length > 0);

        for (const line of lines) {
          try {
            const log = JSON.parse(line) as MessageLog;
            if (matchesFilters(log, filters)) {
              allLogs.push(log);
            }
          } catch {
            // Skip malformed JSONL lines
          }
        }
      }
      } while (cursor);
    }

    // Sort by created_at descending
    allLogs.sort((a, b) => b.created_at - a.created_at);
    return allLogs;
  }

  return {
    async searchArchive(filters) {
      if (filters.dateFrom === undefined || filters.dateTo === undefined) {
        return err(
          createAppError(
            "VALIDATION_ERROR",
            "dateFrom and dateTo are required for archive search",
          ),
        );
      }

      if (filters.dateFrom > filters.dateTo) {
        return err(
          createAppError("VALIDATION_ERROR", "dateFrom must be <= dateTo"),
        );
      }

      const rangeDays = (filters.dateTo - filters.dateFrom) / 86400;
      if (rangeDays > MAX_DATE_RANGE_DAYS) {
        return err(
          createAppError(
            "VALIDATION_ERROR",
            `Date range must not exceed ${MAX_DATE_RANGE_DAYS} days`,
          ),
        );
      }

      try {
        const page = filters.page ?? 1;
        const perPage = filters.perPage ?? DEFAULT_PER_PAGE;

        const allLogs = await fetchAndParseLogs(
          filters.accountId,
          filters.dateFrom,
          filters.dateTo,
          filters,
        );

        const total = allLogs.length;
        const offset = (page - 1) * perPage;
        const paginated = allLogs.slice(offset, offset + perPage);

        return ok({
          logs: paginated,
          total,
          page,
          perPage,
        });
      } catch (e: unknown) {
        return err(
          createAppError("INTERNAL_ERROR", e instanceof Error ? e.message : "Archive search failed"),
        );
      }
    },

    async generateCsv(filters) {
      if (filters.dateFrom === undefined || filters.dateTo === undefined) {
        return err(
          createAppError(
            "VALIDATION_ERROR",
            "dateFrom and dateTo are required for CSV export",
          ),
        );
      }

      const rangeDays = (filters.dateTo - filters.dateFrom) / 86400;
      if (rangeDays > MAX_DATE_RANGE_DAYS) {
        return err(
          createAppError(
            "VALIDATION_ERROR",
            `Date range must not exceed ${MAX_DATE_RANGE_DAYS} days`,
          ),
        );
      }

      try {
        const allLogs = await fetchAndParseLogs(
          filters.accountId,
          filters.dateFrom,
          filters.dateTo,
          filters,
        );

      const headers = [
        "id", "account_id", "ig_user_id", "direction", "message_type",
        "content", "source_type", "source_id", "delivery_status",
        "ig_message_id", "is_test", "is_deleted", "created_at",
      ];

      const rows = allLogs.map((log) =>
        [
          escapeCsvField(log.id),
          escapeCsvField(log.account_id),
          escapeCsvField(log.ig_user_id),
          escapeCsvField(log.direction),
          escapeCsvField(log.message_type),
          escapeCsvField(log.content),
          escapeCsvField(log.source_type),
          escapeCsvField(log.source_id),
          escapeCsvField(log.delivery_status),
          escapeCsvField(log.ig_message_id),
          escapeCsvField(log.is_test),
          escapeCsvField(log.is_deleted),
          escapeCsvField(log.created_at),
        ].join(","),
      );

      return ok([headers.join(","), ...rows].join("\n"));
      } catch (e: unknown) {
        return err(
          createAppError("INTERNAL_ERROR", e instanceof Error ? e.message : "CSV generation failed"),
        );
      }
    },
  };
}
