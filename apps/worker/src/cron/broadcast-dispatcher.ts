import type { Env } from "../env.js";
import { createBroadcastAdminService } from "../services/broadcast-admin.js";

export type BroadcastTaskResult = {
  processed: number;
  errors: Array<{ broadcastId: string; message: string }>;
};

export async function handleBroadcastTasks(env: Env): Promise<BroadcastTaskResult> {
  const service = createBroadcastAdminService({
    db: env.DB,
    sendQueue: env.SEND_QUEUE,
    now: () => Math.floor(Date.now() / 1000),
  });

  return service.dispatchDueBroadcasts();
}
