import { generateId } from "@gramstep/db";
import type { Scenario, ScenarioEnrollment, ScenarioStep } from "@gramstep/db";
import type { MessagePayload } from "@gramstep/ig-sdk";
import type { Result, AppError } from "@gramstep/shared";
import { ok, err, createAppError } from "@gramstep/shared";
import { loadVariableRenderContext, renderMessagePayloadVariables } from "./message-variable-renderer.js";

export interface EnrollmentView {
  id: string;
  scenarioId: string;
  igUserId: string;
  accountId: string;
  currentStepOrder: number;
  workflowInstanceId: string | null;
  status: string;
  startedAt: number;
  completedAt: number | null;
}

export interface EnrollmentServiceInterface {
  enrollUser(
    scenarioId: string,
    igUserId: string,
    accountId: string,
  ): Promise<Result<EnrollmentView, AppError>>;
}

export interface EnrollmentServiceDeps {
  db: D1Database;
  dripWorkflow: Workflow;
  sendImmediate?: (input: {
    messageId: string;
    accountId: string;
    igUserId: string;
    recipientId: string;
    sourceId: string;
    message: MessagePayload;
  }) => Promise<Result<void, AppError>>;
}

function canSendImmediately(step: ScenarioStep): boolean {
  return !step.absolute_datetime && step.delay_seconds <= 0 && !step.condition_config;
}

function normalizeImmediatePayload(raw: string): MessagePayload {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    if (
      parsed.type === "quick_reply"
      || Array.isArray(parsed.quick_replies)
      || Array.isArray(parsed.quickReplies)
    ) {
      const replies = (parsed.quickReplies ?? parsed.quick_replies ?? []) as Array<Record<string, unknown>>;
      return {
        type: "quick_reply",
        text: typeof parsed.text === "string" ? parsed.text : "",
        quickReplies: replies.map((reply) => ({
          contentType: "text",
          title: String(reply.title ?? ""),
          payload: String(reply.payload ?? reply.title ?? ""),
        })),
      };
    }

    if (parsed.type === "image" || typeof parsed.url === "string") {
      return {
        type: "image",
        url: String(parsed.url ?? ""),
      };
    }

    if (parsed.type === "generic" || parsed.type === "rich_menu" || Array.isArray(parsed.elements)) {
      return {
        type: "generic",
        imageAspectRatio: parsed.imageAspectRatio === "horizontal" || parsed.image_aspect_ratio === "horizontal" ? "horizontal" : "square",
        elements: (parsed.elements ?? []) as MessagePayload extends infer _Never ? never : Array<{ title: string; subtitle?: string; imageUrl?: string; defaultAction?: { type: "web_url"; url: string }; buttons?: Array<{ type: "web_url"; title: string; url: string } | { type: "postback"; title: string; payload: string }> }>,
      } as unknown as MessagePayload;
    }

    if (typeof parsed.text === "string") {
      return {
        type: "text",
        text: parsed.text,
      };
    }
  } catch {
    // Fall through to plain text handling
  }

  return {
    type: "text",
    text: raw,
  };
}

function getPayloadText(payload: MessagePayload): string | null {
  switch (payload.type) {
    case "text":
    case "quick_reply":
      return payload.text;
    default:
      return null;
  }
}

