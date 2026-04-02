import { Hono } from "hono";
import type { Env } from "../../env.js";

const variableRoutes = new Hono<{ Bindings: Env }>();

function getAccountId(c: { get: (key: string) => unknown }): string {
  return (c.get("accountId" as never) as string) ?? "";
}

variableRoutes.get("/options", async (c) => {
  const accountId = getAccountId(c);
  if (!accountId) {
    return c.json({ error: "Missing accountId" }, 400);
  }

  const [tagsResult, customVariablesResult, metadataRows] = await Promise.all([
    c.env.DB
      .prepare("SELECT name FROM tags WHERE account_id = ? ORDER BY name ASC")
      .bind(accountId)
      .all<{ name: string }>(),
    c.env.DB
      .prepare("SELECT name, data_source, metadata_key FROM custom_variables WHERE account_id = ? ORDER BY name ASC")
      .bind(accountId)
      .all<{ name: string; data_source: string; metadata_key: string | null }>(),
    c.env.DB
      .prepare(
        `SELECT metadata FROM ig_users
         WHERE account_id = ? AND metadata IS NOT NULL AND metadata != '' AND metadata != '{}'
         ORDER BY updated_at DESC
         LIMIT 100`,
      )
      .bind(accountId)
      .all<{ metadata: string }>(),
  ]);

  const metadataKeys = new Set<string>();
  for (const row of metadataRows.results ?? []) {
    try {
      const parsed = JSON.parse(row.metadata) as Record<string, unknown>;
      for (const key of Object.keys(parsed)) {
        metadataKeys.add(key);
      }
    } catch {
      // ignore invalid metadata json
    }
  }

  return c.json({
    base: [
      { label: "お名前", token: "{{display_name}}", sample: "田中 太郎" },
      { label: "ユーザー名", token: "{{username}}", sample: "tanaka_taro" },
      { label: "スコア", token: "{{score}}", sample: "42" },
      { label: "IGユーザーID", token: "{{ig_user_id}}", sample: "1784..." },
    ],
    metadata: Array.from(metadataKeys).sort().map((key) => ({
      label: `メタデータ ${key}`,
      token: `{{meta:${key}}}`,
      sample: key,
    })),
    tags: (tagsResult.results ?? []).flatMap((tag) => ([
      {
        label: `タグ ${tag.name}`,
        token: `{{tag:${tag.name}}}`,
        sample: "true / false",
      },
      {
        label: `タグ条件 ${tag.name}`,
        token: `{{#if_tag:${tag.name}}}...{{/if_tag}}`,
        sample: "条件表示",
      },
    ])),
    custom: (customVariablesResult.results ?? []).map((variable) => ({
      label: `カスタム ${variable.name}`,
      token: `{{custom:${variable.name}}}`,
      sample: variable.metadata_key ?? variable.data_source,
    })),
  });
});

export { variableRoutes };

