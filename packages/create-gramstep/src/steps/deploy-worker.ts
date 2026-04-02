import { writeFileSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import * as p from "@clack/prompts";
import pc from "picocolors";
import { wrangler, WranglerError } from "../lib/wrangler.js";
import type { SetupState } from "../lib/state.js";

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
  const tmpTomlPath = join(workerDir, "wrangler.deploy.toml");

  const toml = `name = "${state.workerName}"
main = "src/index.ts"
compatibility_date = "2024-09-23"
compatibility_flags = ["nodejs_compat"]

[vars]
META_API_VERSION = "v25.0"

[[d1_databases]]
binding = "DB"
database_name = "${state.d1DatabaseName}"
database_id = "${state.d1DatabaseId}"

[[kv_namespaces]]
binding = "KV"
id = "${state.kvNamespaceId}"

[[queues.producers]]
binding = "SEND_QUEUE"
queue = "${state.sendQueueName}"

[[queues.consumers]]
queue = "${state.sendQueueName}"
max_batch_size = 10
max_batch_timeout = 5
dead_letter_queue = "${state.dlqName}"

[[queues.producers]]
binding = "DLQ"
queue = "${state.dlqName}"

[[r2_buckets]]
binding = "R2"
bucket_name = "${state.r2BucketName}"

[[workflows]]
binding = "DRIP_WORKFLOW"
name = "${state.workerName}-drip-workflow"
class_name = "DripWorkflow"

[triggers]
crons = [
  "*/5 * * * *",
  "0 3 * * *"
]
`;

  writeFileSync(tmpTomlPath, toml, "utf-8");

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
    // Always clean up temporary config
    if (existsSync(tmpTomlPath)) {
      unlinkSync(tmpTomlPath);
    }
  }
}
