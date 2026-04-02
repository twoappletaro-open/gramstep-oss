import { join } from "node:path";
import * as p from "@clack/prompts";
import pc from "picocolors";
import { wrangler, WranglerError } from "../lib/wrangler.js";
import type { SetupState } from "../lib/state.js";
import { cleanupWorkerConfig, writeWorkerConfig } from "../lib/worker-config.js";

/** Generate temporary wrangler.toml, deploy worker via --config, restore original */
export async function deployWorker(state: SetupState, projectDir: string): Promise<void> {
  p.log.step(pc.bold("Worker デプロイ"));
  p.log.info("workers.devサブドメインの登録が必要です（初回のみ）。");
  p.log.info("未登録の場合: https://dash.cloudflare.com → Workers & Pages → Overview → 初期セットアップ完了");

  const ready = await p.confirm({
    message: "workers.devサブドメインは登録済みですか？",
    initialValue: true,
  });
  if (p.isCancel(ready) || !ready) {
    throw new Error("workers.devサブドメイン登録後に再実行してください");
  }

  const workerDir = join(projectDir, "apps", "worker");
  const tmpTomlPath = writeWorkerConfig(workerDir, state);

  const spinner = p.spinner();
  spinner.start("Workerをデプロイ中...");
  try {
    const output = wrangler(["deploy", "--config", tmpTomlPath], workerDir);

    const urlMatch = output.match(/(https:\/\/[^\s]+\.workers\.dev)/);
    state.workerUrl = urlMatch?.[1] ?? `https://${state.workerName}.workers.dev`;

    spinner.stop(`Workerデプロイ完了: ${pc.cyan(state.workerUrl)}`);
  } catch (e: unknown) {
    spinner.stop("Workerデプロイ失敗");
    const stderr = e instanceof WranglerError ? e.stderr : "";
    if (stderr.includes("workers.dev subdomain") || stderr.includes("onboarding")) {
      p.log.error("workers.devサブドメインが未登録です。");
      p.log.error(`以下のURLで登録してください:`);
      const urlMatch = stderr.match(/(https:\/\/dash\.cloudflare\.com\/[^\s]+onboarding)/);
      if (urlMatch?.[1]) {
        p.log.error(`  ${pc.cyan(urlMatch[1])}`);
      }
      p.log.error("登録後、再実行してください。");
    }
    throw e;
  } finally {
    cleanupWorkerConfig(tmpTomlPath);
  }
}
