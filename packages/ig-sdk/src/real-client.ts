import type { Result } from "@gramstep/shared";
import { ok, err } from "@gramstep/shared";
import type {
  IInstagramClient,
  IgApiError,
  SendMessageRequest,
  SendMessageResponse,
  UserProfile,
  MessagePayload,
  GenericElement,
  Button,
  QuickReply,
} from "./types.js";

export interface RealClientConfig {
  accessToken: string;
  apiVersion: string;
  fetchFn?: typeof fetch;
}

/**
 * DB/admin UIから来るsnake_caseペイロードをcamelCase型に正規化する。
 * JSON.parseの結果は型保証がないため、snake_case互換の入力型を明示的に定義。
 */
interface RawGenericElement {
  title: string;
  subtitle?: string;
  imageUrl?: string;
  image_url?: string;
  buttons?: RawButton[];
}
interface RawButton {
  type: string;
  title: string;
  url?: string;
  payload?: string;
}
interface RawQuickReply {
  contentType?: string;
  content_type?: string;
  title: string;
  payload?: string;
}

function normalizePayload(raw: MessagePayload): MessagePayload {
  if (raw.type === "generic") {
    const rawElements = (raw.elements ?? []) as unknown as RawGenericElement[];
    const elements: GenericElement[] = rawElements.map((el) => ({
      title: el.title,
      subtitle: el.subtitle,
      imageUrl: el.imageUrl ?? el.image_url,
      buttons: (el.buttons ?? [])
        .filter((btn) => btn.title && btn.title.length > 0)
        .map((btn): Button =>
          btn.type === "web_url"
            ? { type: "web_url", title: btn.title, url: btn.url ?? "" }
            : { type: "postback", title: btn.title, payload: btn.payload || btn.title },
        ),
    }));
    return { type: "generic", elements };
  }
  if (raw.type === "quick_reply") {
    const rawReplies = (raw.quickReplies ?? (raw as unknown as { quick_replies?: RawQuickReply[] }).quick_replies) ?? [];
    const quickReplies: QuickReply[] = (rawReplies as unknown as RawQuickReply[]).map((qr) => ({
      contentType: "text" as const,
      title: qr.title,
      payload: qr.payload || qr.title,
    }));
    return { type: "quick_reply", text: raw.text, quickReplies };
  }
  return raw;
}

function buildMessageBody(req: SendMessageRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    recipient: { id: req.recipientId },
  };

  if (req.tag) {
    body.messaging_type = "MESSAGE_TAG";
    body.tag = req.tag;
  } else {
    body.messaging_type = "RESPONSE";
  }

  const payload = normalizePayload(req.message);
  switch (payload.type) {
    case "text":
      body.message = { text: payload.text };
      break;
    case "image":
      if (payload.attachmentId) {
        body.message = { attachment: { type: "image", payload: { attachment_id: payload.attachmentId } } };
      } else {
        body.message = { attachment: { type: "image", payload: { url: payload.url } } };
      }
      break;
    case "generic": {
      const elements = payload.elements.map((el) => {
        const mapped: Record<string, unknown> = {
          title: el.title,
          subtitle: el.subtitle,
          image_url: el.imageUrl,
        };
        // Only include buttons if non-empty with valid titles
        const validButtons = (el.buttons ?? []).filter((btn) => btn.title.length > 0);
        if (validButtons.length > 0) {
          mapped.buttons = validButtons.map((btn) =>
            btn.type === "web_url"
              ? { type: "web_url", title: btn.title, url: btn.url }
              : { type: "postback", title: btn.title, payload: btn.payload || btn.title },
          );
        }
        return mapped;
      });
      body.message = {
        attachment: {
          type: "template",
          payload: {
            template_type: "generic",
            elements,
          },
        },
      };
      break;
    }
    case "quick_reply":
      body.message = {
        text: payload.text,
        quick_replies: payload.quickReplies.map((qr) => ({
          content_type: qr.contentType || "text",
          title: qr.title,
          payload: qr.payload || qr.title,
        })),
      };
      break;
  }

  return body;
}

