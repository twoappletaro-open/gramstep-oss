import { generateId, executeRun } from "@gramstep/db";
import type { Result, AppError } from "@gramstep/shared";
import { ok, err, createAppError } from "@gramstep/shared";

// ────────── Types ──────────

export interface ApiVersionDeps {
  db: D1Database;
  metaApiVersion: string;
  fetchFn: typeof fetch;
}

export interface DeprecationStatus {
  currentVersion: string;
  apiReportedVersion: string | null;
  deprecationWarning: string | null;
  isDeprecated: boolean;
}

export interface ApiVersionService {
  getCurrentVersion(): string;
  buildApiUrl(path: string): string;
  checkDeprecationStatus(): Promise<Result<DeprecationStatus, AppError>>;
  recordDeprecationAlert(warning: string): Promise<Result<void, AppError>>;
}

// ────────── Constants ──────────

const META_GRAPH_BASE = "https://graph.instagram.com";

// ────────── Factory ──────────

export function createApiVersionService(deps: ApiVersionDeps): ApiVersionService {
  const { db, metaApiVersion, fetchFn } = deps;

  return {
    getCurrentVersion() {
      return metaApiVersion;
    },

    buildApiUrl(path: string) {
      const normalizedPath = path.startsWith("/") ? path : `/${path}`;
      return `${META_GRAPH_BASE}/${metaApiVersion}${normalizedPath}`;
    },

    async checkDeprecationStatus() {
      try {
        const url = `${META_GRAPH_BASE}/${metaApiVersion}/me?fields=id`;
        const response = await fetchFn(url, {
          method: "GET",
          headers: { Authorization: "Bearer __version_check__" },
        });

        const apiVersion = response.headers.get("x-fb-api-version");
        const deprecationWarning = response.headers.get("x-fb-deprecation-warning");

        return ok({
          currentVersion: metaApiVersion,
          apiReportedVersion: apiVersion,
          deprecationWarning,
          isDeprecated: deprecationWarning !== null,
        });
      } catch (e) {
        return err(
          createAppError(
            "EXTERNAL_API_ERROR",
            `Failed to check API version: ${e instanceof Error ? e.message : String(e)}`,
          ),
        );
      }
    },

    async recordDeprecationAlert(warning: string) {
      const now = Math.floor(Date.now() / 1000);

      const result = await executeRun(
        db,
        `INSERT INTO audit_logs (id, operator_id, action, resource_type, resource_id, details, created_at)
         VALUES (?, 'system', 'api_version_deprecation', 'system', NULL, ?, ?)`,
        generateId(),
        JSON.stringify({
          current_version: metaApiVersion,
          warning,
        }),
        now,
      );

      if (!result.ok) {
        return err(createAppError("D1_ERROR", result.error.message));
      }

      return ok(undefined);
    },
  };
}
