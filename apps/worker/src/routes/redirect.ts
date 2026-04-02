import { Hono } from "hono";
import type { Env } from "../env.js";
import type { LinkClickAction } from "@gramstep/shared";
import { createLinkTracker } from "../services/link-tracker.js";

export const redirectRoute = new Hono<{ Bindings: Env }>();

async function executeClickActions(
  db: D1Database,
  accountId: string,
  igUserId: string,
  actions: LinkClickAction[],
): Promise<void> {
  for (const action of actions) {
    switch (action.type) {
      case "add_tag": {
        const tag = await db
          .prepare(`SELECT id FROM tags WHERE account_id = ? AND name = ?`)
          .bind(accountId, action.tag_name)
          .first<{ id: string }>();
        if (tag) {
          await db
            .prepare(`INSERT OR IGNORE INTO ig_user_tags (ig_user_id, tag_id, created_at) VALUES (?, ?, unixepoch())`)
            .bind(igUserId, tag.id)
            .run();
        }
        break;
      }
      case "enroll_scenario": {
        const scenario = await db
          .prepare(`SELECT id FROM scenarios WHERE id = ? AND account_id = ? AND is_active = 1`)
          .bind(action.scenario_id, accountId)
          .first<{ id: string }>();
        if (scenario) {
          // Enrollment will be handled by existing ScenarioEngine via Queues
          // For now, record the intent - full enrollment requires Workflow integration
        }
        break;
      }
    }
  }
}

redirectRoute.get("/r/:code", async (c) => {
  const code = c.req.param("code");
  const tracker = createLinkTracker({ db: c.env.DB, now: () => Math.floor(Date.now() / 1000) });

  const linkResult = await tracker.getByShortCode(code);
  if (!linkResult.ok) {
    return c.text("Not Found", 404);
  }

  const link = linkResult.value;

  const rawUid = c.req.query("uid");
  const igUserId = rawUid && rawUid.length > 0 ? rawUid : null;

  // Record click + execute actions asynchronously (don't block redirect)
  c.executionCtx.waitUntil(
    (async () => {
      await tracker.recordClick(link.id, link.account_id, igUserId);
      if (igUserId && link.click_actions.length > 0) {
        await executeClickActions(c.env.DB, link.account_id, igUserId, link.click_actions);
      }
    })(),
  );

  return c.redirect(link.original_url, 302);
});
