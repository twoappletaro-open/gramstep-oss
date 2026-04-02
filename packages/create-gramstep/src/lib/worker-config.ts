import { writeFileSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { SetupState } from "./state.js";

export function writeWorkerConfig(workerDir: string, state: SetupState, filename = "wrangler.deploy.toml"): string {
  const configPath = join(workerDir, filename);
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

  writeFileSync(configPath, toml, "utf-8");
  return configPath;
}

export function cleanupWorkerConfig(configPath: string): void {
  if (existsSync(configPath)) {
    unlinkSync(configPath);
  }
}
