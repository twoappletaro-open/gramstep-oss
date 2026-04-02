import type { Env } from "../env.js";
import { processEntryAsync } from "./webhook-handler.js";
import type { WebhookEntry, MessagingEvent } from "./webhook-handler.js";

export type D1BufferReplayResult = {
  status: "completed" | "skipped_d1_unavailable";
  replayed: number;
  failed: number;
  deleted: number;
  errors: Array<{ key: string; message: string }>;
};

const MAX_REPLAY_BATCH = 100;

async function isD1Available(db: D1Database): Promise<boolean> {
  try {
    await db.prepare("SELECT 1").bind().first();
    return true;
  } catch {
    return false;
  }
}

async function listAllBufferKeys(
  kv: KVNamespace,
): Promise<string[]> {
  const keys: string[] = [];
  let cursor: string | undefined;

  do {
    const listResult = await kv.list({
      prefix: "d1_buffer:",
      ...(cursor ? { cursor } : {}),
    });

    for (const key of listResult.keys) {
      keys.push(key.name);
      if (keys.length >= MAX_REPLAY_BATCH) {
        return keys;
      }
    }

    if (listResult.list_complete) break;
    cursor = listResult.cursor;
  } while (cursor);

  return keys;
}

export async function replayD1Buffer(env: Env): Promise<D1BufferReplayResult> {
  const result: D1BufferReplayResult = {
    status: "completed",
    replayed: 0,
    failed: 0,
    deleted: 0,
    errors: [],
  };

  // D1復旧検知
  const d1Ready = await isD1Available(env.DB);
  if (!d1Ready) {
    result.status = "skipped_d1_unavailable";
    return result;
  }

  // KVバッファキーをスキャン
  const bufferKeys = await listAllBufferKeys(env.KV);

  for (const key of bufferKeys) {
    const payload = await env.KV.get(key);

    // 値がnull（TTL失効等）→ クリーンアップ削除
    if (payload === null) {
      await env.KV.delete(key);
      result.deleted++;
      continue;
    }

    try {
      const parsed = JSON.parse(payload) as {
        entry: WebhookEntry;
        event: MessagingEvent;
      };

      // processEntryAsyncで再処理（冪等性はINSERT OR IGNOREで保証）
      await processEntryAsync(parsed.entry, env);

      // 成功 → KVキー削除
      await env.KV.delete(key);
      result.replayed++;
      result.deleted++;
    } catch (e) {
      result.failed++;
      result.errors.push({
        key,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return result;
}
