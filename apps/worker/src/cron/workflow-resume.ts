import type { Env } from "../env.js";
import type { WorkflowCheckpoint } from "@gramstep/db";
import { executeQuery, executeRun } from "@gramstep/db";
import { replayD1Buffer, type D1BufferReplayResult } from "../services/d1-buffer-replay.js";

export type WorkflowResumeResult = {
  resumed: number;
  skipped: number;
  failed: number;
  errors: Array<{ enrollmentId: string; message: string }>;
  bufferReplay?: D1BufferReplayResult;
};

const RESUMABLE_STATUSES = new Set(["window_expired", "active"]);

export async function handleWorkflowResume(
  env: Env,
): Promise<WorkflowResumeResult> {
  const now = Math.floor(Date.now() / 1000);

  const queryResult = await executeQuery<WorkflowCheckpoint>(
    env.DB,
    "SELECT * FROM workflow_checkpoints WHERE status = 'pending' AND resume_at <= ? ORDER BY resume_at ASC LIMIT 100",
    now,
  );

  if (!queryResult.ok) {
    return {
      resumed: 0,
      skipped: 0,
      failed: 0,
      errors: [{ enrollmentId: "query", message: queryResult.error.message }],
    };
  }

  const checkpoints = queryResult.value.results;
  const result: WorkflowResumeResult = {
    resumed: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  for (const cp of checkpoints) {
    // Check enrollment is still resumable
    const enrollment = await env.DB
      .prepare("SELECT status FROM scenario_enrollments WHERE id = ?")
      .bind(cp.enrollment_id)
      .first<{ status: string }>();

    if (!enrollment || !RESUMABLE_STATUSES.has(enrollment.status)) {
      // Enrollment completed/cancelled/deleted — mark checkpoint as cancelled
      await executeRun(
        env.DB,
        "UPDATE workflow_checkpoints SET status = 'cancelled' WHERE id = ?",
        cp.id,
      );
      result.skipped++;
      continue;
    }

    try {
      // Create new Workflow instance to resume from checkpoint
      await (env.DRIP_WORKFLOW as Workflow).create({
        id: `drip-resume-${cp.enrollment_id}-${now}`,
        params: {
          enrollmentId: cp.enrollment_id,
          scenarioId: cp.scenario_id,
          accountId: cp.account_id,
          igUserId: cp.ig_user_id,
        },
      });

      // Update enrollment status to active
      await executeRun(
        env.DB,
        "UPDATE scenario_enrollments SET status = 'active' WHERE id = ?",
        cp.enrollment_id,
      );

      // Mark checkpoint as resumed
      await executeRun(
        env.DB,
        "UPDATE workflow_checkpoints SET status = 'resumed' WHERE id = ?",
        cp.id,
      );

      result.resumed++;
    } catch (e) {
      result.failed++;
      result.errors.push({
        enrollmentId: cp.enrollment_id,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // D1障害復旧時のKVバッファ再処理
  result.bufferReplay = await replayD1Buffer(env);

  return result;
}
