import * as p from "@clack/prompts";
import pc from "picocolors";
import { wranglerWithStdin } from "../lib/wrangler.js";
import type { SetupState } from "../lib/state.js";

/** Set Cloudflare Worker secrets via wrangler (stdin, never in args) */
export async function setSecrets(state: SetupState, projectDir: string): Promise<void> {
  p.log.step(pc.bold("環境変数（Secrets）設定"));

  const workerDir = `${projectDir}/apps/worker`;
  const secrets: Record<string, string> = {
    META_APP_SECRET: state.metaAppSecret,
    META_APP_ID: state.metaAppId,
    WEBHOOK_VERIFY_TOKEN: state.webhookVerifyToken,
    ENCRYPTION_KEY: state.encryptionKey,
    JWT_SECRET: state.jwtSecret,
    REFRESH_SECRET: state.refreshSecret,
    DASHBOARD_URL: state.dashboardUrl || state.adminUrl || "https://localhost:3000",
  };

  const spinner = p.spinner();
  spinner.start("Secretsを設定中...");

  const errors: string[] = [];
  let count = 0;
  for (const [name, value] of Object.entries(secrets)) {
    if (!value) {
      errors.push(`${name} が空のためスキップ`);
      continue;
    }
    try {
      wranglerWithStdin(["secret", "put", name], value, workerDir);
      count++;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "";
      errors.push(`${name}: ${msg.slice(0, 100)}`);
    }
  }

  if (errors.length > 0) {
    spinner.stop(`Secrets設定失敗（${count}/${Object.keys(secrets).length}）`);
    throw new Error(`Secrets設定エラー: ${errors.join(" / ")}`);
  }
  spinner.stop(`Secrets設定完了（${count}/${Object.keys(secrets).length}）`);
}
