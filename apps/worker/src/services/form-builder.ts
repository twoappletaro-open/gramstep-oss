import type { Result, AppError, CreateFormInput, QuickReplyOption } from "@gramstep/shared";
import type { Form, FormStep, FormSession } from "@gramstep/db";
import { ok, err, createAppError } from "@gramstep/shared";
import { generateId } from "@gramstep/db";

export interface FormWithSteps {
  form: Form;
  steps: FormStep[];
}

export interface FormQuestion {
  questionText: string;
  quickReplies: QuickReplyOption[];
  stepOrder: number;
}

export interface FormAnswerResult {
  completed: boolean;
  nextQuestion: FormQuestion | null;
}

export interface FormBuilderService {
  createForm(accountId: string, input: CreateFormInput): Promise<Result<Form, AppError>>;
  getForm(id: string, accountId: string): Promise<Result<FormWithSteps, AppError>>;
  listForms(accountId: string): Promise<Result<Form[], AppError>>;
  deleteForm(id: string, accountId: string): Promise<Result<void, AppError>>;
  startSession(formId: string, igUserId: string, accountId: string): Promise<Result<FormQuestion, AppError>>;
  processAnswer(sessionId: string, payload: string): Promise<Result<FormAnswerResult, AppError>>;
}

export interface FormBuilderDeps {
  db: D1Database;
}

