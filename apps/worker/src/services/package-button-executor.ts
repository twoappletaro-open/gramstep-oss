import type { IInstagramClient } from "@gramstep/ig-sdk";
import type { Template as TemplateRow } from "@gramstep/db";
import { createAppError, err, ok, type AppError, type Result, type TriggerAction } from "@gramstep/shared";
import { parsePackageBody, parsePackageButtonPayload } from "./package-format.js";
import { createTriggerActionExecutor } from "./trigger-action-executor.js";
import type { EnrollmentServiceInterface } from "./enrollment-service.js";

export interface PackageButtonExecutorDeps {
  db: D1Database;
  kv: KVNamespace;
  igClient: IInstagramClient;
  enrollmentService: EnrollmentServiceInterface;
  sendQueue: Queue<import("@gramstep/shared").SendQueueMessage>;
  fetchFn?: typeof fetch;
}

export interface HandlePackageButtonInput {
  accountId: string;
  igUserId: string;
  recipientId: string;
  payload: string | null | undefined;
  accessToken: string;
  appSecretProof: string;
}

export function createPackageButtonExecutor(deps: PackageButtonExecutorDeps) {
  const executor = createTriggerActionExecutor({
    db: deps.db,
    kv: deps.kv,
    igClient: deps.igClient,
    enrollmentService: deps.enrollmentService,
    sendQueue: deps.sendQueue,
    fetchFn: deps.fetchFn ?? fetch,
  });

  return {
    async handle(input: HandlePackageButtonInput): Promise<Result<{ handled: boolean }, AppError>> {
      const parsedPayload = parsePackageButtonPayload(input.payload);
      if (!parsedPayload) {
        return ok({ handled: false });
      }

      const row = await deps.db
        .prepare("SELECT id, body FROM templates WHERE id = ? AND account_id = ?")
        .bind(parsedPayload.packageId, input.accountId)
        .first<Pick<TemplateRow, "id" | "body">>();

      if (!row) {
        return err(createAppError("NOT_FOUND", "Package not found"));
      }

      const packageBody = parsePackageBody(row.body);
      if (!packageBody) {
        return err(createAppError("NOT_FOUND", "Package not found"));
      }

      const button = packageBody.buttons.find((candidate): boolean => candidate.id === parsedPayload.buttonId);
      if (!button) {
        return err(createAppError("NOT_FOUND", "Package button not found"));
      }

      const selectionMode = button.action.selectionMode
        ?? (button.action.useFollowerCondition ? "follower_condition" : "specific");

      let action: TriggerAction;
      if (selectionMode === "follower_condition") {
        if (!button.action.followerPackageId || !button.action.nonFollowerPackageId) {
          return err(createAppError("VALIDATION_ERROR", "Follower condition package target is not configured"));
        }
        action = {
          type: "send_template_by_follower_status",
          followerTemplateId: button.action.followerPackageId,
          nonFollowerTemplateId: button.action.nonFollowerPackageId,
        };
      } else if (selectionMode === "random") {
        const candidates = (button.action.packageIds ?? []).filter((value): value is string => value.length > 0);
        if (candidates.length === 0) {
          return err(createAppError("VALIDATION_ERROR", "Random package targets are not configured"));
        }
        const index = Math.floor(Math.random() * candidates.length);
        action = {
          type: "send_template",
          templateId: candidates[index]!,
        };
      } else {
        if (!button.action.packageId) {
          return err(createAppError("VALIDATION_ERROR", "Package target is not configured"));
        }
        action = {
          type: "send_template",
          templateId: button.action.packageId,
        };
      }

      const result = await executor.executeActions([action], {
        accountId: input.accountId,
        igUserId: input.igUserId,
        triggerId: row.id,
        accessToken: input.accessToken,
        appSecretProof: input.appSecretProof,
        recipientId: input.recipientId,
      });
      if (!result.ok) {
        return err(result.error);
      }

      return ok({ handled: true });
    },
  };
}
