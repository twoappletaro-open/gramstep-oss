import { generateId, executeRun, executeFirst, executeQuery } from "@gramstep/db";
import type { Result, AppError } from "@gramstep/shared";
import { ok, err, createAppError } from "@gramstep/shared";
import { z } from "zod";

// ────────── Types ──────────

export interface GdprDeps {
  db: D1Database;
}

export interface ConsentRecord {
  granted: boolean;
  timestamp: number;
}

export interface ConsentStatus {
  data_processing?: ConsentRecord;
  [key: string]: ConsentRecord | undefined;
}

interface UserRow {
  id: string;
  account_id: string;
  ig_scoped_id: string;
  ig_username: string | null;
  display_name: string | null;
  score: number;
  metadata: string;
  created_at: number;
  last_interaction_at: number | null;
}

interface MessageRow {
  id: string;
  direction: string;
  message_type: string;
  content: string | null;
  created_at: number;
}

interface TagRow {
  name: string;
}

interface EnrollmentRow {
  scenario_id: string;
  status: string;
  started_at: number;
}

export interface UserDataExport {
  user: {
    ig_scoped_id: string;
    ig_username: string | null;
    display_name: string | null;
    score: number;
    created_at: number;
    last_interaction_at: number | null;
  };
  messages: MessageRow[];
  tags: string[];
  enrollments: EnrollmentRow[];
  exportedAt: string;
}

export interface GdprService {
  recordConsent(
    accountId: string,
    igUserId: string,
    consentType: string,
  ): Promise<Result<void, AppError>>;
  getConsentStatus(
    accountId: string,
    igUserId: string,
  ): Promise<Result<ConsentStatus, AppError>>;
  exportUserData(
    accountId: string,
    igUserId: string,
  ): Promise<Result<UserDataExport, AppError>>;
}

// ────────── Factory ──────────

export function createGdprService(deps: GdprDeps): GdprService {
  const { db } = deps;

  return {
    async recordConsent(accountId, igUserId, consentType) {
      const now = Math.floor(Date.now() / 1000);

      // Get current metadata
      const userResult = await executeFirst<{ metadata: string }>(
        db,
        "SELECT metadata FROM ig_users WHERE id = ? AND account_id = ?",
        igUserId,
        accountId,
      );

      if (!userResult.ok) {
        return err(createAppError("D1_ERROR", userResult.error.message));
      }

      const rawMeta = userResult.value
        ? z.record(z.unknown()).safeParse(JSON.parse(userResult.value.metadata || "{}"))
        : null;
      const currentMeta: Record<string, unknown> = rawMeta?.success ? rawMeta.data : {};

      const gdprConsent = (currentMeta.gdpr_consent ?? {}) as Record<string, ConsentRecord>;
      gdprConsent[consentType] = { granted: true, timestamp: now };
      currentMeta.gdpr_consent = gdprConsent;

      // Update user metadata with consent record
      const updateResult = await executeRun(
        db,
        "UPDATE ig_users SET metadata = ?, updated_at = ? WHERE id = ? AND account_id = ?",
        JSON.stringify(currentMeta),
        now,
        igUserId,
        accountId,
      );

      if (!updateResult.ok) {
        return err(createAppError("D1_ERROR", updateResult.error.message));
      }

      // Audit trail
      await executeRun(
        db,
        `INSERT INTO audit_logs (id, operator_id, action, resource_type, resource_id, details, created_at)
         VALUES (?, 'system', 'gdpr_consent_recorded', 'ig_user', ?, ?, ?)`,
        generateId(),
        igUserId,
        JSON.stringify({ consent_type: consentType, account_id: accountId }),
        now,
      );

      return ok(undefined);
    },

    async getConsentStatus(accountId, igUserId) {
      const userResult = await executeFirst<{ id: string; metadata: string }>(
        db,
        "SELECT id, metadata FROM ig_users WHERE id = ? AND account_id = ?",
        igUserId,
        accountId,
      );

      if (!userResult.ok) {
        return err(createAppError("D1_ERROR", userResult.error.message));
      }

      if (!userResult.value) {
        return ok({});
      }

      const metaParsed = z.record(z.unknown()).safeParse(JSON.parse(userResult.value.metadata || "{}"));
      const meta: Record<string, unknown> = metaParsed.success ? metaParsed.data : {};
      const consent = (meta.gdpr_consent ?? {}) as ConsentStatus;

      return ok(consent);
    },

    async exportUserData(accountId, igUserId) {
      // Fetch user profile
      const userResult = await executeFirst<UserRow>(
        db,
        "SELECT id, account_id, ig_scoped_id, ig_username, display_name, score, metadata, created_at, last_interaction_at FROM ig_users WHERE id = ? AND account_id = ?",
        igUserId,
        accountId,
      );

      if (!userResult.ok) {
        return err(createAppError("D1_ERROR", userResult.error.message));
      }

      if (!userResult.value) {
        return err(createAppError("NOT_FOUND", `User ${igUserId} not found`));
      }

      const user = userResult.value;

      // Fetch messages
      const messagesResult = await executeQuery<MessageRow>(
        db,
        "SELECT id, direction, message_type, content, created_at FROM message_logs WHERE ig_user_id = ? AND account_id = ? ORDER BY created_at DESC",
        igUserId,
        accountId,
      );

      const messages = messagesResult.ok ? (messagesResult.value.results ?? []) : [];

      // Fetch tags
      const tagsResult = await executeQuery<TagRow>(
        db,
        `SELECT t.name FROM tags t
         INNER JOIN ig_user_tags ut ON ut.tag_id = t.id
         WHERE ut.ig_user_id = ?`,
        igUserId,
      );

      const tags = tagsResult.ok ? (tagsResult.value.results ?? []).map((t) => t.name) : [];

      // Fetch enrollments
      const enrollmentsResult = await executeQuery<EnrollmentRow>(
        db,
        "SELECT scenario_id, status, started_at FROM scenario_enrollments WHERE ig_user_id = ? AND account_id = ?",
        igUserId,
        accountId,
      );

      const enrollments = enrollmentsResult.ok
        ? (enrollmentsResult.value.results ?? [])
        : [];

      // Audit the export
      const now = Math.floor(Date.now() / 1000);
      await executeRun(
        db,
        `INSERT INTO audit_logs (id, operator_id, action, resource_type, resource_id, details, created_at)
         VALUES (?, 'system', 'gdpr_data_export', 'ig_user', ?, ?, ?)`,
        generateId(),
        igUserId,
        JSON.stringify({ account_id: accountId }),
        now,
      );

      return ok({
        user: {
          ig_scoped_id: user.ig_scoped_id,
          ig_username: user.ig_username,
          display_name: user.display_name,
          score: user.score,
          created_at: user.created_at,
          last_interaction_at: user.last_interaction_at,
        },
        messages,
        tags,
        enrollments,
        exportedAt: new Date().toISOString(),
      });
    },
  };
}
