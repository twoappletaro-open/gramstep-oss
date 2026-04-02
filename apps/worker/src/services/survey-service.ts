import { generateId } from "@gramstep/db";
import type { Form, FormAnswer, FormSession, FormStep, IgUser } from "@gramstep/db";
import type {
  AppError,
  CreateSurveyInput,
  CreateSurveyStepInput,
  Result,
  SendQueueMessage,
  SurveyOption,
  UpdateSurveyInput,
} from "@gramstep/shared";
import { createAppError, err, ok } from "@gramstep/shared";
import { createCustomVariableService } from "./custom-variable.js";
import { createTemplateEngine } from "./template-engine.js";

const DEFAULT_ATTRIBUTE_OPTIONS = [
  { key: "email", label: "メールアドレス" },
  { key: "phone", label: "電話番号" },
  { key: "gender", label: "性別" },
  { key: "birthday", label: "誕生日" },
] as const;

type SurveyListRow = Form & {
  response_user_count?: number;
  steps_count?: number;
};

export interface SurveyStepView {
  id: string;
  step_order: number;
  field_type: "default_attribute" | "custom_attribute" | "free_input";
  field_key: string | null;
  answer_mode: "free_text" | "choice";
  question_text: string;
  options: SurveyOption[];
}

export interface SurveyDetail {
  id: string;
  name: string;
  is_active: boolean;
  completion_template_id: string | null;
  archived_at: number | null;
  created_at: number;
  updated_at: number;
  response_user_count: number;
  steps: SurveyStepView[];
}

export interface SurveyListItem {
  id: string;
  name: string;
  is_active: boolean;
  archived_at: number | null;
  completion_template_id: string | null;
  created_at: number;
  updated_at: number;
  response_user_count: number;
  steps_count: number;
}

export interface SurveyFieldOption {
  value: string;
  label: string;
  source: "default" | "custom";
}

export interface SurveyStartResult {
  session_id: string;
  first_step_order: number;
}

export interface SurveyIncomingResult {
  handled: boolean;
  completed: boolean;
  session_id?: string;
}

export interface SurveyService {
  listSurveys(accountId: string, includeArchived?: boolean): Promise<Result<SurveyListItem[], AppError>>;
  getSurvey(id: string, accountId: string): Promise<Result<SurveyDetail, AppError>>;
  createSurvey(accountId: string, input: CreateSurveyInput): Promise<Result<SurveyDetail, AppError>>;
  updateSurvey(id: string, accountId: string, input: UpdateSurveyInput): Promise<Result<SurveyDetail, AppError>>;
  deleteSurvey(id: string, accountId: string): Promise<Result<void, AppError>>;
  archiveSurveys(accountId: string, ids: string[]): Promise<Result<{ archived: number }, AppError>>;
  exportSurveyCsv(id: string, accountId: string): Promise<Result<string, AppError>>;
  listFieldOptions(accountId: string): Promise<Result<SurveyFieldOption[], AppError>>;
  startSurveyForUser(
    surveyId: string,
    accountId: string,
    igUserId: string,
    recipientId: string,
  ): Promise<Result<SurveyStartResult, AppError>>;
  handleIncomingResponse(input: {
    accountId: string;
    igUserId: string;
    recipientId: string;
    text?: string | null;
    payload?: string | null;
  }): Promise<Result<SurveyIncomingResult, AppError>>;
}

export interface SurveyServiceDeps {
  db: D1Database;
  sendQueue: Queue<SendQueueMessage>;
}

