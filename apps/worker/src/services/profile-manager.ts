import type { Result } from "@gramstep/shared";
import type { AppError, SetIceBreakersInput, SetPersistentMenuInput } from "@gramstep/shared";
import type { IceBreaker, PersistentMenuItemRow } from "@gramstep/db";
import type { IInstagramClient } from "@gramstep/ig-sdk";
import { ok, err, createAppError } from "@gramstep/shared";
import { SetIceBreakersInputSchema, SetPersistentMenuInputSchema } from "@gramstep/shared";
import { generateId } from "@gramstep/db";

export interface IceBreakerView {
  id: string;
  accountId: string;
  question: string;
  payload: string;
  position: number;
  isSynced: boolean;
  syncedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface PersistentMenuItemView {
  id: string;
  accountId: string;
  type: "web_url" | "postback";
  title: string;
  url: string | null;
  payload: string | null;
  position: number;
  isSynced: boolean;
  syncedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface ProfileManagerService {
  listIceBreakers(accountId: string): Promise<Result<IceBreakerView[], AppError>>;
  setIceBreakers(
    accountId: string,
    input: SetIceBreakersInput,
  ): Promise<Result<IceBreakerView[], AppError>>;
  deleteIceBreakers(accountId: string): Promise<Result<void, AppError>>;
  syncIceBreakers(accountId: string): Promise<Result<void, AppError>>;
  listPersistentMenu(accountId: string): Promise<Result<PersistentMenuItemView[], AppError>>;
  setPersistentMenu(
    accountId: string,
    input: SetPersistentMenuInput,
  ): Promise<Result<PersistentMenuItemView[], AppError>>;
  deletePersistentMenu(accountId: string): Promise<Result<void, AppError>>;
  syncPersistentMenu(accountId: string): Promise<Result<void, AppError>>;
}

export interface ProfileManagerDeps {
  db: D1Database;
  now: () => number;
  igClient: IInstagramClient;
  accessToken: string;
  igUserId: string;
}

function toView(row: IceBreaker): IceBreakerView {
  return {
    id: row.id,
    accountId: row.account_id,
    question: row.question,
    payload: row.payload,
    position: row.position,
    isSynced: row.is_synced === 1,
    syncedAt: row.synced_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function wrapD1<T>(op: () => Promise<T>): Promise<Result<T, AppError>> {
  try {
    const v = await op();
    return ok(v);
  } catch (e: unknown) {
    return err(createAppError("D1_ERROR", e instanceof Error ? e.message : "Database error"));
  }
}

function toMenuItemView(row: PersistentMenuItemRow): PersistentMenuItemView {
  return {
    id: row.id,
    accountId: row.account_id,
    type: row.type,
    title: row.title,
    url: row.url,
    payload: row.payload,
    position: row.position,
    isSynced: row.is_synced === 1,
    syncedAt: row.synced_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createProfileManager(deps: ProfileManagerDeps): ProfileManagerService {
  const { db, now, igClient, accessToken, igUserId } = deps;

  async function listIceBreakers(accountId: string): Promise<Result<IceBreakerView[], AppError>> {
    const result = await wrapD1(() =>
      db
        .prepare("SELECT * FROM ice_breakers WHERE account_id = ? ORDER BY position ASC")
        .bind(accountId)
        .all<IceBreaker>(),
    );
    if (!result.ok) return result;
    return ok(result.value.results.map(toView));
  }

  async function setIceBreakers(
    accountId: string,
    input: SetIceBreakersInput,
  ): Promise<Result<IceBreakerView[], AppError>> {
    const parsed = SetIceBreakersInputSchema.safeParse(input);
    if (!parsed.success) {
      return err(createAppError("VALIDATION_ERROR", parsed.error.message));
    }
    const { items } = parsed.data;

    const currentTime = now();

    // Try to sync with Instagram API
    const apiItems = items.map((item) => ({
      question: item.question,
      payload: item.payload,
    }));
    const syncResult = await igClient.setIceBreakers(igUserId, apiItems, accessToken);
    const synced = syncResult.ok;

    // Delete existing + insert new in a single batch for atomicity
    const ids = items.map(() => generateId());
    const batchResult = await wrapD1(() => {
      const deleteStmt = db
        .prepare("DELETE FROM ice_breakers WHERE account_id = ?")
        .bind(accountId);
      const insertStmts = items.map((item, i) =>
        db
          .prepare(
            "INSERT INTO ice_breakers (id, account_id, question, payload, position, is_synced, synced_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
          )
          .bind(
            ids[i],
            accountId,
            item.question,
            item.payload,
            i,
            synced ? 1 : 0,
            synced ? currentTime : null,
            currentTime,
            currentTime,
          ),
      );
      return db.batch([deleteStmt, ...insertStmts]);
    });
    if (!batchResult.ok) return batchResult;

    const views: IceBreakerView[] = items.map((item, i) => ({
      id: ids[i]!,
      accountId,
      question: item.question,
      payload: item.payload,
      position: i,
      isSynced: synced,
      syncedAt: synced ? currentTime : null,
      createdAt: currentTime,
      updatedAt: currentTime,
    }));

    return ok(views);
  }

  async function deleteIceBreakers(accountId: string): Promise<Result<void, AppError>> {
    const deleteResult = await wrapD1(() =>
      db
        .prepare("DELETE FROM ice_breakers WHERE account_id = ?")
        .bind(accountId)
        .run(),
    );
    if (!deleteResult.ok) return deleteResult;

    // Sync empty ice breakers to Instagram
    await igClient.setIceBreakers(igUserId, [], accessToken);

    return ok(undefined);
  }

  async function syncIceBreakers(accountId: string): Promise<Result<void, AppError>> {
    const listResult = await listIceBreakers(accountId);
    if (!listResult.ok) return listResult;

    const items = listResult.value.map((view) => ({
      question: view.question,
      payload: view.payload,
    }));

    const syncResult = await igClient.setIceBreakers(igUserId, items, accessToken);
    if (!syncResult.ok) {
      return err(createAppError("INTERNAL_ERROR", "Failed to sync ice breakers to Instagram API"));
    }

    // Mark all as synced
    const currentTime = now();
    const updateResult = await wrapD1(() =>
      db
        .prepare("UPDATE ice_breakers SET is_synced = 1, synced_at = ?, updated_at = ? WHERE account_id = ?")
        .bind(currentTime, currentTime, accountId)
        .run(),
    );
    if (!updateResult.ok) return updateResult;

    return ok(undefined);
  }

  async function listPersistentMenu(accountId: string): Promise<Result<PersistentMenuItemView[], AppError>> {
    const result = await wrapD1(() =>
      db
        .prepare("SELECT * FROM persistent_menu_items WHERE account_id = ? ORDER BY position ASC")
        .bind(accountId)
        .all<PersistentMenuItemRow>(),
    );
    if (!result.ok) return result;
    return ok(result.value.results.map(toMenuItemView));
  }

  async function setPersistentMenu(
    accountId: string,
    input: SetPersistentMenuInput,
  ): Promise<Result<PersistentMenuItemView[], AppError>> {
    const parsed = SetPersistentMenuInputSchema.safeParse(input);
    if (!parsed.success) {
      return err(createAppError("VALIDATION_ERROR", parsed.error.message));
    }
    const { items } = parsed.data;

    const currentTime = now();

    // Try to sync with Instagram API
    const apiItems = items.map((item) => ({
      type: item.type,
      title: item.title,
      url: item.type === "web_url" ? item.url : undefined,
      payload: item.type === "postback" ? item.payload : undefined,
    }));
    const syncResult = await igClient.setPersistentMenu(igUserId, apiItems, accessToken);
    const synced = syncResult.ok;

    // Delete existing + insert new in a single batch for atomicity
    const ids = items.map(() => generateId());
    const batchResult = await wrapD1(() => {
      const deleteStmt = db
        .prepare("DELETE FROM persistent_menu_items WHERE account_id = ?")
        .bind(accountId);
      const insertStmts = items.map((item, i) =>
        db
          .prepare(
            "INSERT INTO persistent_menu_items (id, account_id, type, title, url, payload, position, is_synced, synced_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          )
          .bind(
            ids[i],
            accountId,
            item.type,
            item.title,
            item.type === "web_url" ? item.url : null,
            item.type === "postback" ? item.payload : null,
            i,
            synced ? 1 : 0,
            synced ? currentTime : null,
            currentTime,
            currentTime,
          ),
      );
      return db.batch([deleteStmt, ...insertStmts]);
    });
    if (!batchResult.ok) return batchResult;

    const views: PersistentMenuItemView[] = items.map((item, i) => ({
      id: ids[i]!,
      accountId,
      type: item.type,
      title: item.title,
      url: item.type === "web_url" ? item.url : null,
      payload: item.type === "postback" ? item.payload : null,
      position: i,
      isSynced: synced,
      syncedAt: synced ? currentTime : null,
      createdAt: currentTime,
      updatedAt: currentTime,
    }));

    return ok(views);
  }

  async function deletePersistentMenu(accountId: string): Promise<Result<void, AppError>> {
    const deleteResult = await wrapD1(() =>
      db
        .prepare("DELETE FROM persistent_menu_items WHERE account_id = ?")
        .bind(accountId)
        .run(),
    );
    if (!deleteResult.ok) return deleteResult;

    // Sync empty menu to Instagram
    await igClient.setPersistentMenu(igUserId, [], accessToken);

    return ok(undefined);
  }

  async function syncPersistentMenu(accountId: string): Promise<Result<void, AppError>> {
    const listResult = await listPersistentMenu(accountId);
    if (!listResult.ok) return listResult;

    const items = listResult.value.map((view) => ({
      type: view.type,
      title: view.title,
      url: view.url ?? undefined,
      payload: view.payload ?? undefined,
    }));

    const syncResult = await igClient.setPersistentMenu(igUserId, items, accessToken);
    if (!syncResult.ok) {
      return err(createAppError("INTERNAL_ERROR", "Failed to sync persistent menu to Instagram API"));
    }

    // Mark all as synced
    const currentTime = now();
    const updateResult = await wrapD1(() =>
      db
        .prepare("UPDATE persistent_menu_items SET is_synced = 1, synced_at = ?, updated_at = ? WHERE account_id = ?")
        .bind(currentTime, currentTime, accountId)
        .run(),
    );
    if (!updateResult.ok) return updateResult;

    return ok(undefined);
  }

  return {
    listIceBreakers,
    setIceBreakers,
    deleteIceBreakers,
    syncIceBreakers,
    listPersistentMenu,
    setPersistentMenu,
    deletePersistentMenu,
    syncPersistentMenu,
  };
}
