import type {
  CreateScenarioInput,
  UpdateScenarioInput,
  CreateTriggerInput,
  UpdateTriggerInput,
  CreateAutomationRuleInput,
  UpdateAutomationRuleInput,
  UpdateUserInput,
  SendManualMessageInput,
  ConversationStatus,
  CreateCampaignInput,
  UpdateCampaignInput,
  CreateSurveyInput,
  UpdateSurveyInput,
} from "@gramstep/shared";

/**
 * Admin UIのドメインからWorker APIのURLを自動導出する。
 * 例: gramstep-worker-admin.xxx.workers.dev → https://gramstep-worker.xxx.workers.dev
 */
function deriveWorkerUrl(): string {
  if (typeof window === "undefined") return "";
  const host = window.location.hostname;
  // "*-admin.xxx.workers.dev" → "*.xxx.workers.dev"
  const match = host.match(/^(.+)-admin\.(.+)$/);
  if (!match) return "";
  return `${window.location.protocol}//${match[1]}.${match[2]}`;
}

/** Get the API base URL (env → derived → localStorage → sessionStorage) */
export function getApiUrl(): string {
  const envUrl = process.env.NEXT_PUBLIC_API_URL ?? "";
  if (envUrl) return envUrl; // 環境変数が最優先
  if (typeof window === "undefined") return "";
  return deriveWorkerUrl()
    || localStorage.getItem("gramstep_api_url")
    || sessionStorage.getItem("apiUrl")
    || "";
}

// --- Result type (mirrors packages/shared/src/result.ts pattern) ---

type ApiOk<T> = { ok: true; value: T };
type ApiErr = { ok: false; error: { status: number; message: string } };
type ApiResult<T> = ApiOk<T> | ApiErr;

// --- Internal helpers ---

function getToken(): string {
  return typeof sessionStorage !== "undefined"
    ? sessionStorage.getItem("accessToken") ?? ""
    : "";
}

function headers(accountId: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${getToken()}`,
    "x-account-id": accountId,
  };
}

// Token refresh: 401時にrefreshTokenで自動更新、失敗時はログイン画面へ
let refreshPromise: Promise<boolean> | null = null;

async function tryRefreshToken(baseUrl: string): Promise<boolean> {
  const refreshToken = typeof sessionStorage !== "undefined"
    ? sessionStorage.getItem("refreshToken") ?? ""
    : "";
  if (!refreshToken) return false;

  try {
    const res = await fetch(`${baseUrl}/api/admin/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) return false;

    const data = (await res.json()) as { accessToken: string; refreshToken: string };
    sessionStorage.setItem("accessToken", data.accessToken);
    sessionStorage.setItem("refreshToken", data.refreshToken);
    return true;
  } catch {
    return false;
  }
}

function redirectToLogin(): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem("accessToken");
  sessionStorage.removeItem("refreshToken");
  const path = window.location.pathname;
  const locale = path.split("/")[1] ?? "ja";
  window.location.href = `/${locale}/login`;
}

async function request<T>(
  baseUrl: string,
  path: string,
  opts: RequestInit & { accountId?: string } = {},
): Promise<ApiResult<T>> {
  const { accountId = "", ...fetchOpts } = opts;

  let res: Response;
  try {
    res = await fetch(`${baseUrl}${path}`, {
      ...fetchOpts,
      headers: {
        ...headers(accountId),
        ...(fetchOpts.headers as Record<string, string> | undefined),
      },
    });
  } catch (e: unknown) {
    return { ok: false, error: { status: 0, message: e instanceof Error ? e.message : "Network error" } };
  }

  // 401: トークン期限切れ → 自動リフレッシュ試行
  if (res.status === 401) {
    if (!refreshPromise) {
      refreshPromise = tryRefreshToken(baseUrl).finally(() => { refreshPromise = null; });
    }
    const refreshed = await refreshPromise;
    if (refreshed) {
      // リフレッシュ成功: 元のリクエストを再実行
      try {
        res = await fetch(`${baseUrl}${path}`, {
          ...fetchOpts,
          headers: {
            ...headers(accountId),
            ...(fetchOpts.headers as Record<string, string> | undefined),
          },
        });
      } catch (e: unknown) {
        return { ok: false, error: { status: 0, message: e instanceof Error ? e.message : "Network error" } };
      }
    } else {
      // リフレッシュ失敗: ログイン画面へ
      redirectToLogin();
      return { ok: false, error: { status: 401, message: "Session expired" } };
    }
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    return { ok: false, error: { status: res.status, message: body.error ?? res.statusText } };
  }

  if (res.status === 204) {
    return { ok: true, value: undefined as T };
  }

  const data = (await res.json()) as T;
  return { ok: true, value: data };
}

