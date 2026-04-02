import type { ScenarioStep, Account } from "@gramstep/db";
import { generateId } from "@gramstep/db";
import {
  AccountSettingsSchema,
  ConditionConfigSchema,
  type AccountSettings,
} from "@gramstep/shared";
import { evaluateCondition } from "./condition-evaluator.js";

/** Cloudflare Workflows step interface (subset used by DripWorkflow) */
export interface WorkflowStepLike {
  do<T>(name: string, fn: () => Promise<T>): Promise<T>;
  sleep(name: string, duration: string | number): Promise<void>;
  sleepUntil(name: string, date: Date): Promise<void>;
}

export interface DripWorkflowParams {
  enrollmentId: string;
  scenarioId: string;
  accountId: string;
  igUserId: string;
}

export interface DripWorkflowDeps {
  db: D1Database;
  sendQueue: Queue;
}

async function getAccountSettings(
  db: D1Database,
  accountId: string,
): Promise<{ timezone: string; settings: AccountSettings }> {
  const row = await db
    .prepare("SELECT timezone, settings FROM accounts WHERE id = ?")
    .bind(accountId)
    .first<Account>();

  const timezone = row?.timezone ?? "Asia/Tokyo";
  let settings: AccountSettings;
  try {
    settings = AccountSettingsSchema.parse(JSON.parse(row?.settings ?? "{}"));
  } catch {
    settings = AccountSettingsSchema.parse({});
  }
  return { timezone, settings };
}

function isWithinDeliveryWindow(
  nowMs: number,
  timezone: string,
  windowStart: number,
  windowEnd: number,
): boolean {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hour12: false,
      timeZone: timezone,
    });
    const hour = parseInt(formatter.format(new Date(nowMs)), 10);
    return hour >= windowStart && hour < windowEnd;
  } catch {
    // Fallback: assume within window on timezone error
    return true;
  }
}

function getNextDeliveryWindowStart(
  nowMs: number,
  timezone: string,
  windowStart: number,
): Date {
  try {
    // Calculate the next window start in the account's timezone
    const dateFormatter = new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
      timeZone: timezone,
    });
    const parts = dateFormatter.formatToParts(new Date(nowMs));
    const getValue = (type: string): string =>
      parts.find((p) => p.type === type)?.value ?? "0";

    const currentHour = parseInt(getValue("hour"), 10);

    // If before window start today, wait until today's window start
    // If after window end, wait until tomorrow's window start
    const hoursToWait =
      currentHour < windowStart
        ? windowStart - currentHour
        : 24 - currentHour + windowStart;

    return new Date(nowMs + hoursToWait * 3600 * 1000);
  } catch {
    // Fallback: wait 1 hour
    return new Date(nowMs + 3600 * 1000);
  }
}

