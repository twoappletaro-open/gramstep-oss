import { generateId, executeRun, executeQuery } from "@gramstep/db";
import type { Result, AppError } from "@gramstep/shared";
import { ok, err, createAppError } from "@gramstep/shared";

// ────────── Types ──────────

export interface DataDeletionDeps {
  db: D1Database;
  kv: KVNamespace;
  r2: R2Bucket;
  appSecret: string;
  baseUrl: string;
}

export interface DeletionCallbackResponse {
  url: string;
  confirmation_code: string;
}

export interface PhysicalDeletionResult {
  deletedUsers: number;
  deletedKvKeys: number;
  deletedR2Objects: number;
  errors: Array<{ accountId: string; message: string }>;
}

interface PendingDeletion {
  id: string;
  account_id: string;
  ig_user_id: string;
  ig_scoped_id: string;
  requested_at: number;
  status: string;
}

interface IgUserRow {
  id: string;
  account_id: string;
  ig_scoped_id: string;
}

export interface DataDeletionService {
  verifyAndProcessCallback(
    body: string,
    signatureHeader: string | null,
  ): Promise<Result<DeletionCallbackResponse, AppError>>;
  processPhysicalDeletion(): Promise<Result<PhysicalDeletionResult, AppError>>;
}

// ────────── Helpers ──────────

const RETENTION_DAYS = 30;

async function verifyHmacSignature(
  body: string,
  signatureHeader: string,
  secret: string,
): Promise<boolean> {
  const expectedPrefix = "sha256=";
  if (!signatureHeader.startsWith(expectedPrefix)) return false;

  const receivedHex = signatureHeader.slice(expectedPrefix.length);
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  const computedBytes = new Uint8Array(signature);
  const receivedBytes = new Uint8Array(receivedHex.length / 2);
  for (let i = 0; i < receivedBytes.length; i++) {
    receivedBytes[i] = parseInt(receivedHex.substring(i * 2, i * 2 + 2), 16);
  }

  if (computedBytes.length !== receivedBytes.length) return false;
  // Constant-time comparison
  let diff = 0;
  for (let i = 0; i < computedBytes.length; i++) {
    diff |= (computedBytes[i] ?? 0) ^ (receivedBytes[i] ?? 0);
  }
  return diff === 0;
}

// ────────── Factory ──────────

