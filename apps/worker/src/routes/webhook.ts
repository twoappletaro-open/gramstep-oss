import { Hono } from "hono";
import type { Env } from "../env.js";
import {
  verifySignature,
  bufferToKV,
  extractEventId,
  processEntryAsync,
} from "../services/webhook-handler.js";
import type { WebhookPayload } from "../services/webhook-handler.js";

const webhook = new Hono<{ Bindings: Env }>();

// Webhook Verification Challenge (GET)
webhook.get("/webhook", (c) => {
  const mode = c.req.query("hub.mode");
  const token = c.req.query("hub.verify_token");
  const challenge = c.req.query("hub.challenge");

  if (mode === "subscribe" && token === c.env.WEBHOOK_VERIFY_TOKEN && challenge) {
    return c.text(challenge, 200);
  }

  return c.json({ error: "Forbidden" }, 403);
});

// Webhook Signature Verification + Event Processing (POST)
webhook.post("/webhook", async (c) => {
  const body = await c.req.text();
  const signatureHeader = c.req.header("X-Hub-Signature-256") ?? null;

  const isValid = await verifySignature(body, signatureHeader, c.env.META_APP_SECRET);
  if (!isValid) {
    return c.json({ error: "Invalid signature" }, 403);
  }

  let payload: WebhookPayload;
  try {
    payload = JSON.parse(body) as WebhookPayload;
  } catch {
    return c.json({ error: "Bad request" }, 400);
  }

  if (payload.object !== "instagram" || !Array.isArray(payload.entry)) {
    return c.json({ status: "ignored" }, 200);
  }

  // 同期処理（Metaの5秒タイムアウト内で完了）
  for (const entry of payload.entry) {
    try {
      await processEntryAsync(entry, c.env);
    } catch {
      if (entry.messaging) {
        for (const event of entry.messaging) {
          const eventId = extractEventId(event);
          await bufferToKV(c.env.KV, eventId, JSON.stringify({ entry, event }));
        }
      }
    }
  }

  return c.json({ status: "ok" }, 200);
});

export { webhook };