function normalizeSendMessageResponse(raw: Record<string, unknown>): SendMessageResponse {
  return {
    recipientId:
      typeof raw.recipientId === "string"
        ? raw.recipientId
        : typeof raw.recipient_id === "string"
          ? raw.recipient_id
          : "",
    messageId:
      typeof raw.messageId === "string"
        ? raw.messageId
        : typeof raw.message_id === "string"
          ? raw.message_id
          : "",
  };
}

export function createRealInstagramClient(config: RealClientConfig): IInstagramClient {
  const { accessToken, apiVersion } = config;
  const fetchFn = config.fetchFn ?? fetch;
  const baseUrl = `https://graph.instagram.com/${apiVersion}`;

  async function apiCall<T>(
    url: string,
    method: string,
    body?: Record<string, unknown>,
  ): Promise<Result<T, IgApiError>> {
    const res = await fetchFn(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });

    const data = await res.json() as Record<string, unknown>;

    if (!res.ok || data.error) {
      const apiErr = data.error as Record<string, unknown> | undefined;
      return err({
        code: (apiErr?.code as number) ?? res.status,
        message: (apiErr?.message as string) ?? `HTTP ${res.status}`,
        type: (apiErr?.type as string) ?? "Unknown",
        fbtrace_id: apiErr?.fbtrace_id as string | undefined,
      });
    }

    return ok(data as T);
  }

  return {
    async sendMessage(_igUserId, request, appSecretProof) {
      const body = buildMessageBody(request);
      const url = `${baseUrl}/me/messages?access_token=${accessToken}&appsecret_proof=${appSecretProof}`;
      const result = await apiCall<Record<string, unknown>>(url, "POST", body);
      if (!result.ok) {
        return result;
      }
      return ok(normalizeSendMessageResponse(result.value));
    },

    async sendAction(_igUserId, action, recipientId, appSecretProof) {
      const url = `${baseUrl}/me/messages?access_token=${accessToken}&appsecret_proof=${appSecretProof}`;
      const body = {
        recipient: { id: recipientId },
        sender_action: action,
      };
      await apiCall(url, "POST", body);
      return ok(undefined);
    },

    async getUserProfile(igScopedId, token, appSecretProof) {
      const url = `${baseUrl}/${igScopedId}?fields=name,username,profile_pic,follower_count,is_user_follow_business,is_business_follow_user&access_token=${token}&appsecret_proof=${appSecretProof}`;
      return apiCall<UserProfile>(url, "GET");
    },

    async subscribeWebhook(igUserId, token, appSecretProof) {
      const url = `${baseUrl}/${igUserId}/subscribed_apps`;
      const res = await fetchFn(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          subscribed_fields: "messages,messaging_postbacks,messaging_referral,messaging_seen,message_reactions",
          access_token: token,
          appsecret_proof: appSecretProof,
        }),
      });
      const data = await res.json() as { success?: boolean; error?: Record<string, unknown> };
      if (data.error) {
        return err({ code: (data.error.code as number) ?? 0, message: (data.error.message as string) ?? "", type: "" });
      }
      return ok({ success: data.success ?? true });
    },

    async unsubscribeWebhook(igUserId, token, appSecretProof) {
      const url = `${baseUrl}/${igUserId}/subscribed_apps?access_token=${token}&appsecret_proof=${appSecretProof}`;
      const res = await fetchFn(url, { method: "DELETE" });
      const data = await res.json() as { success?: boolean };
      return ok({ success: data.success ?? true });
    },

    async setPersistentMenu(_igUserId, _items, _appSecretProof) {
      return ok(undefined);
    },

    async setIceBreakers(_igUserId, _items, _appSecretProof) {
      return ok(undefined);
    },

    async sendPrivateReply(commentId, message, token, appSecretProof) {
      const url = `${baseUrl}/${commentId}/private_replies?access_token=${token}&appsecret_proof=${appSecretProof}`;
      const result = await apiCall<Record<string, unknown>>(url, "POST", { message });
      if (!result.ok) {
        return result;
      }
      return ok(normalizeSendMessageResponse(result.value));
    },
  };
}
