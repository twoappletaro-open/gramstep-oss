import { ok, err, createAppError } from "@gramstep/shared";
import type { Result, AppError } from "@gramstep/shared";

export interface StoreReceivedMediaInput {
  accountId: string;
  messageLogId: string;
  messageId: string;
  mediaUrl: string;
  filename: string;
}

export interface StoreReceivedMediaResult {
  r2Key: string;
  deduplicated: boolean;
}

function buildR2Key(accountId: string, messageId: string, filename: string): string {
  return `media/${accountId}/received/${messageId}/${filename}`;
}

function buildDedupKey(accountId: string, sha256: string): string {
  return `_dedup/${accountId}/${sha256}`;
}

async function computeSha256Hex(data: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function storeReceivedMedia(
  db: D1Database,
  r2: R2Bucket,
  input: StoreReceivedMediaInput,
  fetchFn: typeof fetch,
): Promise<Result<StoreReceivedMediaResult, AppError>> {
  // 1. Check if message_log exists
  const existing = await db
    .prepare("SELECT id, account_id, media_r2_key FROM message_logs WHERE id = ?")
    .bind(input.messageLogId)
    .first<{ id: string; account_id: string; media_r2_key: string | null }>();

  if (!existing) {
    return err(createAppError("NOT_FOUND", `Message log not found: ${input.messageLogId}`));
  }

  // 2. Idempotency: skip if already stored
  if (existing.media_r2_key) {
    return ok({ r2Key: existing.media_r2_key, deduplicated: false });
  }

  // 3. Fetch media from Instagram URL
  const response = await fetchFn(input.mediaUrl);
  if (!response.ok) {
    return err(
      createAppError("EXTERNAL_API_ERROR", `Failed to fetch media: HTTP ${response.status}`),
    );
  }

  const mediaBuffer = await response.arrayBuffer();

  // 4. Compute SHA-256 hash
  const sha256 = await computeSha256Hex(mediaBuffer);
  const dedupKey = buildDedupKey(input.accountId, sha256);

  // 5. Check dedup index for existing identical binary
  const dedupEntry = await r2.get(dedupKey);
  if (dedupEntry) {
    const existingR2Key = await dedupEntry.text();
    // Update message_log to point to existing R2 key
    await db
      .prepare("UPDATE message_logs SET media_r2_key = ? WHERE id = ?")
      .bind(existingR2Key, input.messageLogId)
      .run();
    return ok({ r2Key: existingR2Key, deduplicated: true });
  }

  // 6. Upload to R2
  const r2Key = buildR2Key(input.accountId, input.messageId, input.filename);
  const contentType = response.headers.get("Content-Type") ?? "application/octet-stream";

  await r2.put(r2Key, mediaBuffer, {
    httpMetadata: { contentType },
    customMetadata: { sha256 },
  });

  // 7. Store dedup index entry
  await r2.put(dedupKey, new TextEncoder().encode(r2Key).buffer as ArrayBuffer);

  // 8. Update message_log with R2 key
  await db
    .prepare("UPDATE message_logs SET media_r2_key = ? WHERE id = ?")
    .bind(r2Key, input.messageLogId)
    .run();

  return ok({ r2Key, deduplicated: false });
}
