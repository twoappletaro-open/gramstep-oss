import { ok, err, createAppError } from "@gramstep/shared";
import type { Result } from "@gramstep/shared";
import type { AppError } from "@gramstep/shared";
import type { IgUser } from "@gramstep/db";

function buildR2Key(accountId: string, igScopedId: string): string {
  return `media/${accountId}/profile/${igScopedId}.jpg`;
}

export async function fetchAndStoreProfileImage(
  db: D1Database,
  r2: R2Bucket,
  accountId: string,
  userId: string,
  igScopedId: string,
  imageUrl: string,
  fetchFn: typeof fetch,
  force = false,
): Promise<Result<string, AppError>> {
  const user = await db
    .prepare("SELECT * FROM ig_users WHERE id = ? AND account_id = ? AND is_deleted = 0")
    .bind(userId, accountId)
    .first<IgUser>();

  if (!user) {
    return err(createAppError("NOT_FOUND", "User not found"));
  }

  const r2Key = buildR2Key(accountId, igScopedId);

  // Return existing key if already stored and not forcing refresh
  if (user.profile_image_r2_key && !force) {
    const existing = await r2.head(user.profile_image_r2_key);
    if (existing) {
      return ok(user.profile_image_r2_key);
    }
  }

  // Fetch image from Instagram signed URL
  const response = await fetchFn(imageUrl);
  if (!response.ok) {
    return err(
      createAppError("EXTERNAL_API_ERROR", `Failed to fetch profile image: HTTP ${response.status}`),
    );
  }

  const imageBuffer = await response.arrayBuffer();

  // Store in R2
  await r2.put(r2Key, imageBuffer, {
    httpMetadata: {
      contentType: response.headers.get("Content-Type") ?? "image/jpeg",
    },
  });

  // Update user record with R2 key
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare("UPDATE ig_users SET profile_image_r2_key = ?, updated_at = ? WHERE id = ?")
    .bind(r2Key, now, userId)
    .run();

  return ok(r2Key);
}