function parseOptions(raw: string | null | undefined): SurveyOption[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as SurveyOption[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function toQuickReplies(options: SurveyOption[]): Array<{ content_type: "text"; title: string; payload: string }> {
  return options.map((option) => ({
    content_type: "text",
    title: option.label,
    payload: option.value,
  }));
}

function toLegacyQuickReplies(options: SurveyOption[]): Array<{ title: string; payload: string }> {
  return options.map((option) => ({ title: option.label, payload: option.value }));
}

function toStepView(step: FormStep): SurveyStepView {
  const parsedOptions = parseOptions(step.options_json);
  const legacyOptions = parseOptions(step.quick_replies).map((option) => ({
    label: (option as { title?: string }).title ?? "",
    value: (option as { payload?: string }).payload ?? "",
  }));

  return {
    id: step.id,
    step_order: step.step_order,
    field_type: (step.field_type as SurveyStepView["field_type"]) ?? "free_input",
    field_key: step.field_key ?? step.metadata_key ?? null,
    answer_mode: (step.answer_mode as SurveyStepView["answer_mode"]) ?? "choice",
    question_text: step.question_text,
    options: parsedOptions.length > 0 ? parsedOptions : legacyOptions,
  };
}

function mapSurveyDetail(form: Form, steps: FormStep[], responseUserCount: number): SurveyDetail {
  return {
    id: form.id,
    name: form.name,
    is_active: form.is_active === 1,
    completion_template_id: form.completion_template_id ?? null,
    archived_at: form.archived_at ?? null,
    created_at: form.created_at,
    updated_at: form.updated_at,
    response_user_count: responseUserCount,
    steps: steps.map(toStepView),
  };
}

function sanitizeCsv(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  if (safe.includes(",") || safe.includes('"') || safe.includes("\n")) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

export function createSurveyService(deps: SurveyServiceDeps): SurveyService {
  const { db, sendQueue } = deps;
  const customVariableService = createCustomVariableService({ db });
  const templateEngine = createTemplateEngine({ db, customVariableService });

  async function getSurveyRow(id: string, accountId: string): Promise<Form | null> {
    return db
      .prepare("SELECT * FROM forms WHERE id = ? AND account_id = ?")
      .bind(id, accountId)
      .first<Form>();
  }

  async function getSurveySteps(formId: string): Promise<FormStep[]> {
    const result = await db
      .prepare("SELECT * FROM form_steps WHERE form_id = ? ORDER BY step_order ASC")
      .bind(formId)
      .all<FormStep>();
    return result.results ?? [];
  }

  async function getResponseUserCount(formId: string): Promise<number> {
    const row = await db
      .prepare("SELECT COUNT(DISTINCT ig_user_id) AS count FROM form_answers WHERE form_id = ?")
      .bind(formId)
      .first<{ count: number }>();
    return row?.count ?? 0;
  }

  function validateStep(step: CreateSurveyStepInput): Result<void, AppError> {
    if (step.answer_mode === "choice") {
      if (step.options.length === 0) {
        return err(createAppError("VALIDATION_ERROR", "選択肢型の質問には1つ以上の選択肢が必要です"));
      }
    }

    if (step.answer_mode === "free_text" && step.options.length > 0) {
      return err(createAppError("VALIDATION_ERROR", "自由記述型の質問には選択肢を設定できません"));
    }

    if (step.field_type === "default_attribute") {
      const validKeys = DEFAULT_ATTRIBUTE_OPTIONS.map((option) => option.key);
      if (!step.field_key || !validKeys.includes(step.field_key as typeof validKeys[number])) {
        return err(createAppError("VALIDATION_ERROR", "デフォルト属性の保存先が不正です"));
      }
    }

    if (step.field_type === "custom_attribute" && !step.field_key) {
      return err(createAppError("VALIDATION_ERROR", "カスタム属性には保存先キーが必要です"));
    }

    return ok(undefined);
  }

  async function insertStep(formId: string, step: CreateSurveyStepInput, now: number): Promise<void> {
    const stepId = generateId();
    await db
      .prepare(
        `INSERT INTO form_steps (
          id, form_id, step_order, question_text, quick_replies, metadata_key,
          field_type, field_key, answer_mode, options_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        stepId,
        formId,
        step.step_order,
        step.question_text,
        JSON.stringify(toLegacyQuickReplies(step.options)),
        step.field_key,
        step.field_type,
        step.field_key,
        step.answer_mode,
        JSON.stringify(step.options),
        now,
      )
      .run();
  }

  function buildQuestionPayload(step: FormStep, prefix?: string): Record<string, unknown> {
    const view = toStepView(step);
    const text = prefix ? `${prefix}\n\n${view.question_text}` : view.question_text;
    if (view.answer_mode === "choice") {
      return {
        type: "quick_reply",
        text,
        quick_replies: toQuickReplies(view.options),
      };
    }
    return {
      type: "text",
      text,
    };
  }

  async function queueOutboundMessage(
    accountId: string,
    igUserId: string,
    recipientId: string,
    formId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const messageId = generateId();
    const messageType = typeof payload.type === "string" ? payload.type : "text";
    const content = typeof payload.text === "string" ? payload.text : null;
    await db
      .prepare(
        `INSERT INTO message_logs (id, account_id, ig_user_id, direction, message_type, content, source_type, source_id, delivery_status)
         VALUES (?, ?, ?, 'outbound', ?, ?, 'system', ?, 'queued')`,
      )
      .bind(messageId, accountId, igUserId, messageType, content, formId)
      .run();

    const msg: SendQueueMessage = {
      id: messageId,
      accountId,
      igUserId,
      recipientId,
      messagePayload: JSON.stringify(payload),
      mediaCategory: "text",
      sourceType: "system",
      sourceId: formId,
      enrollmentId: null,
      retryCount: 0,
    };
    await sendQueue.send(msg);
  }

  async function renderCompletionPayload(
    templateId: string,
    accountId: string,
    igUserId: string,
  ): Promise<Result<Record<string, unknown>, AppError>> {
    const user = await db
      .prepare("SELECT * FROM ig_users WHERE id = ? AND account_id = ?")
      .bind(igUserId, accountId)
      .first<IgUser>();
    if (!user) {
      return err(createAppError("NOT_FOUND", "User not found"));
    }

    const tagsResult = await db
      .prepare(
        `SELECT t.name FROM tags t
         JOIN ig_user_tags iut ON iut.tag_id = t.id
         WHERE iut.ig_user_id = ?`,
      )
      .bind(igUserId)
      .all<{ name: string }>();
    const tagNames = (tagsResult.results ?? []).map((tag) => tag.name);

    const rendered = await templateEngine.renderTemplate(templateId, accountId, user, tagNames);
    if (!rendered.ok) {
      return err(rendered.error);
    }

    switch (rendered.value.type) {
      case "text":
        return ok({ type: "text", text: rendered.value.payload });
      case "media":
        return ok({ type: "image", url: rendered.value.payload });
      case "quick_reply": {
        const parsed = JSON.parse(rendered.value.payload) as Record<string, unknown>;
        return ok({
          type: "quick_reply",
          text: parsed.text ?? "",
          quick_replies: parsed.quick_replies ?? [],
        });
      }
      case "generic": {
        const parsed = JSON.parse(rendered.value.payload) as Record<string, unknown>;
        return ok({
          type: "generic",
          elements: parsed.elements ?? [],
        });
      }
      default:
        return err(createAppError("VALIDATION_ERROR", "Unsupported completion template type"));
    }
  }

  return {
    async listSurveys(accountId, includeArchived = false) {
      const query = `
        SELECT
          f.*,
          COUNT(DISTINCT fa.ig_user_id) AS response_user_count,
          COUNT(DISTINCT fs.id) AS steps_count
        FROM forms f
        LEFT JOIN form_answers fa ON fa.form_id = f.id
        LEFT JOIN form_steps fs ON fs.form_id = f.id
        WHERE f.account_id = ?
          AND (${includeArchived ? "1 = 1" : "f.archived_at IS NULL"})
        GROUP BY f.id
        ORDER BY f.created_at DESC
      `;
      const result = await db.prepare(query).bind(accountId).all<SurveyListRow>();
      return ok((result.results ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        is_active: row.is_active === 1,
        archived_at: row.archived_at ?? null,
        completion_template_id: row.completion_template_id ?? null,
        created_at: row.created_at,
        updated_at: row.updated_at,
        response_user_count: row.response_user_count ?? 0,
        steps_count: row.steps_count ?? 0,
      })));
    },

    async getSurvey(id, accountId) {
      const form = await getSurveyRow(id, accountId);
      if (!form) {
        return err(createAppError("NOT_FOUND", "Survey not found"));
      }
      const steps = await getSurveySteps(id);
      const responseUserCount = await getResponseUserCount(id);
      return ok(mapSurveyDetail(form, steps, responseUserCount));
    },

    async createSurvey(accountId, input) {
      if (input.steps.length === 0) {
        return err(createAppError("VALIDATION_ERROR", "アンケートには最低1つの質問が必要です"));
      }

      for (const step of input.steps) {
        const validation = validateStep(step);
        if (!validation.ok) return validation;
      }

      const formId = generateId();
      const now = Math.floor(Date.now() / 1000);
      await db
        .prepare(
          `INSERT INTO forms (id, account_id, name, is_active, completion_template_id, archived_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`,
        )
        .bind(formId, accountId, input.name, input.is_active ? 1 : 0, input.completion_template_id, now, now)
        .run();

      for (const step of input.steps) {
        await insertStep(formId, step, now);
      }

      return getSurveyResult(formId, accountId);
    },

    async updateSurvey(id, accountId, input) {
      const existing = await getSurveyRow(id, accountId);
      if (!existing) {
        return err(createAppError("NOT_FOUND", "Survey not found"));
      }

      if (input.steps) {
        for (const step of input.steps) {
          const validation = validateStep(step);
          if (!validation.ok) return validation;
        }
      }

      const now = Math.floor(Date.now() / 1000);
      await db
        .prepare(
          `UPDATE forms
           SET name = ?, is_active = ?, completion_template_id = ?, updated_at = ?
           WHERE id = ? AND account_id = ?`,
        )
        .bind(
          input.name ?? existing.name,
          input.is_active !== undefined ? (input.is_active ? 1 : 0) : existing.is_active,
          input.completion_template_id !== undefined ? input.completion_template_id : existing.completion_template_id,
          now,
          id,
          accountId,
        )
        .run();

      if (input.steps) {
        await db.prepare("DELETE FROM form_steps WHERE form_id = ?").bind(id).run();
        for (const step of input.steps) {
          await insertStep(id, step, now);
        }
      }

      return getSurveyResult(id, accountId);
    },

    async deleteSurvey(id, accountId) {
      const existing = await getSurveyRow(id, accountId);
      if (!existing) {
        return err(createAppError("NOT_FOUND", "Survey not found"));
      }
      await db.prepare("DELETE FROM forms WHERE id = ? AND account_id = ?").bind(id, accountId).run();
      return ok(undefined);
    },

    async archiveSurveys(accountId, ids) {
      if (ids.length === 0) {
        return err(createAppError("VALIDATION_ERROR", "No surveys selected"));
      }
      const now = Math.floor(Date.now() / 1000);
      const placeholders = ids.map(() => "?").join(", ");
      const result = await db
        .prepare(`UPDATE forms SET archived_at = ?, updated_at = ? WHERE account_id = ? AND id IN (${placeholders})`)
        .bind(now, now, accountId, ...ids)
        .run();
      return ok({ archived: result.meta.changes ?? 0 });
    },

    async exportSurveyCsv(id, accountId) {
      const form = await getSurveyRow(id, accountId);
      if (!form) {
        return err(createAppError("NOT_FOUND", "Survey not found"));
      }

      const steps = await getSurveySteps(id);
      const answersResult = await db
        .prepare(
          `SELECT
             fa.*,
             fs.question_text,
             u.ig_username,
             u.display_name,
             s.started_at,
             s.completed_at
           FROM form_answers fa
           JOIN form_steps fs ON fs.id = fa.step_id
           JOIN form_sessions s ON s.id = fa.session_id
           JOIN ig_users u ON u.id = fa.ig_user_id
           WHERE fa.form_id = ? AND fa.account_id = ?
           ORDER BY fa.answered_at ASC`,
        )
        .bind(id, accountId)
        .all<FormAnswer & {
          question_text: string;
          ig_username: string | null;
          display_name: string | null;
          started_at: number;
          completed_at: number | null;
        }>();

      type CsvRow = Record<string, string> & {
        session_id: string;
        ig_user_id: string;
        ig_username: string;
        display_name: string;
        started_at: string;
        completed_at: string;
      };

      const bySession = new Map<string, CsvRow>();
      for (const answer of answersResult.results ?? []) {
        const row = bySession.get(answer.session_id) ?? {
          session_id: answer.session_id,
          ig_user_id: answer.ig_user_id,
          ig_username: answer.ig_username ?? "",
          display_name: answer.display_name ?? "",
          started_at: String(answer.started_at),
          completed_at: answer.completed_at ? String(answer.completed_at) : "",
        };
        row[`step_${answer.step_order}`] = answer.answer_label ?? answer.answer_value;
        bySession.set(answer.session_id, row);
      }

      const headers = [
        "session_id",
        "ig_user_id",
        "ig_username",
        "display_name",
        "started_at",
        "completed_at",
        ...steps.map((step) => `Q${step.step_order}:${step.question_text}`),
      ];
      const lines = [headers.map(sanitizeCsv).join(",")];
      for (const row of bySession.values()) {
        const values = [
          row.session_id ?? "",
          row.ig_user_id ?? "",
          row.ig_username ?? "",
          row.display_name ?? "",
          row.started_at ?? "",
          row.completed_at ?? "",
          ...steps.map((step) => row[`step_${step.step_order}`] ?? ""),
        ];
        lines.push(values.map(sanitizeCsv).join(","));
      }

      return ok(lines.join("\n") + "\n");
    },

    async listFieldOptions(accountId) {
      const variables = await customVariableService.listVariables(accountId);
      if (!variables.ok) return err(variables.error);

      const customOptions = variables.value
        .filter((variable) => variable.data_source === "metadata" && variable.metadata_key)
        .map((variable) => ({
          value: variable.metadata_key ?? variable.name,
          label: variable.name,
          source: "custom" as const,
        }));

      return ok([
        ...DEFAULT_ATTRIBUTE_OPTIONS.map((item) => ({
          value: item.key,
          label: item.label,
          source: "default" as const,
        })),
        ...customOptions,
      ]);
    },

    async startSurveyForUser(surveyId, accountId, igUserId, recipientId) {
      const form = await getSurveyRow(surveyId, accountId);
      if (!form || form.archived_at !== null) {
        return err(createAppError("NOT_FOUND", "Survey not found"));
      }
      if (form.is_active !== 1) {
        return err(createAppError("VALIDATION_ERROR", "Survey is inactive"));
      }

      const steps = await getSurveySteps(surveyId);
      const firstStep = steps[0];
      if (!firstStep) {
        return err(createAppError("VALIDATION_ERROR", "Survey has no steps"));
      }

      const sessionId = generateId();
      const now = Math.floor(Date.now() / 1000);
      await db
        .prepare(
          `INSERT INTO form_sessions (id, form_id, ig_user_id, account_id, current_step_order, status, started_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'in_progress', ?, ?)`,
        )
        .bind(sessionId, surveyId, igUserId, accountId, firstStep.step_order, now, now)
        .run();

      await queueOutboundMessage(
        accountId,
        igUserId,
        recipientId,
        surveyId,
        buildQuestionPayload(firstStep),
      );

      return ok({
        session_id: sessionId,
        first_step_order: firstStep.step_order,
      });
    },

    async handleIncomingResponse(input) {
      const session = await db
        .prepare(
          `SELECT * FROM form_sessions
           WHERE account_id = ? AND ig_user_id = ? AND status = 'in_progress'
           ORDER BY started_at DESC
           LIMIT 1`,
        )
        .bind(input.accountId, input.igUserId)
        .first<FormSession>();

      if (!session) {
        return ok({ handled: false, completed: false });
      }

      const step = await db
        .prepare("SELECT * FROM form_steps WHERE form_id = ? AND step_order = ?")
        .bind(session.form_id, session.current_step_order)
        .first<FormStep>();
      if (!step) {
        return err(createAppError("NOT_FOUND", "Survey step not found"));
      }

      const rawValue = (input.payload ?? input.text ?? "").trim();
      if (!rawValue) {
        return ok({ handled: false, completed: false, session_id: session.id });
      }

      const now = Math.floor(Date.now() / 1000);
      const stepView = toStepView(step);
      let answerValue = rawValue;
      let answerLabel: string | null = rawValue;

      if (stepView.answer_mode === "choice") {
        const matched = stepView.options.find((option) =>
          option.value === rawValue || option.label === rawValue
        );
        if (!matched) {
          await queueOutboundMessage(
            input.accountId,
            input.igUserId,
            input.recipientId,
            session.form_id,
            buildQuestionPayload(step, "選択肢から選んでください。"),
          );
          return ok({ handled: true, completed: false, session_id: session.id });
        }
        answerValue = matched.value;
        answerLabel = matched.label;
      }

      try {
        await db
          .prepare(
            `INSERT INTO form_answers (
              id, session_id, form_id, step_id, ig_user_id, account_id, step_order, answer_value, answer_label, answered_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            generateId(),
            session.id,
            session.form_id,
            step.id,
            input.igUserId,
            input.accountId,
            step.step_order,
            answerValue,
            answerLabel,
            now,
          )
          .run();
      } catch {
        return ok({ handled: true, completed: false, session_id: session.id });
      }

      if (step.field_key) {
        const user = await db
          .prepare("SELECT metadata FROM ig_users WHERE id = ?")
          .bind(input.igUserId)
          .first<{ metadata: string }>();
        let metadata: Record<string, string> = {};
        try {
          metadata = JSON.parse(user?.metadata ?? "{}") as Record<string, string>;
        } catch {
          metadata = {};
        }
        metadata[step.field_key] = answerValue;
        await db
          .prepare("UPDATE ig_users SET metadata = ?, updated_at = ? WHERE id = ?")
          .bind(JSON.stringify(metadata), now, input.igUserId)
          .run();
      }

      const nextStep = await db
        .prepare(
          "SELECT * FROM form_steps WHERE form_id = ? AND step_order > ? ORDER BY step_order ASC LIMIT 1",
        )
        .bind(session.form_id, session.current_step_order)
        .first<FormStep>();

      if (nextStep) {
        await db
          .prepare("UPDATE form_sessions SET current_step_order = ?, updated_at = ? WHERE id = ?")
          .bind(nextStep.step_order, now, session.id)
          .run();
        await queueOutboundMessage(
          input.accountId,
          input.igUserId,
          input.recipientId,
          session.form_id,
          buildQuestionPayload(nextStep),
        );
        return ok({ handled: true, completed: false, session_id: session.id });
      }

      await db
        .prepare("UPDATE form_sessions SET status = 'completed', completed_at = ?, updated_at = ? WHERE id = ?")
        .bind(now, now, session.id)
        .run();

      const form = await db
        .prepare("SELECT * FROM forms WHERE id = ? AND account_id = ?")
        .bind(session.form_id, input.accountId)
        .first<Form>();
      if (form?.completion_template_id) {
        const completionPayload = await renderCompletionPayload(
          form.completion_template_id,
          input.accountId,
          input.igUserId,
        );
        if (completionPayload.ok) {
          await queueOutboundMessage(
            input.accountId,
            input.igUserId,
            input.recipientId,
            session.form_id,
            completionPayload.value,
          );
        }
      }

      return ok({ handled: true, completed: true, session_id: session.id });
    },
  };

  async function getSurveyResult(id: string, accountId: string): Promise<Result<SurveyDetail, AppError>> {
    const form = await getSurveyRow(id, accountId);
    if (!form) {
      return err(createAppError("NOT_FOUND", "Survey not found"));
    }
    const steps = await getSurveySteps(id);
    const responseUserCount = await getResponseUserCount(id);
    return ok(mapSurveyDetail(form, steps, responseUserCount));
  }
}