export function createEnrollmentService(
  deps: EnrollmentServiceDeps,
): EnrollmentServiceInterface {
  const { db, dripWorkflow, sendImmediate } = deps;

  return {
    async enrollUser(scenarioId, igUserId, accountId) {
      // 1. Verify scenario exists and is active
      const scenario = await db
        .prepare("SELECT id, account_id, name, is_active FROM scenarios WHERE id = ?")
        .bind(scenarioId)
        .first<Scenario>();

      if (!scenario) {
        return err(createAppError("NOT_FOUND", `Scenario ${scenarioId} not found`));
      }

      if (scenario.account_id !== accountId) {
        return err(createAppError("NOT_FOUND", `Scenario ${scenarioId} not found`));
      }

      if (scenario.is_active !== 1) {
        return err(createAppError("VALIDATION_ERROR", `Scenario ${scenarioId} is not active`));
      }

      // 2. Check for duplicate active enrollment
      const existing = await db
        .prepare(
          "SELECT id FROM scenario_enrollments WHERE scenario_id = ? AND ig_user_id = ? AND status = ?",
        )
        .bind(scenarioId, igUserId, "active")
        .first<ScenarioEnrollment>();

      if (existing) {
        return err(
          createAppError("CONFLICT", `User ${igUserId} already enrolled in scenario ${scenarioId}`),
        );
      }

      const enrollmentId = generateId();
      const now = Math.floor(Date.now() / 1000);
      let currentStepOrder = 1;
      let workflowInstanceId: string | null = null;
      let status = "active";
      let completedAt: number | null = null;
      let startStepOrder = 1;

      if (sendImmediate) {
        const stepsResult = await db
          .prepare("SELECT * FROM scenario_steps WHERE scenario_id = ? ORDER BY step_order ASC")
          .bind(scenarioId)
          .all<ScenarioStep>();
        const steps = stepsResult.results ?? [];

        const immediateSteps: ScenarioStep[] = [];
        for (const scenarioStep of steps) {
          if (!canSendImmediately(scenarioStep)) break;
          immediateSteps.push(scenarioStep);
        }

        if (immediateSteps.length > 0) {
          const user = await db
            .prepare("SELECT ig_scoped_id FROM ig_users WHERE id = ? AND account_id = ?")
            .bind(igUserId, accountId)
            .first<{ ig_scoped_id: string }>();

          if (user?.ig_scoped_id) {
            const renderContext = await loadVariableRenderContext(db, accountId, igUserId);
            for (const scenarioStep of immediateSteps) {
              const messageId = generateId();
              const renderedPayload = renderContext
                ? renderMessagePayloadVariables(scenarioStep.message_payload, renderContext)
                : scenarioStep.message_payload;
              const payload = normalizeImmediatePayload(renderedPayload);

              await db
                .prepare(
                  `INSERT INTO message_logs (id, account_id, ig_user_id, direction, message_type, content, source_type, source_id, delivery_status)
                   VALUES (?, ?, ?, 'outbound', ?, ?, 'scenario', ?, 'queued')`,
                )
                .bind(
                  messageId,
                  accountId,
                  igUserId,
                  payload.type,
                  getPayloadText(payload),
                  scenarioId,
                )
                .run();

              const immediateResult = await sendImmediate({
                messageId,
                accountId,
                igUserId,
                recipientId: user.ig_scoped_id,
                sourceId: scenarioId,
                message: payload,
              });

              if (!immediateResult.ok) {
                await db
                  .prepare("UPDATE message_logs SET delivery_status = 'failed' WHERE id = ?")
                  .bind(messageId)
                  .run()
                  .catch(() => undefined);
                startStepOrder = scenarioStep.step_order;
                break;
              }

              currentStepOrder = scenarioStep.step_order;
              startStepOrder = scenarioStep.step_order + 1;
            }
          }
        }

        if (steps.length > 0 && startStepOrder > steps[steps.length - 1]!.step_order) {
          status = "completed";
          completedAt = now;
          workflowInstanceId = null;
        }
      }

      if (status !== "completed") {
        const workflowInstance = await dripWorkflow.create({
          id: `drip-${enrollmentId}`,
          params: {
            enrollmentId,
            scenarioId,
            igUserId,
            accountId,
            startStepOrder,
          },
        });
        workflowInstanceId = workflowInstance.id;
        if (startStepOrder > 1) {
          currentStepOrder = startStepOrder - 1;
        }
      }

      await db
        .prepare(
          `INSERT INTO scenario_enrollments (id, scenario_id, ig_user_id, account_id, current_step_order, workflow_instance_id, status, started_at, completed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          enrollmentId,
          scenarioId,
          igUserId,
          accountId,
          currentStepOrder,
          workflowInstanceId,
          status,
          now,
          completedAt,
        )
        .run();

      return ok({
        id: enrollmentId,
        scenarioId,
        igUserId,
        accountId,
        currentStepOrder,
        workflowInstanceId,
        status,
        startedAt: now,
        completedAt,
      });
    },
  };
}
