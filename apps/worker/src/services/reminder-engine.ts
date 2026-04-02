import type { Result } from "@gramstep/shared";
import type {
  AppError,
  CreateReminderInput,
  UpdateReminderInput,
  EnrollReminderInput,
} from "@gramstep/shared";
import type { Reminder, ReminderStep, ReminderEnrollment } from "@gramstep/db";
import { ok, err, createAppError } from "@gramstep/shared";
import { generateId } from "@gramstep/db";

export interface ReminderView {
  id: string;
  account_id: string;
  name: string;
  is_active: boolean;
  steps: ReminderStepView[];
  created_at: number;
  updated_at: number;
}

export interface ReminderStepView {
  id: string;
  reminder_id: string;
  step_order: number;
  offset_seconds: number;
  message_type: string;
  message_payload: string;
}

export interface EnrollmentView {
  id: string;
  reminder_id: string;
  account_id: string;
  ig_user_id: string;
  base_date: number;
  status: string;
  scheduled_sends: ScheduledSend[];
  enrolled_at: number;
}

export interface ScheduledSend {
  step_id: string;
  step_order: number;
  scheduled_at: number;
  message_type: string;
  message_payload: string;
}

export interface DueReminder {
  enrollment_id: string;
  reminder_id: string;
  ig_user_id: string;
  step_id: string;
  step_order: number;
  scheduled_at: number;
  message_type: string;
  message_payload: string;
  has_valid_window: boolean;
}

export interface ReminderEngineService {
  createReminder(
    accountId: string,
    input: CreateReminderInput,
  ): Promise<Result<ReminderView, AppError>>;
  getReminder(
    accountId: string,
    reminderId: string,
  ): Promise<Result<ReminderView, AppError>>;
  listReminders(
    accountId: string,
  ): Promise<Result<ReminderView[], AppError>>;
  updateReminder(
    accountId: string,
    reminderId: string,
    input: UpdateReminderInput,
  ): Promise<Result<ReminderView, AppError>>;
  deleteReminder(
    accountId: string,
    reminderId: string,
  ): Promise<Result<void, AppError>>;
  enrollUser(
    accountId: string,
    reminderId: string,
    input: EnrollReminderInput,
  ): Promise<Result<EnrollmentView, AppError>>;
  getDueReminders(
    accountId: string,
    currentTime: number,
  ): Promise<Result<DueReminder[], AppError>>;
  cancelEnrollment(
    accountId: string,
    enrollmentId: string,
  ): Promise<Result<void, AppError>>;
}

export interface ReminderEngineDeps {
  db: D1Database;
  now: () => number;
}

