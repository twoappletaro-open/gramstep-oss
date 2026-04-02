import type { MessagingEvent, MessageData } from "./webhook-handler.js";

const recentEventIds = new Set<string>();
const MAX_MEMORY_SET_SIZE = 10000;

export interface ProcessResult {
  skipped: boolean;
  reason?: "is_echo" | "duplicate" | "unsupported_object";
  eventType?: string;
  messageType?: string;
  stateUpdateSkipped?: boolean;
}

export function classifyMessageType(
  message: Partial<MessageData>,
): string {
  if (message.text) return "text";

  if (message.attachments && message.attachments.length > 0) {
    const type = message.attachments[0]?.type;
    if (type === "image") return "image";
    if (type === "audio") return "audio";
    if (type === "video") return "video";
    if (type === "file") return "file";
    return "unsupported";
  }

  if (message.quick_reply) return "quick_reply";
  if (message.sticker_id) return "unsupported";

  return "unsupported";
}

function getEventId(event: MessagingEvent): string {
  if (event.message) return event.message.mid;
  if (event.postback) return event.postback.mid;
  return `${event.sender.id}_${event.timestamp}`;
}

function getEventType(event: MessagingEvent): string {
  if (event.message) return "message";
  if (event.postback) return "postback";
  if (event.referral) return "referral";
  if (event.read) return "read";
  if (event.reaction) return "reaction";
  return "unknown";
}

export async function processWebhookEvent(
  event: MessagingEvent,
  accountId: string,
  db: D1Database,
): Promise<ProcessResult> {
  // is_echo フィルタ（自己ループ防止）
  if (event.message?.is_echo) {
    return { skipped: true, reason: "is_echo" };
  }

  const eventId = getEventId(event);
  const eventType = getEventType(event);

  // メモリSet一次重複フィルタ
  if (recentEventIds.has(eventId)) {
    return { skipped: true, reason: "duplicate" };
  }

  // D1 INSERT OR IGNORE（UNIQUE制約による最終冪等性保証）
  const insertResult = await db
    .prepare(
      "INSERT OR IGNORE INTO webhook_events (event_id, account_id, event_type) VALUES (?, ?, ?)",
    )
    .bind(eventId, accountId, eventType)
    .run();

  if (insertResult.meta.changes === 0) {
    return { skipped: true, reason: "duplicate" };
  }

  // メモリSetに追加（サイズ制限付き）
  if (recentEventIds.size >= MAX_MEMORY_SET_SIZE) {
    const firstKey = recentEventIds.values().next().value;
    if (firstKey !== undefined) {
      recentEventIds.delete(firstKey);
    }
  }
  recentEventIds.add(eventId);

  // イベント順序保証: timestampとlast_interaction_atの比較
  const eventTimestamp = Math.floor(event.timestamp / 1000);
  let stateUpdateSkipped = false;

  const existingUser = await db
    .prepare(
      "SELECT id, last_interaction_at FROM ig_users WHERE account_id = ? AND ig_scoped_id = ?",
    )
    .bind(accountId, event.sender.id)
    .first<{ id: string; last_interaction_at: number | null }>();

  if (existingUser?.last_interaction_at && eventTimestamp < existingUser.last_interaction_at) {
    stateUpdateSkipped = true;
  }

  const messageType = event.message ? classifyMessageType(event.message) : undefined;

  return {
    skipped: false,
    eventType,
    messageType,
    stateUpdateSkipped,
  };
}