// --- Resource CRUD builders ---

function buildScenarios(baseUrl: string) {
  return {
    list(
      accountId: string,
      params?: { page?: number; limit?: number; status?: string },
    ) {
      const p = new URLSearchParams();
      p.set("page", String(params?.page ?? 1));
      p.set("limit", String(params?.limit ?? 20));
      if (params?.status) p.set("status", params.status);
      return request<unknown[]>(baseUrl, `/api/scenarios?${p}`, {
        accountId,
      });
    },

    get(id: string) {
      return request<unknown>(baseUrl, `/api/scenarios/${id}`, {});
    },

    create(accountId: string, input: CreateScenarioInput) {
      return request<unknown>(baseUrl, "/api/scenarios", {
        method: "POST",
        body: JSON.stringify(input),
        accountId,
      });
    },

    update(id: string, input: UpdateScenarioInput) {
      return request<unknown>(baseUrl, `/api/scenarios/${id}`, {
        method: "PUT",
        body: JSON.stringify(input),
      });
    },

    delete(id: string) {
      return request<undefined>(baseUrl, `/api/scenarios/${id}`, {
        method: "DELETE",
      });
    },
  };
}

function buildTriggers(baseUrl: string) {
  return {
    list(accountId: string, params?: { page?: number; type?: string }) {
      const p = new URLSearchParams();
      p.set("page", String(params?.page ?? 1));
      if (params?.type) p.set("type", params.type);
      return request<unknown[]>(baseUrl, `/api/triggers?${p}`, {
        accountId,
      });
    },

    get(id: string) {
      return request<unknown>(baseUrl, `/api/triggers/${id}`, {});
    },

    create(accountId: string, input: CreateTriggerInput) {
      return request<unknown>(baseUrl, "/api/triggers", {
        method: "POST",
        body: JSON.stringify(input),
        accountId,
      });
    },

    update(id: string, input: UpdateTriggerInput) {
      return request<unknown>(baseUrl, `/api/triggers/${id}`, {
        method: "PUT",
        body: JSON.stringify(input),
      });
    },

    delete(id: string) {
      return request<undefined>(baseUrl, `/api/triggers/${id}`, {
        method: "DELETE",
      });
    },
  };
}

function buildAutomations(baseUrl: string) {
  return {
    list(accountId: string, params?: { page?: number }) {
      const p = new URLSearchParams();
      p.set("page", String(params?.page ?? 1));
      return request<unknown[]>(baseUrl, `/api/automations?${p}`, {
        accountId,
      });
    },

    get(id: string) {
      return request<unknown>(baseUrl, `/api/automations/${id}`, {});
    },

    create(accountId: string, input: CreateAutomationRuleInput) {
      return request<unknown>(baseUrl, "/api/automations", {
        method: "POST",
        body: JSON.stringify(input),
        accountId,
      });
    },

    update(id: string, input: UpdateAutomationRuleInput) {
      return request<unknown>(baseUrl, `/api/automations/${id}`, {
        method: "PUT",
        body: JSON.stringify(input),
      });
    },

    delete(id: string) {
      return request<undefined>(baseUrl, `/api/automations/${id}`, {
        method: "DELETE",
      });
    },
  };
}

