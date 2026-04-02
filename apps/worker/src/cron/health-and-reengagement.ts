import type { Env } from "../env.js";
import { createReEngagementService } from "../services/re-engagement-service.js";
import { createSloMonitorService, type SloCheckResult } from "../services/slo-monitor-service.js";
import { createHealthMonitor, type HealthCheckResult } from "../services/health-monitor.js";
import { handleCampaignTasks, type CampaignTaskResult } from "./campaign-dispatcher.js";
import { handleBroadcastTasks, type BroadcastTaskResult } from "./broadcast-dispatcher.js";

export type HealthAndReengagementResult = {
  reengagementProcessed: number;
  reengagementErrors: Array<{ accountId: string; message: string }>;
  slo: SloCheckResult | null;
  healthCheck: HealthCheckResult | null;
  campaigns: CampaignTaskResult | null;
  broadcasts: BroadcastTaskResult | null;
};

/**
 * 5分間隔Cronで実行:
 * - ウィンドウ失効前Quick Reply送信（Req 3.5）
 * - SLO違反検知・アラート・エスカレーション（Req 21.1, 21.9, 21.10）
 * - HealthMonitor: APIエラー率・レート制限・ポリシー違反監視（Req 14.1）
 */
export async function handleHealthAndReengagement(
  env: Env,
): Promise<HealthAndReengagementResult> {
  const reEngagementService = createReEngagementService({
    db: env.DB,
    sendQueue: env.SEND_QUEUE,
  });

  const reEngagementResult = await reEngagementService.execute();

  // SLO監視（Webhook URLが設定されている場合のみ実行）
  let slo: SloCheckResult | null = null;
  if (env.SLO_NOTIFY_WEBHOOK_URL) {
    const sloService = createSloMonitorService({
      db: env.DB,
      kv: env.KV,
      notifyWebhookUrl: env.SLO_NOTIFY_WEBHOOK_URL,
      fetch: globalThis.fetch,
      now: () => Math.floor(Date.now() / 1000),
    });

    const sloResult = await sloService.execute();
    if (sloResult.ok) {
      slo = sloResult.value;
    }
  }

  // HealthMonitor: アカウントヘルスチェック（Req 14.1-14.3）
  let healthCheck: HealthCheckResult | null = null;
  const healthMonitor = createHealthMonitor({
    db: env.DB,
    kv: env.KV,
    now: () => Math.floor(Date.now() / 1000),
  });

  const healthResult = await healthMonitor.executeHealthCheck();
  if (healthResult.ok) {
    healthCheck = healthResult.value;
  }

  // キャンペーン処理（既存処理の後に実行）
  let campaigns: CampaignTaskResult | null = null;
  try {
    campaigns = await handleCampaignTasks(env);
  } catch (e) {
    console.error("[CampaignDispatcher] handleCampaignTasks failed", e);
  }

  let broadcasts: BroadcastTaskResult | null = null;
  try {
    broadcasts = await handleBroadcastTasks(env);
  } catch (e) {
    console.error("[BroadcastDispatcher] handleBroadcastTasks failed", e);
  }

  return {
    reengagementProcessed: reEngagementResult.processed,
    reengagementErrors: reEngagementResult.errors,
    slo,
    healthCheck,
    campaigns,
    broadcasts,
  };
}
