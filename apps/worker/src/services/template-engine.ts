import type { Result } from "@gramstep/shared";
import type { AppError } from "@gramstep/shared";
import type { Template as TemplateRow, CustomVariable } from "@gramstep/db";
import type { IgUser } from "@gramstep/db";
import type { TemplateType, CreateTemplateInput, UpdateTemplateInput } from "@gramstep/shared";
import { ok, err, createAppError } from "@gramstep/shared";
import { generateId } from "@gramstep/db";
import type { CustomVariableService } from "./custom-variable.js";

export interface RenderedMessage {
  type: TemplateType;
  payload: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export interface TemplateEngineService {
  createTemplate(
    accountId: string,
    input: CreateTemplateInput,
  ): Promise<Result<TemplateRow, AppError>>;
  listTemplates(
    accountId: string,
    type?: TemplateType,
  ): Promise<Result<TemplateRow[], AppError>>;
  getTemplate(
    id: string,
    accountId: string,
  ): Promise<Result<TemplateRow, AppError>>;
  updateTemplate(
    id: string,
    accountId: string,
    input: UpdateTemplateInput,
  ): Promise<Result<TemplateRow, AppError>>;
  deleteTemplate(
    id: string,
    accountId: string,
  ): Promise<Result<void, AppError>>;
  renderTemplate(
    templateId: string,
    accountId: string,
    user: IgUser,
    userTagNames: string[],
  ): Promise<Result<RenderedMessage, AppError>>;
  validateTemplate(input: CreateTemplateInput): ValidationResult;
}

export interface TemplateEngineDeps {
  db: D1Database;
  customVariableService?: CustomVariableService;
}

const TEXT_MAX_LENGTH = 1000;
const QUICK_REPLY_TITLE_MAX = 20;
const QUICK_REPLY_MAX_BUTTONS = 13;
const GENERIC_MAX_ELEMENTS = 10;
const GENERIC_TITLE_MAX = 80;
const GENERIC_SUBTITLE_MAX = 80;
const GENERIC_MAX_BUTTONS_PER_ELEMENT = 3;

export function createTemplateEngine(deps: TemplateEngineDeps): TemplateEngineService {
  const { db, customVariableService } = deps;

  function validateTemplate(input: CreateTemplateInput): ValidationResult {
    const errors: string[] = [];

    if (input.type === "text") {
      if (input.body.length > TEXT_MAX_LENGTH) {
        errors.push("テキストメッセージは1,000文字以内にしてください");
      }
    }

    if (input.type === "quick_reply") {
      try {
        const parsed = JSON.parse(input.body) as {
          text?: string;
          quick_replies?: Array<{ title?: string }>;
        };
        const replies = parsed.quick_replies ?? [];
        if (replies.length > QUICK_REPLY_MAX_BUTTONS) {
          errors.push(`Quick Replyボタンは最大${QUICK_REPLY_MAX_BUTTONS}個までです`);
        }
        for (const reply of replies) {
          if (reply.title && reply.title.length > QUICK_REPLY_TITLE_MAX) {
            errors.push(`Quick Replyボタンテキストは${QUICK_REPLY_TITLE_MAX}文字以内にしてください`);
            break;
          }
        }
      } catch {
        errors.push("Quick Replyテンプレートの本文は有効なJSONである必要があります");
      }
    }

    if (input.type === "generic") {
      try {
        const parsed = JSON.parse(input.body) as {
          elements?: Array<{
            title?: string;
            subtitle?: string;
            buttons?: Array<unknown>;
          }>;
        };
        const elements = parsed.elements ?? [];
        if (elements.length > GENERIC_MAX_ELEMENTS) {
          errors.push(`Generic Templateは最大${GENERIC_MAX_ELEMENTS}要素までです`);
        }
        for (const el of elements) {
          if (el.title && el.title.length > GENERIC_TITLE_MAX) {
            errors.push(`Generic Templateタイトルは${GENERIC_TITLE_MAX}文字以内にしてください`);
            break;
          }
          if (el.subtitle && el.subtitle.length > GENERIC_SUBTITLE_MAX) {
            errors.push(`Generic Templateサブタイトルは${GENERIC_SUBTITLE_MAX}文字以内にしてください`);
            break;
          }
          if (el.buttons && el.buttons.length > GENERIC_MAX_BUTTONS_PER_ELEMENT) {
            errors.push(`Generic Templateボタンは要素あたり最大${GENERIC_MAX_BUTTONS_PER_ELEMENT}個までです`);
            break;
          }
        }
      } catch {
        errors.push("Generic Templateの本文は有効なJSONである必要があります");
      }
    }

    return { valid: errors.length === 0, errors };
  }

  function expandVariables(
    body: string,
    user: IgUser,
    userTagNames: string[],
    customVariables?: CustomVariable[],
  ): string {
    let result = body;

    // Conditional blocks: {{#if_tag:NAME}}...{{/if_tag}}
    result = result.replace(
      /\{\{#if_tag:([^}]+)\}\}([\s\S]*?)\{\{\/if_tag\}\}/g,
      (_match, tagName: string, content: string) => {
        return userTagNames.includes(tagName) ? content : "";
      },
    );

    // Parse metadata once
    let metadata: Record<string, string> = {};
    try {
      metadata = JSON.parse(user.metadata) as Record<string, string>;
    } catch {
      // ignore
    }

    // Variable placeholders
    result = result.replace(/\{\{([^}]+)\}\}/g, (_match, varName: string) => {
      const trimmed = varName.trim();

      if (trimmed === "username") return user.ig_username ?? "";
      if (trimmed === "display_name") return user.display_name ?? "";
      if (trimmed === "score") return String(user.score);
      if (trimmed === "ig_user_id") return user.ig_scoped_id;

      // {{meta:key}}
      if (trimmed.startsWith("meta:")) {
        const key = trimmed.slice(5);
        return metadata[key] ?? "";
      }

      // {{tag:name}} → boolean
      if (trimmed.startsWith("tag:")) {
        const tagName = trimmed.slice(4);
        return userTagNames.includes(tagName) ? "true" : "false";
      }

      // {{custom:name}} → custom variable resolution
      if (trimmed.startsWith("custom:") && customVariables && customVariableService) {
        const varName = trimmed.slice(7);
        const cv = customVariables.find((v) => v.name === varName);
        if (cv) {
          return customVariableService.resolveVariable(cv, user, userTagNames);
        }
        return "";
      }

      return "";
    });

    return result;
  }

  function wrapD1<T>(fn: () => Promise<Result<T, AppError>>): Promise<Result<T, AppError>> {
    return fn().catch((e: unknown) =>
      err(createAppError("D1_ERROR", e instanceof Error ? e.message : "Database error")),
    );
  }

  return {
    validateTemplate,

    createTemplate: (accountId, input) =>
      wrapD1(async () => {
        const validation = validateTemplate(input);
        if (!validation.valid) {
          return err(createAppError("VALIDATION_ERROR", validation.errors.join("; ")));
        }

        const id = generateId();
        const now = Math.floor(Date.now() / 1000);
        const variables = JSON.stringify(input.variables);

        await db
          .prepare(
            `INSERT INTO templates (id, account_id, name, type, body, variables, version, is_active, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?, ?)`,
          )
          .bind(id, accountId, input.name, input.type, input.body, variables, now, now)
          .run();

        const row: TemplateRow = {
          id,
          account_id: accountId,
          name: input.name,
          type: input.type,
          body: input.body,
          variables,
          version: 1,
          is_active: 1,
          created_at: now,
          updated_at: now,
        };
        return ok(row);
      }),

    listTemplates: (accountId, type) =>
      wrapD1(async () => {
        if (type) {
          const result = await db
            .prepare(
              `SELECT * FROM templates WHERE account_id = ? AND type = ? ORDER BY created_at DESC`,
            )
            .bind(accountId, type)
            .all<TemplateRow>();
          return ok(result.results);
        }
        const result = await db
          .prepare(
            `SELECT * FROM templates WHERE account_id = ? ORDER BY created_at DESC`,
          )
          .bind(accountId)
          .all<TemplateRow>();
        return ok(result.results);
      }),

    getTemplate: (id, accountId) =>
      wrapD1(async () => {
        const row = await db
          .prepare(`SELECT * FROM templates WHERE id = ? AND account_id = ?`)
          .bind(id, accountId)
          .first<TemplateRow>();
        if (!row) {
          return err(createAppError("NOT_FOUND", "Template not found"));
        }
        return ok(row);
      }),

    updateTemplate: (id, accountId, input) =>
      wrapD1(async () => {
        const existing = await db
          .prepare(`SELECT * FROM templates WHERE id = ? AND account_id = ?`)
          .bind(id, accountId)
          .first<TemplateRow>();
        if (!existing) {
          return err(createAppError("NOT_FOUND", "Template not found"));
        }
        if (existing.version !== input.version) {
          return err(createAppError("CONFLICT", "Version mismatch"));
        }

        const newName = input.name ?? existing.name;
        const newType = (input.type ?? existing.type) as TemplateType;
        const newBody = input.body ?? existing.body;
        const newVariables = input.variables
          ? JSON.stringify(input.variables)
          : existing.variables;
        const newIsActive =
          input.is_active !== undefined
            ? (input.is_active ? 1 : 0)
            : existing.is_active;

        // Re-validate after merging updates
        const revalidation = validateTemplate({
          name: newName,
          type: newType,
          body: newBody,
          variables: input.variables ?? [],
        });
        if (!revalidation.valid) {
          return err(createAppError("VALIDATION_ERROR", revalidation.errors.join("; ")));
        }

        const now = Math.floor(Date.now() / 1000);
        const newVersion = existing.version + 1;

        const updateResult = await db
          .prepare(
            `UPDATE templates SET name = ?, type = ?, body = ?, variables = ?, is_active = ?, version = ?, updated_at = ?
             WHERE id = ? AND account_id = ? AND version = ?`,
          )
          .bind(
            newName,
            newType,
            newBody,
            newVariables,
            newIsActive,
            newVersion,
            now,
            id,
            accountId,
            input.version,
          )
          .run();

        if (updateResult.meta.changes === 0) {
          return err(createAppError("CONFLICT", "Version mismatch (concurrent update)"));
        }

        const updated: TemplateRow = {
          id,
          account_id: accountId,
          name: newName,
          type: newType,
          body: newBody,
          variables: newVariables,
          version: newVersion,
          is_active: newIsActive,
          created_at: existing.created_at,
          updated_at: now,
        };
        return ok(updated);
      }),

    deleteTemplate: (id, accountId) =>
      wrapD1(async () => {
        const existing = await db
          .prepare(`SELECT * FROM templates WHERE id = ? AND account_id = ?`)
          .bind(id, accountId)
          .first<TemplateRow>();
        if (!existing) {
          return err(createAppError("NOT_FOUND", "Template not found"));
        }
        await db
          .prepare(`DELETE FROM templates WHERE id = ? AND account_id = ?`)
          .bind(id, accountId)
          .run();
        return ok(undefined);
      }),

    renderTemplate: (templateId, accountId, user, userTagNames) =>
      wrapD1(async () => {
        const row = await db
          .prepare(`SELECT * FROM templates WHERE id = ? AND account_id = ?`)
          .bind(templateId, accountId)
          .first<TemplateRow>();
        if (!row) {
          return err(createAppError("NOT_FOUND", "Template not found"));
        }

        // Load custom variables if service is available and body contains {{custom:}}
        let customVars: CustomVariable[] | undefined;
        if (customVariableService && row.body.includes("{{custom:")) {
          const cvResult = await customVariableService.listVariables(accountId);
          if (cvResult.ok) {
            customVars = cvResult.value;
          }
        }

        const expanded = expandVariables(row.body, user, userTagNames, customVars);

        return ok({
          type: row.type as TemplateType,
          payload: expanded,
        });
      }),
  };
}