export function createFormBuilder(deps: FormBuilderDeps): FormBuilderService {
  const { db } = deps;

  function wrapD1<T>(fn: () => Promise<Result<T, AppError>>): Promise<Result<T, AppError>> {
    return fn().catch((e: unknown) =>
      err(createAppError("D1_ERROR", e instanceof Error ? e.message : "Database error")),
    );
  }

  function parseQuickReplies(json: string): QuickReplyOption[] {
    try {
      return JSON.parse(json) as QuickReplyOption[];
    } catch {
      return [];
    }
  }

  return {
    createForm: (accountId, input) =>
      wrapD1(async () => {
        if (input.steps.length === 0) {
          return err(createAppError("VALIDATION_ERROR", "フォームには最低1つのステップが必要です"));
        }

        const formId = generateId();
        const now = Math.floor(Date.now() / 1000);

        await db
          .prepare(
            `INSERT INTO forms (id, account_id, name, is_active, created_at, updated_at)
             VALUES (?, ?, ?, 1, ?, ?)`,
          )
          .bind(formId, accountId, input.name, now, now)
          .run();

        for (const step of input.steps) {
          const stepId = generateId();
          await db
            .prepare(
              `INSERT INTO form_steps (id, form_id, step_order, question_text, quick_replies, metadata_key, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)`,
            )
            .bind(
              stepId,
              formId,
              step.step_order,
              step.question_text,
              JSON.stringify(step.quick_replies),
              step.metadata_key,
              now,
            )
            .run();
        }

        const form: Form = {
          id: formId,
          account_id: accountId,
          name: input.name,
          is_active: 1,
          completion_template_id: null,
          archived_at: null,
          created_at: now,
          updated_at: now,
        };
        return ok(form);
      }),

    getForm: (id, accountId) =>
      wrapD1(async () => {
        const form = await db
          .prepare(`SELECT * FROM forms WHERE id = ? AND account_id = ?`)
          .bind(id, accountId)
          .first<Form>();
        if (!form) {
          return err(createAppError("NOT_FOUND", "Form not found"));
        }

        const stepsResult = await db
          .prepare(`SELECT * FROM form_steps WHERE form_id = ? ORDER BY step_order ASC`)
          .bind(id)
          .all<FormStep>();

        return ok({ form, steps: stepsResult.results });
      }),

    listForms: (accountId) =>
      wrapD1(async () => {
        const result = await db
          .prepare(`SELECT * FROM forms WHERE account_id = ? ORDER BY created_at DESC`)
          .bind(accountId)
          .all<Form>();
        return ok(result.results);
      }),

    deleteForm: (id, accountId) =>
      wrapD1(async () => {
        const form = await db
          .prepare(`SELECT * FROM forms WHERE id = ? AND account_id = ?`)
          .bind(id, accountId)
          .first<Form>();
        if (!form) {
          return err(createAppError("NOT_FOUND", "Form not found"));
        }
        await db
          .prepare(`DELETE FROM forms WHERE id = ? AND account_id = ?`)
          .bind(id, accountId)
          .run();
        return ok(undefined);
      }),

    startSession: (formId, igUserId, accountId) =>
      wrapD1(async () => {
        // Verify form belongs to account and is active
        const form = await db
          .prepare(`SELECT id, is_active FROM forms WHERE id = ? AND account_id = ?`)
          .bind(formId, accountId)
          .first<Form>();
        if (!form) {
          return err(createAppError("NOT_FOUND", "Form not found"));
        }
        if (!form.is_active) {
          return err(createAppError("VALIDATION_ERROR", "フォームが無効です"));
        }

        const stepsResult = await db
          .prepare(`SELECT * FROM form_steps WHERE form_id = ? ORDER BY step_order ASC`)
          .bind(formId)
          .all<FormStep>();

        if (stepsResult.results.length === 0) {
          return err(createAppError("NOT_FOUND", "Form has no steps"));
        }

        const firstStep = stepsResult.results[0];
        if (!firstStep) {
          return err(createAppError("NOT_FOUND", "Form has no steps"));
        }
        const sessionId = generateId();
        const now = Math.floor(Date.now() / 1000);

        await db
          .prepare(
            `INSERT INTO form_sessions (id, form_id, ig_user_id, account_id, current_step_order, status, started_at)
             VALUES (?, ?, ?, ?, ?, 'in_progress', ?)`,
          )
          .bind(sessionId, formId, igUserId, accountId, firstStep.step_order, now)
          .run();

        const quickReplies = parseQuickReplies(firstStep.quick_replies);

        return ok({
          questionText: firstStep.question_text,
          quickReplies,
          stepOrder: firstStep.step_order,
        });
      }),

    processAnswer: (sessionId, payload) =>
      wrapD1(async () => {
        const session = await db
          .prepare(`SELECT * FROM form_sessions WHERE id = ?`)
          .bind(sessionId)
          .first<FormSession>();

        if (!session) {
          return err(createAppError("NOT_FOUND", "Session not found"));
        }
        if (session.status !== "in_progress") {
          return err(createAppError("VALIDATION_ERROR", "セッションは既に完了しています"));
        }

        // Get current step
        const currentStep = await db
          .prepare(`SELECT * FROM form_steps WHERE form_id = ? AND step_order = ?`)
          .bind(session.form_id, session.current_step_order)
          .first<FormStep>();

        if (!currentStep) {
          return err(createAppError("NOT_FOUND", "Current step not found"));
        }

        // Save answer to user metadata if metadata_key is set
        const metadataKey = currentStep.metadata_key;
        if (metadataKey) {
          const user = await db
            .prepare(`SELECT id, metadata FROM ig_users WHERE id = ?`)
            .bind(session.ig_user_id)
            .first<{ id: string; metadata: string }>();

          if (user) {
            let metadata: Record<string, string> = {};
            try {
              metadata = JSON.parse(user.metadata) as Record<string, string>;
            } catch {
              // ignore
            }
            metadata[metadataKey] = payload;
            const now = Math.floor(Date.now() / 1000);
            await db
              .prepare(`UPDATE ig_users SET metadata = ?, updated_at = ? WHERE id = ?`)
              .bind(JSON.stringify(metadata), now, user.id)
              .run();
          }
        }

        // Check for next step
        const nextStep = await db
          .prepare(`SELECT * FROM form_steps WHERE form_id = ? AND step_order > ? ORDER BY step_order ASC LIMIT 1`)
          .bind(session.form_id, session.current_step_order)
          .first<FormStep>();

        const now = Math.floor(Date.now() / 1000);

        if (nextStep) {
          // Advance to next step (optimistic lock on current_step_order)
          const upd = await db
            .prepare(
              `UPDATE form_sessions SET current_step_order = ?, updated_at = ?
               WHERE id = ? AND status = 'in_progress' AND current_step_order = ?`,
            )
            .bind(nextStep.step_order, now, sessionId, session.current_step_order)
            .run();

          if (upd.meta.changes === 0) {
            return err(createAppError("CONFLICT", "セッションが並行更新されました"));
          }

          const quickReplies = parseQuickReplies(nextStep.quick_replies);

          return ok({
            completed: false,
            nextQuestion: {
              questionText: nextStep.question_text,
              quickReplies,
              stepOrder: nextStep.step_order,
            },
          });
        }

        // No more steps — complete session (optimistic lock)
        const completeUpd = await db
          .prepare(
            `UPDATE form_sessions SET status = 'completed', completed_at = ?, updated_at = ?
             WHERE id = ? AND status = 'in_progress' AND current_step_order = ?`,
          )
          .bind(now, now, sessionId, session.current_step_order)
          .run();

        if (completeUpd.meta.changes === 0) {
          return err(createAppError("CONFLICT", "セッションが並行更新されました"));
        }

        return ok({
          completed: true,
          nextQuestion: null,
        });
      }),
  };
}
