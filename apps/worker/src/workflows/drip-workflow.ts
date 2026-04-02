import { WorkflowEntrypoint } from "cloudflare:workers";
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";
import type { Env } from "../env.js";
import {
  executeDripWorkflow,
  type DripWorkflowParams,
} from "../services/drip-workflow.js";

export class DripWorkflow extends WorkflowEntrypoint<Env, DripWorkflowParams> {
  async run(
    event: Readonly<WorkflowEvent<DripWorkflowParams>>,
    step: WorkflowStep,
  ): Promise<void> {
    await executeDripWorkflow(event.payload, step, {
      db: this.env.DB,
      sendQueue: this.env.SEND_QUEUE,
    });
  }
}