function toReminderView(row: Reminder, steps: ReminderStepView[]): ReminderView {
  return {
    id: row.id,
    account_id: row.account_id,
    name: row.name,
    is_active: row.is_active === 1,
    steps,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function toStepView(row: ReminderStep): ReminderStepView {
  return {
    id: row.id,
    reminder_id: row.reminder_id,
    step_order: row.step_order,
    offset_seconds: row.offset_seconds,
    message_type: row.message_type,
    message_payload: row.message_payload,
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

export function createReminderEngine(deps: ReminderEngineDeps): ReminderEngineService {
  const { db, now } = deps;

  async function fetchSteps(reminderId: string): Promise<Result<ReminderStepView[], AppError>> {
    return wrapD1(async () => {
      const result = await db
        .prepare("SELECT * FROM reminder_steps WHERE reminder_id = ? ORDER BY step_order ASC")
        .bind(reminderId)
        .all<ReminderStep>();
      return result.results.map(toStepView);
    });
  }

  async function createReminder(
    accountId: string,
    input: CreateReminderInput,
  ): Promise<Result<ReminderView, AppError>> {
    const id = generateId();
    const currentTime = now();
    const stepIds = input.steps.map(() => generateId());

    const batchResult = await wrapD1(async () => {
      const insertReminderStmt = db
        .prepare(
          "INSERT INTO reminders (id, account_id, name, is_active, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)",
        )
        .bind(id, accountId, input.name, currentTime, currentTime);

      const stepStmts = input.steps.map((step, i) =>
        db
          .prepare(
            "INSERT INTO reminder_steps (id, reminder_id, step_order, offset_seconds, message_type, message_payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          )
          .bind(stepIds[i], id, step.step_order, step.offset_seconds, step.message_type, step.message_payload, currentTime),
      );

      return db.batch([insertReminderStmt, ...stepStmts]);
    });
    if (!batchResult.ok) return batchResult;

    const steps: ReminderStepView[] = input.steps.map((s, i) => ({
      id: stepIds[i]!,
      reminder_id: id,
      step_order: s.step_order,
      offset_seconds: s.offset_seconds,
      message_type: s.message_type,
      message_payload: s.message_payload,
    }));

    return ok({
      id,
      account_id: accountId,
      name: input.name,
      is_active: true,
      steps,
      created_at: currentTime,
      updated_at: currentTime,
    });
  }

  async function getReminder(
    accountId: string,
    reminderId: string,
  ): Promise<Result<ReminderView, AppError>> {
    const rowResult = await wrapD1(() =>
      db
        .prepare("SELECT * FROM reminders WHERE id = ? AND account_id = ?")
        .bind(reminderId, accountId)
        .first<Reminder>(),
    );
    if (!rowResult.ok) return rowResult;
    if (!rowResult.value) {
      return err(createAppError("NOT_FOUND", `Reminder ${reminderId} not found`));
    }
    const stepsResult = await fetchSteps(reminderId);
    if (!stepsResult.ok) return stepsResult;
    return ok(toReminderView(rowResult.value, stepsResult.value));
  }

  async function listReminders(
    accountId: string,
  ): Promise<Result<ReminderView[], AppError>> {
    const result = await wrapD1(() =>
      db
        .prepare("SELECT * FROM reminders WHERE account_id = ? ORDER BY created_at DESC")
        .bind(accountId)
        .all<Reminder>(),
    );
    if (!result.ok) return result;
    const views: ReminderView[] = [];
    for (const row of result.value.results) {
      const stepsResult = await fetchSteps(row.id);
      if (!stepsResult.ok) return stepsResult;
      views.push(toReminderView(row, stepsResult.value));
    }
    return ok(views);
  }

  async function updateReminder(
    accountId: string,
    reminderId: string,
    input: UpdateReminderInput,
  ): Promise<Result<ReminderView, AppError>> {
    const existing = await getReminder(accountId, reminderId);
    if (!existing.ok) return existing;

    const currentTime = now();

    if (input.steps) {
      const stepIds = input.steps.map(() => generateId());
      const batchResult = await wrapD1(async () => {
        const updateStmt = db
          .prepare(
            `UPDATE reminders SET name = COALESCE(?, name), is_active = COALESCE(?, is_active), updated_at = ? WHERE id = ? AND account_id = ?`,
          )
          .bind(input.name ?? null, input.is_active === undefined ? null : input.is_active ? 1 : 0, currentTime, reminderId, accountId);
        const deleteStmt = db.prepare("DELETE FROM reminder_steps WHERE reminder_id = ?").bind(reminderId);
        const stepStmts = input.steps!.map((step, i) =>
          db
            .prepare(
              "INSERT INTO reminder_steps (id, reminder_id, step_order, offset_seconds, message_type, message_payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(stepIds[i], reminderId, step.step_order, step.offset_seconds, step.message_type, step.message_payload, currentTime),
        );
        return db.batch([updateStmt, deleteStmt, ...stepStmts]);
      });
      if (!batchResult.ok) return batchResult;
    } else {
      const updateResult = await wrapD1(async () =>
        db
          .prepare(
            `UPDATE reminders SET name = COALESCE(?, name), is_active = COALESCE(?, is_active), updated_at = ? WHERE id = ? AND account_id = ?`,
          )
          .bind(input.name ?? null, input.is_active === undefined ? null : input.is_active ? 1 : 0, currentTime, reminderId, accountId)
          .run(),
      );
      if (!updateResult.ok) return updateResult;
    }

    const updated = await getReminder(accountId, reminderId);
    if (!updated.ok) return updated;

    const view = updated.value;
    if (input.name !== undefined) view.name = input.name;
    if (input.is_active !== undefined) view.is_active = input.is_active;
    return ok(view);
  }

  async function deleteReminder(
    accountId: string,
    reminderId: string,
  ): Promise<Result<void, AppError>> {
    const existing = await getReminder(accountId, reminderId);
    if (!existing.ok) return existing;

    const batchResult = await wrapD1(async () =>
      db.batch([
        db.prepare("DELETE FROM reminder_steps WHERE reminder_id = ?").bind(reminderId),
        db.prepare("DELETE FROM reminders WHERE id = ? AND account_id = ?").bind(reminderId, accountId),
      ]),
    );
    if (!batchResult.ok) return batchResult;
    return ok(undefined);
  }

  async function enrollUser(
    accountId: string,
    reminderId: string,
    input: EnrollReminderInput,
  ): Promise<Result<EnrollmentView, AppError>> {
    const reminder = await getReminder(accountId, reminderId);
    if (!reminder.ok) return reminder;
    if (!reminder.value.is_active) {
      return err(createAppError("VALIDATION_ERROR", "Reminder is not active"));
    }

    const existingResult = await wrapD1(async () =>
      db
        .prepare(
          "SELECT * FROM reminder_enrollments WHERE reminder_id = ? AND ig_user_id = ? AND status = ?",
        )
        .bind(reminderId, input.ig_user_id, "active")
        .first<ReminderEnrollment>(),
    );
    if (!existingResult.ok) return existingResult;
    if (existingResult.value) {
      return err(createAppError("VALIDATION_ERROR", "User already enrolled in this reminder"));
    }

    const enrollmentId = generateId();
    const currentTime = now();
    const insertResult = await wrapD1(async () =>
      db
        .prepare(
          "INSERT INTO reminder_enrollments (id, reminder_id, account_id, ig_user_id, base_date, status, enrolled_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)",
        )
        .bind(enrollmentId, reminderId, accountId, input.ig_user_id, input.base_date, "active", currentTime)
        .run(),
    );
    if (!insertResult.ok) return insertResult;

    const scheduledSends: ScheduledSend[] = reminder.value.steps.map((step) => ({
      step_id: step.id,
      step_order: step.step_order,
      scheduled_at: input.base_date + step.offset_seconds,
      message_type: step.message_type,
      message_payload: step.message_payload,
    }));

    return ok({
      id: enrollmentId,
      reminder_id: reminderId,
      account_id: accountId,
      ig_user_id: input.ig_user_id,
      base_date: input.base_date,
      status: "active",
      scheduled_sends: scheduledSends,
      enrolled_at: currentTime,
    });
  }

  async function getDueReminders(
    accountId: string,
    currentTime: number,
  ): Promise<Result<DueReminder[], AppError>> {
    interface DueRow {
      enrollment_id: string;
      reminder_id: string;
      ig_user_id: string;
      step_id: string;
      step_order: number;
      scheduled_at: number;
      message_type: string;
      message_payload: string;
      has_valid_window: number;
    }

    const queryResult = await wrapD1(async () =>
      db
        .prepare(
          `SELECT
            e.id AS enrollment_id,
            e.reminder_id,
            e.ig_user_id,
            s.id AS step_id,
            s.step_order,
            (e.base_date + s.offset_seconds) AS scheduled_at,
            s.message_type,
            s.message_payload,
            CASE WHEN mw.window_expires_at > ? THEN 1 ELSE 0 END AS has_valid_window
          FROM reminder_enrollments e
          JOIN reminder_steps s ON s.reminder_id = e.reminder_id
          LEFT JOIN messaging_windows mw
            ON mw.account_id = e.account_id
           AND mw.ig_user_id = e.ig_user_id
           AND mw.is_active = 1
          LEFT JOIN reminder_delivery_logs l
            ON l.enrollment_id = e.id
           AND l.step_id = s.id
          WHERE e.account_id = ?
            AND e.status = 'active'
            AND l.id IS NULL
            AND (e.base_date + s.offset_seconds) <= ?
            AND (e.base_date + s.offset_seconds) > ?`,
        )
        .bind(currentTime, accountId, currentTime, currentTime - 3600)
        .all<DueRow>(),
    );
    if (!queryResult.ok) return queryResult;

    return ok(
      queryResult.value.results.map((row) => ({
        enrollment_id: row.enrollment_id,
        reminder_id: row.reminder_id,
        ig_user_id: row.ig_user_id,
        step_id: row.step_id,
        step_order: row.step_order,
        scheduled_at: row.scheduled_at,
        message_type: row.message_type,
        message_payload: row.message_payload,
        has_valid_window: row.has_valid_window === 1,
      })),
    );
  }

  async function cancelEnrollment(
    accountId: string,
    enrollmentId: string,
  ): Promise<Result<void, AppError>> {
    const currentTime = now();
    const result = await wrapD1(async () =>
      db
        .prepare(
          "UPDATE reminder_enrollments SET status = ?, completed_at = ? WHERE id = ? AND account_id = ?",
        )
        .bind("cancelled", currentTime, enrollmentId, accountId)
        .run(),
    );
    if (!result.ok) return result;
    return ok(undefined);
  }

  return {
    createReminder,
    getReminder,
    listReminders,
    updateReminder,
    deleteReminder,
    enrollUser,
    getDueReminders,
    cancelEnrollment,
  };
}