export function createDataDeletionService(deps: DataDeletionDeps): DataDeletionService {
  const { db, kv, r2, appSecret, baseUrl } = deps;

  return {
    async verifyAndProcessCallback(body, signatureHeader) {
      if (!signatureHeader) {
        return err(createAppError("UNAUTHORIZED", "Missing signature header"));
      }

      const valid = await verifyHmacSignature(body, signatureHeader, appSecret);
      if (!valid) {
        return err(createAppError("UNAUTHORIZED", "Invalid signature"));
      }

      let payload: { ig_user_id?: string };
      try {
        payload = JSON.parse(body) as { ig_user_id?: string };
      } catch {
        return err(createAppError("VALIDATION_ERROR", "Invalid JSON body"));
      }

      const igUserId = payload.ig_user_id;
      if (!igUserId) {
        return err(createAppError("VALIDATION_ERROR", "Missing ig_user_id"));
      }

      // Find ig_users matching the ig_scoped_id
      const usersResult = await executeQuery<IgUserRow>(
        db,
        "SELECT id, account_id, ig_scoped_id FROM ig_users WHERE ig_scoped_id = ?",
        igUserId,
      );

      if (!usersResult.ok) {
        return err(createAppError("D1_ERROR", usersResult.error.message));
      }

      const users = usersResult.value.results ?? [];
      const now = Math.floor(Date.now() / 1000);
      const confirmationCode = generateId();

      for (const user of users) {
        // Insert into deleted_users tracking table
        await executeRun(
          db,
          `INSERT OR IGNORE INTO deleted_users (id, account_id, ig_user_id, ig_scoped_id, requested_at, status)
           VALUES (?, ?, ?, ?, ?, 'pending')`,
          generateId(),
          user.account_id,
          user.id,
          user.ig_scoped_id,
          now,
        );

        // Logical delete: set is_deleted=1
        await executeRun(
          db,
          "UPDATE ig_users SET is_deleted = 1, updated_at = ? WHERE id = ?",
          now,
          user.id,
        );

        // Immediate KV deletion
        await kv.delete(`window:${user.account_id}:${user.id}`);

        // Immediate R2 deletion for user-specific media (scoped to this user)
        const r2List = await r2.list({ prefix: `media/${user.account_id}/received/${user.ig_scoped_id}/` });
        for (const obj of r2List.objects) {
          await r2.delete(obj.key);
        }
        await r2.delete(`media/${user.account_id}/profile/${user.ig_scoped_id}.jpg`);

        // Audit log
        await executeRun(
          db,
          `INSERT INTO audit_logs (id, operator_id, action, resource_type, resource_id, details, created_at)
           VALUES (?, 'system', 'data_deletion_requested', 'ig_user', ?, ?, ?)`,
          generateId(),
          user.id,
          JSON.stringify({
            ig_scoped_id: igUserId,
            confirmation_code: confirmationCode,
            storage_cleaned: ["kv", "r2"],
          }),
          now,
        );
      }

      return ok({
        url: `${baseUrl}/deletion?confirmation_code=${encodeURIComponent(confirmationCode)}`,
        confirmation_code: confirmationCode,
      });
    },

    async processPhysicalDeletion() {
      const now = Math.floor(Date.now() / 1000);
      const cutoff = now - RETENTION_DAYS * 24 * 60 * 60;
      const result: PhysicalDeletionResult = {
        deletedUsers: 0,
        deletedKvKeys: 0,
        deletedR2Objects: 0,
        errors: [],
      };

      // Find pending deletions past retention period
      const pendingResult = await executeQuery<PendingDeletion>(
        db,
        "SELECT * FROM deleted_users WHERE status = 'pending' AND requested_at <= ?",
        cutoff,
      );

      if (!pendingResult.ok) {
        return err(createAppError("D1_ERROR", pendingResult.error.message));
      }

      const pending = pendingResult.value.results ?? [];

      for (const record of pending) {
        try {
          // Delete all user-related D1 records
          const tables = [
            "scenario_enrollments",
            "ig_user_tags",
            "messaging_windows",
            "message_logs",
            "workflow_checkpoints",
            "trigger_fire_logs",
            "private_replies_sent",
            "comment_dm_limits",
          ];

          for (const table of tables) {
            await executeRun(db, `DELETE FROM ${table} WHERE ig_user_id = ?`, record.ig_user_id);
          }

          // Delete the ig_user record itself
          await executeRun(db, "DELETE FROM ig_users WHERE id = ?", record.ig_user_id);

          // Clean KV
          await kv.delete(`window:${record.account_id}:${record.ig_user_id}`);
          result.deletedKvKeys++;

          // Clean R2 - user profile and archived data
          await r2.delete(`media/${record.account_id}/profile/${record.ig_scoped_id}.jpg`);
          result.deletedR2Objects++;

          const r2List = await r2.list({
            prefix: `media/${record.account_id}/received/${record.ig_scoped_id}/`,
          });
          for (const obj of r2List.objects) {
            await r2.delete(obj.key);
            result.deletedR2Objects++;
          }

          // Mark deletion as completed
          await executeRun(
            db,
            "UPDATE deleted_users SET status = 'completed', physical_deleted_at = ? WHERE id = ?",
            now,
            record.id,
          );

          // Audit trail
          await executeRun(
            db,
            `INSERT INTO audit_logs (id, operator_id, action, resource_type, resource_id, details, created_at)
             VALUES (?, 'system', 'data_deletion_completed', 'ig_user', ?, ?, ?)`,
            generateId(),
            record.ig_user_id,
            JSON.stringify({
              ig_scoped_id: record.ig_scoped_id,
              tables_cleaned: [
                "ig_users",
                "scenario_enrollments",
                "ig_user_tags",
                "messaging_windows",
                "message_logs",
                "workflow_checkpoints",
                "trigger_fire_logs",
              ],
              storage_cleaned: ["kv", "r2"],
            }),
            now,
          );

          result.deletedUsers++;
        } catch (e) {
          result.errors.push({
            accountId: record.account_id,
            message: e instanceof Error ? e.message : String(e),
          });
        }
      }

      return ok(result);
    },
  };
}
