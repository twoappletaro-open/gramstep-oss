import { Hono } from "hono";
import type { Env } from "../env.js";
import {
  verifySignature,
  bufferToKV,
  extractEventId,
  processEntryAsync,
} from "../services/webhook-handler.js";
import type { WebhookPayload } from "../services/webhook-handler.js";
import { getWebhookSecrets, getWebhookVerifyTokens } from "../services/app-failover.js";

const webhook = new Hono<{ Bindings: Env }>();

function getExecutionCtxOrNull(c: { executionCtx: ExecutionContext }): ExecutionContext | null {
  try {
    return c.executionCtx;
  } catch {
    return null;
  }
}

// Webhook Verification Challenge (GET)
webhook.get("/webhook", (c) => {
  return (async () => {
    const mode = c.req.query("hub.mode");
    const token = c.req.query("hub.verify_token");
    const challenge = c.req.query("hub.challenge");
    const verifyTokens = await getWebhookVerifyTokens(c.env);

    if (mode === "subscribe" && token && verifyTokens.includes(token) && challenge) {
      return c.text(challenge, 200);
    }

    return c.json({ error: "Forbidden" }, 403);
  })();
});

// Webhook Signature Verification + Event Processing (POST)
webhook.post("/webhook", async (c) => {
  const body = await c.req.text();
  const signatureHeader = c.req.header("X-Hub-Signature-256") ?? null;
  const executionCtx = getExecutionCtxOrNull(c);

  const secrets = await getWebhookSecrets(c.env);
  let isValid = false;
  for (const secret of secrets) {
    if (await verifySignature(body, signatureHeader, secret)) {
      isValid = true;
      break;
    }
  }
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

  for (const entry of payload.entry) {
    const task = (async () => {
      try {
        await processEntryAsync(entry, c.env, executionCtx ?? undefined);
      } catch {
        if (entry.messaging) {
          for (const event of entry.messaging) {
            const eventId = extractEventId(event);
            await bufferToKV(c.env.KV, eventId, JSON.stringify({ entry, event }));
          }
        }
      }
    })();
    if (executionCtx) {
      executionCtx.waitUntil(task);
    } else {
      void task;
    }
  }

  return c.json({ status: "ok" }, 200);
});

export { webhook };
