import type { CustomVariable, IgUser } from "@gramstep/db";
import { createCustomVariableService } from "./custom-variable.js";

export interface VariableRenderContext {
  user: IgUser;
  userTagNames: string[];
  customVariables?: CustomVariable[];
}

export async function loadVariableRenderContext(
  db: D1Database,
  accountId: string,
  igUserId: string,
): Promise<VariableRenderContext | null> {
  const user = await db
    .prepare("SELECT * FROM ig_users WHERE id = ? AND account_id = ?")
    .bind(igUserId, accountId)
    .first<IgUser>();
  if (!user) return null;

  const tagsResult = await db
    .prepare(
      `SELECT t.name FROM tags t
       JOIN ig_user_tags iut ON iut.tag_id = t.id
       WHERE iut.ig_user_id = ?`,
    )
    .bind(igUserId)
    .all<{ name: string }>();

  const customVariableService = createCustomVariableService({ db });
  const customVariablesResult = await customVariableService.listVariables(accountId);

  return {
    user,
    userTagNames: (tagsResult.results ?? []).map((tag) => tag.name),
    customVariables: customVariablesResult.ok ? customVariablesResult.value : [],
  };
}

export function expandTemplateVariables(
  body: string,
  context: VariableRenderContext,
): string {
  let result = body;

  result = result.replace(
    /\{\{#if_tag:([^}]+)\}\}([\s\S]*?)\{\{\/if_tag\}\}/g,
    (_match, tagName: string, content: string) => {
      return context.userTagNames.includes(tagName) ? content : "";
    },
  );

  let metadata: Record<string, string> = {};
  try {
    metadata = JSON.parse(context.user.metadata) as Record<string, string>;
  } catch {
    metadata = {};
  }

  result = result.replace(/\{\{([^}]+)\}\}/g, (_match, varName: string) => {
    const trimmed = varName.trim();

    if (trimmed === "username") return context.user.ig_username ?? "";
    if (trimmed === "display_name") return context.user.display_name ?? "";
    if (trimmed === "score") return String(context.user.score);
    if (trimmed === "ig_user_id") return context.user.ig_scoped_id;

    if (trimmed.startsWith("meta:")) {
      const key = trimmed.slice(5);
      return metadata[key] ?? "";
    }

    if (trimmed.startsWith("tag:")) {
      const tagName = trimmed.slice(4);
      return context.userTagNames.includes(tagName) ? "true" : "false";
    }

    if (trimmed.startsWith("custom:") && context.customVariables) {
      const customName = trimmed.slice(7);
      const cv = context.customVariables.find((variable) => variable.name === customName);
      if (cv) {
        if (cv.data_source === "static") return cv.default_value;
        if (cv.data_source === "score") return String(context.user.score);
        if (cv.data_source === "tag") {
          const tagName = cv.metadata_key ?? cv.name;
          return context.userTagNames.includes(tagName) ? "true" : "false";
        }
        if (cv.data_source === "metadata" && cv.metadata_key) {
          return metadata[cv.metadata_key] ?? cv.default_value;
        }
        return cv.default_value;
      }
    }

    return "";
  });

  return result;
}

export function renderMessagePayloadVariables(
  raw: string,
  context: VariableRenderContext,
): string {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    if (typeof parsed.text === "string") {
      parsed.text = expandTemplateVariables(parsed.text, context);
    }

    if (Array.isArray(parsed.quick_replies)) {
      parsed.quick_replies = parsed.quick_replies.map((reply) => {
        if (!reply || typeof reply !== "object") return reply;
        const next = { ...(reply as Record<string, unknown>) };
        if (typeof next.title === "string") {
          next.title = expandTemplateVariables(next.title, context);
        }
        return next;
      });
    }

    if (Array.isArray(parsed.quickReplies)) {
      parsed.quickReplies = parsed.quickReplies.map((reply) => {
        if (!reply || typeof reply !== "object") return reply;
        const next = { ...(reply as Record<string, unknown>) };
        if (typeof next.title === "string") {
          next.title = expandTemplateVariables(next.title, context);
        }
        return next;
      });
    }

    if (Array.isArray(parsed.elements)) {
      parsed.elements = parsed.elements.map((element) => {
        if (!element || typeof element !== "object") return element;
        const next = { ...(element as Record<string, unknown>) };
        if (typeof next.title === "string") {
          next.title = expandTemplateVariables(next.title, context);
        }
        if (typeof next.subtitle === "string") {
          next.subtitle = expandTemplateVariables(next.subtitle, context);
        }
        if (Array.isArray(next.buttons)) {
          next.buttons = next.buttons.map((button) => {
            if (!button || typeof button !== "object") return button;
            const nextButton = { ...(button as Record<string, unknown>) };
            if (typeof nextButton.title === "string") {
              nextButton.title = expandTemplateVariables(nextButton.title, context);
            }
            return nextButton;
          });
        }
        return next;
      });
    }

    return JSON.stringify(parsed);
  } catch {
    return expandTemplateVariables(raw, context);
  }
}