async function saveCheckpoint(
  db: D1Database,
  params: DripWorkflowParams,
  nextStepOrder: number,
  resumeAt: number,
): Promise<void> {
  const id = generateId();
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      `INSERT OR REPLACE INTO workflow_checkpoints (id, enrollment_id, scenario_id, account_id, ig_user_id, next_step_order, resume_at, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
    )
    .bind(
      id,
      params.enrollmentId,
      params.scenarioId,
      params.accountId,
      params.igUserId,
      nextStepOrder,
      resumeAt,
      now,
    )
    .run();
}

export async function executeDripWorkflow(
  params: DripWorkflowParams,
  step: WorkflowStepLike,
  deps: DripWorkflowDeps,
): Promise<void> {
  const { db, sendQueue } = deps;
  const { enrollmentId, scenarioId, accountId, igUserId } = params;

  // 1. Fetch all steps for this scenario
  const steps = await step.do(`fetch-steps`, async () => {
    const result = await db
      .prepare(
        "SELECT * FROM scenario_steps WHERE scenario_id = ? ORDER BY step_order ASC",
      )
      .bind(scenarioId)
      .all<ScenarioStep>();
    return result.results ?? [];
  });

  if (steps.length === 0) {
    return;
  }

  // Build step_order → index lookup for branching
  const stepByOrder = new Map<number, ScenarioStep>();
  for (const s of steps) {
    stepByOrder.set(s.step_order, s);
  }

  // 2. Process steps — supports branching via condition_config
  let currentIndex = 0;
  while (currentIndex < steps.length) {
    const scenarioStep = steps[currentIndex];
    if (!scenarioStep) break;

    // 2a. Handle delay — step.sleep() or step.sleepUntil()
    if (scenarioStep.absolute_datetime) {
      await step.sleepUntil(
        `wait-until-step-${scenarioStep.step_order}`,
        new Date(scenarioStep.absolute_datetime * 1000),
      );
    } else if (scenarioStep.delay_seconds > 0) {
      await step.sleep(
        `delay-step-${scenarioStep.step_order}`,
        `${scenarioStep.delay_seconds} seconds`,
      );
    }

    // 2b. Delivery window check — wait until within delivery hours
    await step.do(`delivery-window-step-${scenarioStep.step_order}`, async () => {
      const { timezone, settings } = await getAccountSettings(db, accountId);

      // Check user-specific timezone/delivery hour
      const userRow = await db
        .prepare("SELECT timezone, preferred_delivery_hour FROM ig_users WHERE id = ?")
        .bind(igUserId)
        .first<{ timezone: string | null; preferred_delivery_hour: number | null }>();

      const effectiveTz = userRow?.timezone ?? timezone;
      const windowStart = userRow?.preferred_delivery_hour ?? settings.delivery_window_start;
      const windowEnd = settings.delivery_window_end;

      const nowMs = Date.now();
      if (!isWithinDeliveryWindow(nowMs, effectiveTz, windowStart, windowEnd)) {
        const nextStart = getNextDeliveryWindowStart(nowMs, effectiveTz, windowStart);
        return { shouldWait: true, waitUntil: nextStart.getTime() };
      }
      return { shouldWait: false, waitUntil: 0 };
    }).then(async (windowResult: { shouldWait: boolean; waitUntil: number }) => {
      if (windowResult.shouldWait) {
        await step.sleepUntil(
          `window-wait-step-${scenarioStep.step_order}`,
          new Date(windowResult.waitUntil),
        );
      }
    });

    // 2c. Check 24-hour messaging window validity
    const windowActive = await step.do(
      `check-window-step-${scenarioStep.step_order}`,
      async () => {
        const window = await db
          .prepare(
            "SELECT window_expires_at, is_active FROM messaging_windows WHERE account_id = ? AND ig_user_id = ?",
          )
          .bind(accountId, igUserId)
          .first<{ window_expires_at: number; is_active: number }>();

        if (!window || window.is_active !== 1) {
          return false;
        }
        const now = Math.floor(Date.now() / 1000);
        return window.window_expires_at > now;
      },
    );

    if (!windowActive) {
      await step.do(`window-expired-${scenarioStep.step_order}`, async () => {
        const now = Math.floor(Date.now() / 1000);
        await db
          .prepare(
            "UPDATE scenario_enrollments SET status = 'window_expired', current_step_order = ? WHERE id = ?",
          )
          .bind(scenarioStep.step_order, enrollmentId)
          .run();

        await saveCheckpoint(db, params, scenarioStep.step_order, now);
      });
      return;
    }

    // 2d. Enqueue message for delivery
    await step.do(`enqueue-step-${scenarioStep.step_order}`, async () => {
      const messageId = generateId();
      await sendQueue.send({
        id: messageId,
        accountId,
        igUserId,
        recipientId: igUserId,
        messagePayload: scenarioStep.message_payload,
        mediaCategory: scenarioStep.message_type === "image" ? "image" : "text",
        sourceType: "scenario",
        sourceId: scenarioId,
        enrollmentId,
        retryCount: 0,
      });

      await db
        .prepare(
          "UPDATE scenario_enrollments SET current_step_order = ? WHERE id = ?",
        )
        .bind(scenarioStep.step_order, enrollmentId)
        .run();
    });

    // 2e. Evaluate condition_config for branching
    if (scenarioStep.condition_config) {
      const branchResult = await step.do(
        `evaluate-condition-step-${scenarioStep.step_order}`,
        async () => {
          const parsed = ConditionConfigSchema.safeParse(
            JSON.parse(scenarioStep.condition_config as string),
          );
          if (!parsed.success) {
            return null;
          }
          const result = await evaluateCondition(
            parsed.data,
            { igUserId, accountId },
            { db },
          );
          return result;
        },
      );

      if (branchResult && branchResult.type === "branch") {
        // Find the target step index
        const targetIndex = steps.findIndex(
          (s: ScenarioStep) => s.step_order === branchResult.nextStepOrder,
        );
        if (targetIndex >= 0) {
          currentIndex = targetIndex;
          continue;
        }
        // Target step not found — end workflow
        break;
      }
    }

    currentIndex++;
  }

  // 3. All steps completed — mark enrollment as completed
  await step.do(`complete-enrollment`, async () => {
    const now = Math.floor(Date.now() / 1000);
    await db
      .prepare(
        "UPDATE scenario_enrollments SET status = 'completed', completed_at = ? WHERE id = ?",
      )
      .bind(now, enrollmentId)
      .run();

    // Clean up checkpoint if exists
    await db
      .prepare(
        "UPDATE workflow_checkpoints SET status = 'cancelled' WHERE enrollment_id = ? AND status = 'pending'",
      )
      .bind(enrollmentId)
      .run();
  });
}
