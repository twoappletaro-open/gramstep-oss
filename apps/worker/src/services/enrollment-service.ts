import { generateId } from "@gramstep/db";
import type { Scenario, ScenarioEnrollment } from "@gramstep/db";
import type { Result, AppError } from "@gramstep/shared";
import { ok, err, createAppError } from "@gramstep/shared";

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
}

export function createEnrollmentService(
  deps: EnrollmentServiceDeps,
): EnrollmentServiceInterface {
  const { db, dripWorkflow } = deps;

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

      // 3. Create enrollment
      const enrollmentId = generateId();
      const now = Math.floor(Date.now() / 1000);

      // 4. Create Workflow instance (1 enrollment = 1 Workflow instance)
      const workflowInstance = await dripWorkflow.create({
        id: `drip-${enrollmentId}`,
        params: {
          enrollmentId,
          scenarioId,
          igUserId,
          accountId,
        },
      });

      const workflowInstanceId = workflowInstance.id;

      await db
        .prepare(
          `INSERT INTO scenario_enrollments (id, scenario_id, ig_user_id, account_id, current_step_order, workflow_instance_id, status, started_at, completed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
        )
        .bind(enrollmentId, scenarioId, igUserId, accountId, 1, workflowInstanceId, "active", now)
        .run();

      return ok({
        id: enrollmentId,
        scenarioId,
        igUserId,
        accountId,
        currentStepOrder: 1,
        workflowInstanceId,
        status: "active",
        startedAt: now,
        completedAt: null,
      });
    },
  };
}
