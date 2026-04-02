import { Hono } from "hono";
import type { Env } from "../env.js";

export const docsRoute = new Hono<{ Bindings: Env }>();

const openApiSpec = {
  openapi: "3.0.3",
  info: {
    title: "GramStep API",
    description:
      "Instagram Graph APIを活用したOSSステップ配信CRMシステムのREST API",
    version: "1.0.0",
    license: {
      name: "MIT",
    },
  },
  servers: [
    {
      url: "/",
      description: "Current server",
    },
  ],
  paths: {
    "/api/scenarios": {
      get: {
        summary: "シナリオ一覧取得",
        tags: ["Scenarios"],
        security: [{ BearerAuth: [] }, { ApiKeyAuth: [] }],
        parameters: [
          {
            name: "page",
            in: "query",
            schema: { type: "integer", default: 1 },
          },
          {
            name: "per_page",
            in: "query",
            schema: { type: "integer", default: 20 },
          },
        ],
        responses: {
          "200": { description: "シナリオ一覧" },
          "401": { description: "認証エラー" },
        },
      },
      post: {
        summary: "シナリオ作成",
        tags: ["Scenarios"],
        security: [{ BearerAuth: [] }, { ApiKeyAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/CreateScenarioInput" },
            },
          },
        },
        responses: {
          "201": { description: "作成成功" },
          "400": { description: "バリデーションエラー" },
          "401": { description: "認証エラー" },
        },
      },
    },
    "/api/scenarios/{id}": {
      get: {
        summary: "シナリオ詳細取得",
        tags: ["Scenarios"],
        security: [{ BearerAuth: [] }, { ApiKeyAuth: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": { description: "シナリオ詳細" },
          "404": { description: "見つかりません" },
        },
      },
      put: {
        summary: "シナリオ更新",
        tags: ["Scenarios"],
        security: [{ BearerAuth: [] }, { ApiKeyAuth: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": { description: "更新成功" },
          "404": { description: "見つかりません" },
          "409": { description: "バージョン衝突" },
        },
      },
      delete: {
        summary: "シナリオ削除",
        tags: ["Scenarios"],
        security: [{ BearerAuth: [] }, { ApiKeyAuth: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: {
          "204": { description: "削除成功" },
          "404": { description: "見つかりません" },
        },
      },
    },
    "/api/triggers": {
      get: {
        summary: "トリガー一覧取得",
        tags: ["Triggers"],
        security: [{ BearerAuth: [] }, { ApiKeyAuth: [] }],
        responses: {
          "200": { description: "トリガー一覧" },
        },
      },
      post: {
        summary: "トリガー作成",
        tags: ["Triggers"],
        security: [{ BearerAuth: [] }, { ApiKeyAuth: [] }],
        responses: {
          "201": { description: "作成成功" },
        },
      },
    },
    "/api/triggers/{id}": {
      get: {
        summary: "トリガー詳細取得",
        tags: ["Triggers"],
        security: [{ BearerAuth: [] }, { ApiKeyAuth: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": { description: "トリガー詳細" },
        },
      },
      put: {
        summary: "トリガー更新",
        tags: ["Triggers"],
        security: [{ BearerAuth: [] }, { ApiKeyAuth: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": { description: "更新成功" },
        },
      },
      delete: {
        summary: "トリガー削除",
        tags: ["Triggers"],
        security: [{ BearerAuth: [] }, { ApiKeyAuth: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: {
          "204": { description: "削除成功" },
        },
      },
    },
    "/api/users": {
      get: {
        summary: "ユーザー一覧取得",
        tags: ["Users"],
        security: [{ BearerAuth: [] }, { ApiKeyAuth: [] }],
        parameters: [
          {
            name: "page",
            in: "query",
            schema: { type: "integer", default: 1 },
          },
          {
            name: "per_page",
            in: "query",
            schema: { type: "integer", default: 20 },
          },
          {
            name: "follower_status",
            in: "query",
            schema: { type: "string", enum: ["following", "not_following", "unknown"] },
          },
        ],
        responses: {
          "200": { description: "ユーザー一覧" },
        },
      },
    },
    "/api/users/{id}": {
      get: {
        summary: "ユーザー詳細取得",
        tags: ["Users"],
        security: [{ BearerAuth: [] }, { ApiKeyAuth: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": { description: "ユーザー詳細" },
        },
      },
      put: {
        summary: "ユーザー更新",
        tags: ["Users"],
        security: [{ BearerAuth: [] }, { ApiKeyAuth: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": { description: "更新成功" },
        },
      },
    },
    "/api/users/{id}/tags": {
      post: {
        summary: "ユーザーにタグ追加",
        tags: ["Users"],
        security: [{ BearerAuth: [] }, { ApiKeyAuth: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: {
          "201": { description: "タグ追加成功" },
        },
      },
    },
    "/api/users/{id}/opt-out": {
      post: {
        summary: "ユーザーオプトアウト",
        tags: ["Users"],
        security: [{ ApiKeyAuth: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": { description: "オプトアウト成功" },
        },
      },
    },
    "/api/chats": {
      get: {
        summary: "チャット一覧取得",
        tags: ["Chats"],
        security: [{ BearerAuth: [] }],
        responses: {
          "200": { description: "チャット一覧" },
        },
      },
    },
    "/api/chats/{id}/messages": {
      post: {
        summary: "手動メッセージ送信",
        tags: ["Chats"],
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": { description: "送信成功" },
        },
      },
    },
    "/api/analytics/delivery": {
      get: {
        summary: "配信メトリクス取得",
        tags: ["Analytics"],
        security: [{ BearerAuth: [] }],
        responses: {
          "200": { description: "配信メトリクス" },
        },
      },
    },
    "/api/analytics/health": {
      get: {
        summary: "アカウントヘルス取得",
        tags: ["Analytics"],
        security: [{ BearerAuth: [] }],
        responses: {
          "200": { description: "ヘルス情報" },
        },
      },
    },
    "/api/audit-logs": {
      get: {
        summary: "監査ログ一覧取得",
        tags: ["Audit"],
        security: [{ BearerAuth: [] }],
        responses: {
          "200": { description: "監査ログ一覧" },
        },
      },
    },
    "/api/auth/connect": {
      get: {
        summary: "OAuth認証フロー開始",
        tags: ["Auth"],
        responses: {
          "302": { description: "Instagram OAuthへリダイレクト" },
        },
      },
    },
    "/api/auth/callback": {
      get: {
        summary: "OAuthコールバック",
        tags: ["Auth"],
        responses: {
          "302": { description: "ダッシュボードへリダイレクト" },
        },
      },
    },
    "/api/messages/send": {
      post: {
        summary: "手動メッセージ送信",
        tags: ["Messages"],
        security: [{ BearerAuth: [] }],
        responses: {
          "200": { description: "送信成功" },
        },
      },
    },
    "/health": {
      get: {
        summary: "ヘルスチェック",
        tags: ["System"],
        responses: {
          "200": { description: "稼働中" },
        },
      },
    },
    "/webhook": {
      get: {
        summary: "Webhook検証チャレンジ",
        tags: ["System"],
        responses: {
          "200": { description: "hub.challengeを返却" },
        },
      },
      post: {
        summary: "Webhookイベント受信",
        tags: ["System"],
        responses: {
          "200": { description: "受信完了" },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      BearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description: "JWT アクセストークン",
      },
      ApiKeyAuth: {
        type: "apiKey",
        in: "header",
        name: "X-API-Key",
        description: "APIキー認証",
      },
    },
    schemas: {
      CreateScenarioInput: {
        type: "object",
        required: ["name", "trigger_type", "steps"],
        properties: {
          name: { type: "string", minLength: 1, maxLength: 255 },
          trigger_type: {
            type: "string",
            enum: [
              "comment",
              "story_comment",
              "story_mention",
              "live_comment",
              "dm",
              "url_param",
              "ice_breaker",
            ],
          },
          trigger_config: { type: "string", default: "{}" },
          steps: {
            type: "array",
            minItems: 1,
            items: { $ref: "#/components/schemas/ScenarioStep" },
          },
          bot_disclosure_enabled: { type: "boolean", default: false },
        },
      },
      ScenarioStep: {
        type: "object",
        required: ["step_order", "message_type", "message_payload"],
        properties: {
          step_order: { type: "integer", minimum: 1 },
          delay_seconds: { type: "integer", minimum: 0, default: 0 },
          message_type: {
            type: "string",
            enum: ["text", "image", "generic", "quick_reply"],
          },
          message_payload: { type: "string" },
        },
      },
    },
  },
  tags: [
    { name: "Scenarios", description: "シナリオ（ステップ配信）管理" },
    { name: "Triggers", description: "トリガー管理" },
    { name: "Users", description: "ユーザー管理" },
    { name: "Chats", description: "チャット・会話管理" },
    { name: "Analytics", description: "分析・メトリクス" },
    { name: "Audit", description: "監査ログ" },
    { name: "Auth", description: "認証" },
    { name: "Messages", description: "メッセージ送信" },
    { name: "System", description: "システム・ヘルスチェック" },
  ],
};

docsRoute.get("/docs", (c) => {
  return c.json(openApiSpec);
});