function buildSurveys(baseUrl: string) {
  return {
    list(accountId: string, includeArchived?: boolean) {
      const query = includeArchived ? "?includeArchived=true" : "";
      return request<unknown[]>(baseUrl, `/api/surveys${query}`, {
        accountId,
      });
    },

    get(id: string) {
      return request<unknown>(baseUrl, `/api/surveys/${id}`, {});
    },

    create(accountId: string, input: CreateSurveyInput) {
      return request<unknown>(baseUrl, "/api/surveys", {
        method: "POST",
        body: JSON.stringify(input),
        accountId,
      });
    },

    update(id: string, input: UpdateSurveyInput) {
      return request<unknown>(baseUrl, `/api/surveys/${id}`, {
        method: "PUT",
        body: JSON.stringify(input),
      });
    },

    delete(id: string) {
      return request<undefined>(baseUrl, `/api/surveys/${id}`, {
        method: "DELETE",
      });
    },

    archive(accountId: string, ids: string[]) {
      return request<{ archived: number }>(baseUrl, "/api/surveys/archive", {
        method: "POST",
        body: JSON.stringify({ ids }),
        accountId,
      });
    },

    fieldOptions(accountId: string) {
      return request<Array<{ value: string; label: string; source: "default" | "custom" }>>(
        baseUrl,
        "/api/surveys/field-options",
        { accountId },
      );
    },

    start(accountId: string, surveyId: string, igUserId: string) {
      return request<unknown>(baseUrl, `/api/surveys/${surveyId}/start/${igUserId}`, {
        method: "POST",
        accountId,
      });
    },

    async exportCsv(accountId: string, surveyId: string): Promise<ApiResult<string>> {
      try {
        const res = await fetch(`${baseUrl}/api/surveys/${surveyId}/export`, {
          headers: headers(accountId),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
          return { ok: false, error: { status: res.status, message: body.error ?? res.statusText } };
        }
        return { ok: true, value: await res.text() };
      } catch (e: unknown) {
        return { ok: false, error: { status: 0, message: e instanceof Error ? e.message : "Network error" } };
      }
    },
  };
}

function buildTemplates(baseUrl: string) {
  return {
    list(accountId: string, type?: string) {
      const params = new URLSearchParams();
      if (type) params.set("type", type);
      const query = params.toString();
      return request<unknown[]>(baseUrl, `/api/templates${query ? `?${query}` : ""}`, {
        accountId,
      });
    },

    get(id: string) {
      return request<unknown>(baseUrl, `/api/templates/${id}`, {});
    },
  };
}

function buildUsers(baseUrl: string) {
  return {
    list(
      accountId: string,
      params?: { page?: number; per_page?: number; follower_status?: string; tags?: string[]; search?: string },
    ) {
      const p = new URLSearchParams();
      p.set("page", String(params?.page ?? 1));
      if (params?.per_page) p.set("per_page", String(params.per_page));
      if (params?.follower_status) p.set("follower_status", params.follower_status);
      if (params?.tags) p.set("tags", params.tags.join(","));
      if (params?.search) p.set("search", params.search);
      return request<unknown>(baseUrl, `/api/users?${p}`, { accountId });
    },

    get(id: string, accountId: string) {
      return request<unknown>(baseUrl, `/api/users/${id}`, { accountId });
    },

    update(id: string, accountId: string, input: UpdateUserInput) {
      return request<undefined>(baseUrl, `/api/users/${id}`, {
        method: "PUT",
        body: JSON.stringify(input),
        accountId,
      });
    },

    addTag(userId: string, accountId: string, tagId: string) {
      return request<undefined>(baseUrl, `/api/users/${userId}/tags`, {
        method: "POST",
        body: JSON.stringify({ tag_id: tagId }),
        accountId,
      });
    },

    removeTag(userId: string, tagId: string) {
      return request<undefined>(baseUrl, `/api/users/${userId}/tags/${tagId}`, {
        method: "DELETE",
      });
    },

    updateMetadata(userId: string, key: string, value: string) {
      return request<undefined>(baseUrl, `/api/users/${userId}/metadata`, {
        method: "PUT",
        body: JSON.stringify({ key, value }),
      });
    },

    optOut(userId: string, accountId: string) {
      return request<undefined>(baseUrl, `/api/users/${userId}/opt-out`, {
        method: "POST",
        accountId,
      });
    },

    optIn(userId: string, accountId: string) {
      return request<undefined>(baseUrl, `/api/users/${userId}/opt-in`, {
        method: "POST",
        accountId,
      });
    },

    block(userId: string, accountId: string) {
      return request<undefined>(baseUrl, `/api/users/${userId}/block`, {
        method: "POST",
        accountId,
      });
    },

    unblock(userId: string, accountId: string) {
      return request<undefined>(baseUrl, `/api/users/${userId}/unblock`, {
        method: "POST",
        accountId,
      });
    },

    resetFirstTriggerHistory(userId: string, accountId: string) {
      return request<{ cleared: number; is_test_account: boolean }>(
        baseUrl,
        `/api/users/${userId}/reset-first-trigger-history`,
        {
          method: "POST",
          accountId,
        },
      );
    },

    registerTestAccount(userId: string, accountId: string) {
      return request<{ is_test_account: boolean; test_account_id: string | null; changed: boolean }>(
        baseUrl,
        `/api/users/${userId}/test-account`,
        {
          method: "POST",
          accountId,
        },
      );
    },

    unregisterTestAccount(userId: string, accountId: string) {
      return request<{ is_test_account: boolean; test_account_id: string | null; changed: boolean }>(
        baseUrl,
        `/api/users/${userId}/test-account`,
        {
          method: "DELETE",
          accountId,
        },
      );
    },
  };
}

function buildChats(baseUrl: string) {
  return {
    list(
      accountId: string,
      params?: { page?: number; status?: string; assigned_operator_id?: string; search?: string },
    ) {
      const p = new URLSearchParams();
      p.set("page", String(params?.page ?? 1));
      if (params?.status) p.set("status", params.status);
      if (params?.assigned_operator_id) p.set("assigned_operator_id", params.assigned_operator_id);
      if (params?.search) p.set("search", params.search);
      return request<unknown>(baseUrl, `/api/chats?${p}`, { accountId });
    },

    messages(igUserId: string, accountId: string, params?: { limit?: number; before?: number }) {
      const p = new URLSearchParams();
      if (params?.limit) p.set("limit", String(params.limit));
      if (params?.before) p.set("before", String(params.before));
      const qs = p.toString();
      return request<unknown[]>(baseUrl, `/api/chats/${igUserId}/messages${qs ? `?${qs}` : ""}`, {
        accountId,
      });
    },

    updateStatus(igUserId: string, accountId: string, status: ConversationStatus, customLabel?: string) {
      return request<undefined>(baseUrl, `/api/chats/${igUserId}/status`, {
        method: "POST",
        body: JSON.stringify({ status, custom_label: customLabel }),
        accountId,
      });
    },

    assign(igUserId: string, accountId: string, operatorId: string) {
      return request<undefined>(baseUrl, `/api/chats/${igUserId}/assign`, {
        method: "POST",
        body: JSON.stringify({ operator_id: operatorId }),
        accountId,
      });
    },

    takeControl(igUserId: string, accountId: string) {
      return request<unknown>(baseUrl, `/api/chats/${igUserId}/take-control`, {
        method: "POST",
        accountId,
      });
    },

    releaseControl(igUserId: string, accountId: string) {
      return request<unknown>(baseUrl, `/api/chats/${igUserId}/release-control`, {
        method: "POST",
        accountId,
      });
    },

    send(igUserId: string, accountId: string, input: SendManualMessageInput) {
      return request<unknown>(baseUrl, `/api/chats/${igUserId}/send`, {
        method: "POST",
        body: JSON.stringify(input),
        accountId,
      });
    },
  };
}

function buildAnalytics(baseUrl: string) {
  return {
    delivery(accountId: string, params?: { period?: string }) {
      const p = new URLSearchParams();
      if (params?.period) p.set("period", params.period);
      const qs = p.toString();
      return request<DeliveryMetricsResponse>(
        baseUrl,
        `/api/analytics/delivery${qs ? `?${qs}` : ""}`,
        { accountId },
      );
    },

    health(accountId: string) {
      return request<AccountHealthResponse>(baseUrl, "/api/analytics/health", {
        accountId,
      });
    },
  };
}

function buildCampaigns(baseUrl: string) {
  return {
    list(
      accountId: string,
      params?: { page?: number; limit?: number; kind?: string; status?: string },
    ) {
      const p = new URLSearchParams();
      p.set("page", String(params?.page ?? 1));
      p.set("limit", String(params?.limit ?? 20));
      if (params?.kind) p.set("kind", params.kind);
      if (params?.status) p.set("status", params.status);
      return request<unknown>(baseUrl, `/api/campaigns?${p}`, {
        accountId,
      });
    },

    get(id: string, accountId: string) {
      return request<unknown>(baseUrl, `/api/campaigns/${id}`, {
        accountId,
      });
    },

    create(accountId: string, input: CreateCampaignInput) {
      return request<unknown>(baseUrl, "/api/campaigns", {
        method: "POST",
        body: JSON.stringify(input),
        accountId,
      });
    },

    update(id: string, input: UpdateCampaignInput) {
      return request<unknown>(baseUrl, `/api/campaigns/${id}`, {
        method: "PUT",
        body: JSON.stringify(input),
      });
    },

    delete(id: string) {
      return request<undefined>(baseUrl, `/api/campaigns/${id}`, {
        method: "DELETE",
      });
    },

    cancel(id: string, version: number) {
      return request<unknown>(baseUrl, `/api/campaigns/${id}/cancel`, {
        method: "POST",
        body: JSON.stringify({ version }),
      });
    },

    resume(id: string, version: number) {
      return request<unknown>(baseUrl, `/api/campaigns/${id}/resume`, {
        method: "POST",
        body: JSON.stringify({ version }),
      });
    },

    entries(
      id: string,
      accountId: string,
      params?: { page?: number; limit?: number; result?: string; ig_user_id?: string },
    ) {
      const p = new URLSearchParams();
      p.set("page", String(params?.page ?? 1));
      p.set("limit", String(params?.limit ?? 50));
      if (params?.result) p.set("result", params.result);
      if (params?.ig_user_id) p.set("ig_user_id", params.ig_user_id);
      return request<unknown>(baseUrl, `/api/campaigns/${id}/entries?${p}`, {
        accountId,
      });
    },

    draw(id: string, accountId: string) {
      return request<unknown>(baseUrl, `/api/campaigns/${id}/draw`, {
        method: "POST",
        accountId,
      });
    },

    selectWinners(id: string, accountId: string, winnerIgUserIds: string[]) {
      return request<unknown>(baseUrl, `/api/campaigns/${id}/select-winners`, {
        method: "POST",
        body: JSON.stringify({ winner_ig_user_ids: winnerIgUserIds }),
        accountId,
      });
    },
  };
}

// --- Response types ---

export interface DailyDeliveryStatResponse {
  date: string;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
}

export interface DeliveryMetricsResponse {
  daily_stats: DailyDeliveryStatResponse[];
  total_sent: number;
  total_delivered: number;
  total_read: number;
  total_failed: number;
  read_rate: number;
  click_count: number;
  click_rate: number;
  cv_event_count: number;
  window_validity_rate: number;
  window_expiry_dropout_rate: number;
  scenario_completion_rate: number;
}

export interface AccountHealthResponse {
  account_id: string;
  ig_username: string | null;
  connected: boolean;
  token_expires_at: number;
  token_days_remaining: number;
  health_score: "normal" | "warning" | "danger";
  rate_limit_usage: {
    daily_sent: number;
    daily_limit: number;
    usage_percent: number;
  };
}

// --- Public API ---

export type ApiClient = {
  scenarios: ReturnType<typeof buildScenarios>;
  triggers: ReturnType<typeof buildTriggers>;
  automations: ReturnType<typeof buildAutomations>;
  surveys: ReturnType<typeof buildSurveys>;
  templates: ReturnType<typeof buildTemplates>;
  users: ReturnType<typeof buildUsers>;
  chats: ReturnType<typeof buildChats>;
  analytics: ReturnType<typeof buildAnalytics>;
  campaigns: ReturnType<typeof buildCampaigns>;
};

export function createApiClient(baseUrl: string): ApiClient {
  return {
    scenarios: buildScenarios(baseUrl),
    triggers: buildTriggers(baseUrl),
    automations: buildAutomations(baseUrl),
    surveys: buildSurveys(baseUrl),
    templates: buildTemplates(baseUrl),
    users: buildUsers(baseUrl),
    chats: buildChats(baseUrl),
    analytics: buildAnalytics(baseUrl),
    campaigns: buildCampaigns(baseUrl),
  };
}
