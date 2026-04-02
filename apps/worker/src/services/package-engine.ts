import type { Template as TemplateRow } from "@gramstep/db";
import { generateId } from "@gramstep/db";
import {
  createAppError,
  err,
  ok,
  type AppError,
  type CreatePackageInput,
  type PackageButton,
  type Result,
  type UpdatePackageInput,
} from "@gramstep/shared";
import { packageTemplateType, parsePackageBody, serializePackageBody } from "./package-format.js";

export interface PackageRecord {
  id: string;
  name: string;
  text: string;
  buttons: PackageButton[];
  is_active: boolean;
  version: number;
  created_at: number;
  updated_at: number;
}

export interface PackageEngineService {
  listPackages(accountId: string): Promise<Result<PackageRecord[], AppError>>;
  getPackage(id: string, accountId: string): Promise<Result<PackageRecord, AppError>>;
  createPackage(accountId: string, input: CreatePackageInput): Promise<Result<PackageRecord, AppError>>;
  updatePackage(id: string, accountId: string, input: UpdatePackageInput): Promise<Result<PackageRecord, AppError>>;
  deletePackage(id: string, accountId: string): Promise<Result<void, AppError>>;
}

export interface PackageEngineDeps {
  db: D1Database;
}

function toPackageRecord(row: TemplateRow): PackageRecord | null {
  const body = parsePackageBody(row.body);
  if (!body) return null;
  return {
    id: row.id,
    name: row.name,
    text: body.text,
    buttons: body.buttons,
    is_active: row.is_active === 1,
    version: row.version,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function createPackageEngine(deps: PackageEngineDeps): PackageEngineService {
  const { db } = deps;

  function wrapD1<T>(fn: () => Promise<Result<T, AppError>>): Promise<Result<T, AppError>> {
    return fn().catch((e: unknown) =>
      err(createAppError("D1_ERROR", e instanceof Error ? e.message : "Database error")),
    );
  }

  return {
    listPackages: (accountId) =>
      wrapD1(async () => {
        const result = await db
          .prepare("SELECT * FROM templates WHERE account_id = ? ORDER BY created_at DESC")
          .bind(accountId)
          .all<TemplateRow>();

        return ok(
          result.results
            .map(toPackageRecord)
            .filter((value): value is PackageRecord => value !== null),
        );
      }),

    getPackage: (id, accountId) =>
      wrapD1(async () => {
        const row = await db
          .prepare("SELECT * FROM templates WHERE id = ? AND account_id = ?")
          .bind(id, accountId)
          .first<TemplateRow>();

        const record = row ? toPackageRecord(row) : null;
        if (!record) {
          return err(createAppError("NOT_FOUND", "Package not found"));
        }
        return ok(record);
      }),

    createPackage: (accountId, input) =>
      wrapD1(async () => {
        const id = generateId();
        const now = Math.floor(Date.now() / 1000);
        const body = serializePackageBody(input.text, input.buttons);

        await db
          .prepare(
            `INSERT INTO templates (id, account_id, name, type, body, variables, version, is_active, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, '[]', 1, 1, ?, ?)`,
          )
          .bind(
            id,
            accountId,
            input.name,
            packageTemplateType(input.buttons),
            body,
            now,
            now,
          )
          .run();

        return ok({
          id,
          name: input.name,
          text: input.text,
          buttons: input.buttons,
          is_active: true,
          version: 1,
          created_at: now,
          updated_at: now,
        });
      }),

    updatePackage: (id, accountId, input) =>
      wrapD1(async () => {
        const existing = await db
          .prepare("SELECT * FROM templates WHERE id = ? AND account_id = ?")
          .bind(id, accountId)
          .first<TemplateRow>();
        if (!existing) {
          return err(createAppError("NOT_FOUND", "Package not found"));
        }

        const existingRecord = toPackageRecord(existing);
        if (!existingRecord) {
          return err(createAppError("NOT_FOUND", "Package not found"));
        }

        if (existing.version !== input.version) {
          return err(createAppError("CONFLICT", "Version mismatch"));
        }

        const nextName = input.name ?? existingRecord.name;
        const nextText = input.text ?? existingRecord.text;
        const nextButtons = input.buttons ?? existingRecord.buttons;
        const nextIsActive = input.is_active ?? existingRecord.is_active;
        const nextBody = serializePackageBody(nextText, nextButtons);
        const nextVersion = existing.version + 1;
        const now = Math.floor(Date.now() / 1000);

        const updateResult = await db
          .prepare(
            `UPDATE templates
             SET name = ?, type = ?, body = ?, is_active = ?, version = ?, updated_at = ?
             WHERE id = ? AND account_id = ? AND version = ?`,
          )
          .bind(
            nextName,
            packageTemplateType(nextButtons),
            nextBody,
            nextIsActive ? 1 : 0,
            nextVersion,
            now,
            id,
            accountId,
            input.version,
          )
          .run();

        if (updateResult.meta.changes === 0) {
          return err(createAppError("CONFLICT", "Version mismatch (concurrent update)"));
        }

        return ok({
          id,
          name: nextName,
          text: nextText,
          buttons: nextButtons,
          is_active: nextIsActive,
          version: nextVersion,
          created_at: existing.created_at,
          updated_at: now,
        });
      }),

    deletePackage: (id, accountId) =>
      wrapD1(async () => {
        const existing = await db
          .prepare("SELECT * FROM templates WHERE id = ? AND account_id = ?")
          .bind(id, accountId)
          .first<TemplateRow>();
        if (!existing || !toPackageRecord(existing)) {
          return err(createAppError("NOT_FOUND", "Package not found"));
        }

        await db
          .prepare("DELETE FROM templates WHERE id = ? AND account_id = ?")
          .bind(id, accountId)
          .run();

        return ok(undefined);
      }),
  };
}

