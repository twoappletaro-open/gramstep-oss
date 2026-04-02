import type { Result, AppError, CreateCustomVariableInput, UpdateCustomVariableInput } from "@gramstep/shared";
import type { CustomVariable, IgUser } from "@gramstep/db";
import { ok, err, createAppError } from "@gramstep/shared";
import { generateId } from "@gramstep/db";

export interface CustomVariableService {
  createVariable(accountId: string, input: CreateCustomVariableInput): Promise<Result<CustomVariable, AppError>>;
  listVariables(accountId: string): Promise<Result<CustomVariable[], AppError>>;
  updateVariable(id: string, accountId: string, input: UpdateCustomVariableInput): Promise<Result<CustomVariable, AppError>>;
  deleteVariable(id: string, accountId: string): Promise<Result<void, AppError>>;
  resolveVariable(variable: CustomVariable, user: IgUser, userTagNames: string[]): string;
}

export interface CustomVariableDeps {
  db: D1Database;
}

export function createCustomVariableService(deps: CustomVariableDeps): CustomVariableService {
  const { db } = deps;

  function wrapD1<T>(fn: () => Promise<Result<T, AppError>>): Promise<Result<T, AppError>> {
    return fn().catch((e: unknown) =>
      err(createAppError("D1_ERROR", e instanceof Error ? e.message : "Database error")),
    );
  }

  function resolveVariable(variable: CustomVariable, user: IgUser, userTagNames: string[]): string {
    if (variable.data_source === "static") {
      return variable.default_value;
    }

    if (variable.data_source === "score") {
      return String(user.score);
    }

    if (variable.data_source === "tag") {
      const tagName = variable.metadata_key ?? variable.name;
      return userTagNames.includes(tagName) ? "true" : "false";
    }

    if (variable.data_source === "metadata" && variable.metadata_key) {
      let metadata: Record<string, string> = {};
      try {
        metadata = JSON.parse(user.metadata) as Record<string, string>;
      } catch {
        // ignore
      }
      return metadata[variable.metadata_key] ?? variable.default_value;
    }

    return variable.default_value;
  }

  return {
    resolveVariable,

    createVariable: (accountId, input) =>
      wrapD1(async () => {
        if (input.data_source === "metadata" && !input.metadata_key) {
          return err(createAppError("VALIDATION_ERROR", "メタデータソースにはmetadata_keyが必要です"));
        }

        const id = generateId();
        const now = Math.floor(Date.now() / 1000);

        await db
          .prepare(
            `INSERT INTO custom_variables (id, account_id, name, default_value, data_source, metadata_key, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(id, accountId, input.name, input.default_value, input.data_source, input.metadata_key, now, now)
          .run();

        const variable: CustomVariable = {
          id,
          account_id: accountId,
          name: input.name,
          default_value: input.default_value,
          data_source: input.data_source,
          metadata_key: input.metadata_key ?? null,
          created_at: now,
          updated_at: now,
        };
        return ok(variable);
      }),

    listVariables: (accountId) =>
      wrapD1(async () => {
        const result = await db
          .prepare(`SELECT * FROM custom_variables WHERE account_id = ? ORDER BY name ASC`)
          .bind(accountId)
          .all<CustomVariable>();
        return ok(result.results);
      }),

    updateVariable: (id, accountId, input) =>
      wrapD1(async () => {
        const existing = await db
          .prepare(`SELECT * FROM custom_variables WHERE id = ? AND account_id = ?`)
          .bind(id, accountId)
          .first<CustomVariable>();

        if (!existing) {
          return err(createAppError("NOT_FOUND", "Custom variable not found"));
        }

        const newName = input.name ?? existing.name;
        const newDefaultValue = input.default_value ?? existing.default_value;
        const newDataSource = input.data_source ?? existing.data_source;
        const newMetadataKey = input.metadata_key !== undefined ? input.metadata_key : existing.metadata_key;
        const now = Math.floor(Date.now() / 1000);

        await db
          .prepare(
            `UPDATE custom_variables SET name = ?, default_value = ?, data_source = ?, metadata_key = ?, updated_at = ?
             WHERE id = ? AND account_id = ?`,
          )
          .bind(newName, newDefaultValue, newDataSource, newMetadataKey, now, id, accountId)
          .run();

        const updated: CustomVariable = {
          id,
          account_id: accountId,
          name: newName,
          default_value: newDefaultValue,
          data_source: newDataSource,
          metadata_key: newMetadataKey,
          created_at: existing.created_at,
          updated_at: now,
        };
        return ok(updated);
      }),

    deleteVariable: (id, accountId) =>
      wrapD1(async () => {
        const existing = await db
          .prepare(`SELECT * FROM custom_variables WHERE id = ? AND account_id = ?`)
          .bind(id, accountId)
          .first<CustomVariable>();

        if (!existing) {
          return err(createAppError("NOT_FOUND", "Custom variable not found"));
        }

        await db
          .prepare(`DELETE FROM custom_variables WHERE id = ? AND account_id = ?`)
          .bind(id, accountId)
          .run();

        return ok(undefined);
      }),
  };
}
