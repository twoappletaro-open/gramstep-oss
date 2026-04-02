import { Hono } from "hono";
import type { Env } from "../../env.js";

const mediaUploadRoutes = new Hono<{ Bindings: Env }>();

// POST /api/media/upload — R2にファイルアップロード、公開URLを返却
mediaUploadRoutes.post("/upload", async (c) => {
  const contentType = c.req.header("Content-Type") ?? "";

  if (!contentType.includes("multipart/form-data")) {
    return c.json({ error: "multipart/form-data required" }, 400);
  }

  const formData = await c.req.formData();
  const file = formData.get("file");

  if (!file || !(file instanceof File)) {
    return c.json({ error: "file field required" }, 400);
  }

  // バリデーション
  const maxSize = 25 * 1024 * 1024; // 25MB
  if (file.size > maxSize) {
    return c.json({ error: "File too large (max 25MB)" }, 400);
  }

  const allowedTypes = ["image/jpeg", "image/png", "image/gif", "image/webp", "video/mp4", "audio/mpeg", "audio/mp4"];
  if (!allowedTypes.includes(file.type)) {
    return c.json({ error: `Unsupported file type: ${file.type}` }, 400);
  }

  // ハッシュベースのR2キー（重複排除）
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const hash = Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
  const ext = file.name.split(".").pop() ?? "bin";
  const accountId = c.get("accountId" as never) as string || "default";
  const r2Key = `media/${accountId}/send/${hash}.${ext}`;

  // R2にアップロード
  await c.env.R2.put(r2Key, buffer, {
    httpMetadata: { contentType: file.type },
  });

  // 公開URL（R2のパブリックアクセスが有効な場合）またはWorker経由のプロキシURL
  const workerUrl = new URL(c.req.url).origin;
  const publicUrl = `${workerUrl}/api/media/${r2Key}`;

  return c.json({ url: publicUrl, r2Key, size: file.size, contentType: file.type }, 201);
});

// GET /api/media/media/:accountId/send/:filename — R2からメディア配信
mediaUploadRoutes.get("/media/:accountId/send/:hash", async (c) => {
  const accountId = c.req.param("accountId");
  const hash = c.req.param("hash");
  const r2Key = `media/${accountId}/send/${hash}`;

  const object = await c.env.R2.get(r2Key);
  if (!object) {
    return c.json({ error: "Not found" }, 404);
  }

  const headers = new Headers();
  headers.set("Content-Type", object.httpMetadata?.contentType ?? "application/octet-stream");
  headers.set("Cache-Control", "public, max-age=31536000, immutable");

  return new Response(object.body, { headers });
});

export { mediaUploadRoutes };
