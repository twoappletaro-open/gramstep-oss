import { writeFileSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import * as p from "@clack/prompts";
import pc from "picocolors";
import { wrangler, extractId, WranglerError } from "../lib/wrangler.js";
import type { SetupState } from "../lib/state.js";

function writeTempToml(workerDir: string, content: string): string {
  const tmpPath = join(workerDir, "wrangler.tmp.toml");
  writeFileSync(tmpPath, content, "utf-8");
  return tmpPath;
}

/** Generate a minimal temporary wrangler.toml for CLI bootstrap commands */
function writeBootstrapToml(workerDir: string): string {
  return writeTempToml(workerDir, `name = "gramstep-setup-tmp"
compatibility_date = "2024-09-23"
`);
}

/** Generate a minimal temporary wrangler.toml for D1 operations */
function writeD1Toml(workerDir: string, dbName: string, dbId: string): string {
  return writeTempToml(workerDir, `name = "gramstep-setup-tmp"
compatibility_date = "2024-09-23"

[[d1_databases]]
binding = "DB"
database_name = "${dbName}"
database_id = "${dbId}"
`);
}

function cleanupTempToml(tmpPath: string): void {
  if (existsSync(tmpPath)) unlinkSync(tmpPath);
}

function isAlreadyExists(e: unknown): boolean {
  const patterns = ["already exists", "already taken", "already been"];
  if (e instanceof WranglerError) {
    return patterns.some((p) => e.stderr.includes(p) || e.message.includes(p));
  }
  return e instanceof Error && patterns.some((p) => e.message.includes(p));
}

/** Create D1 database and apply migrations */
export async function createDatabase(state: SetupState, projectDir: string): Promise<void> {
  p.log.step(pc.bold("D1 データベース作成"));
  const workerDir = `${projectDir}/apps/worker`;
  const bootstrapToml = writeBootstrapToml(workerDir);

  try {
    if (!state.d1DatabaseId) {
      const spinner = p.spinner();
      spinner.start("D1データベースを作成中...");
      try {
        const output = wrangler(["d1", "create", state.d1DatabaseName, "--config", bootstrapToml], workerDir);
        const id = extractId(output, /database_id\s*=\s*"([^"]+)"/) ??
                  extractId(output, /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/);
        if (!id) throw new Error(`D1 ID抽出失敗: ${output}`);
        state.d1DatabaseId = id;
        spinner.stop(`D1作成完了: ${id.slice(0, 8)}...`);
      } catch (e: unknown) {
        spinner.stop("D1作成中にエラー");
        if (isAlreadyExists(e)) {
          // Resolve existing DB ID via list
          const listOutput = wrangler(["d1", "list", "--json", "--config", bootstrapToml], workerDir);
          const dbs = JSON.parse(listOutput) as Array<{ uuid: string; name: string }>;
          const existing = dbs.find((db) => db.name === state.d1DatabaseName);
          if (existing) {
            state.d1DatabaseId = existing.uuid;
            p.log.info(`既存D1を検出: ${existing.uuid.slice(0, 8)}...`);
          } else {
            throw e;
          }
        } else {
          throw e;
        }
      }
    } else {
      p.log.info(`D1既存: ${state.d1DatabaseId.slice(0, 8)}...`);
    }

    // Apply migrations using temporary wrangler.toml with real D1 ID
    const tmpToml = writeD1Toml(workerDir, state.d1DatabaseName, state.d1DatabaseId);
    const spinner2 = p.spinner();
    spinner2.start("マイグレーションを適用中...");
    try {
      wrangler(["d1", "migrations", "apply", "DB", "--remote", "--config", tmpToml], workerDir);
      spinner2.stop("マイグレーション完了（13テーブル）");
    } catch (e: unknown) {
      spinner2.stop("マイグレーション適用中にエラー");
      const msg = e instanceof Error ? e.message : "";
      if (msg.includes("already been applied")) {
        p.log.info("マイグレーションは適用済みです");
      } else {
        throw e;
      }
    } finally {
      cleanupTempToml(tmpToml);
    }
  } finally {
    cleanupTempToml(bootstrapToml);
  }
}

/** Create KV namespace */
export async function createKv(state: SetupState, projectDir: string): Promise<void> {
  p.log.step(pc.bold("KV Namespace 作成"));
  if (!state.kvNamespaceId) {
    const spinner = p.spinner();
    spinner.start("KV Namespaceを作成中...");
    try {
      const output = wrangler(["kv", "namespace", "create", "KV"], projectDir);
      // Match both TOML (id = "...") and JSON ("id": "...") formats
      const id = extractId(output, /"id":\s*"([^"]+)"/) ?? extractId(output, /id\s*=\s*"([^"]+)"/);
      if (!id) throw new Error(`KV ID抽出失敗: ${output}`);
      state.kvNamespaceId = id;
      spinner.stop(`KV作成完了: ${id.slice(0, 8)}...`);
    } catch (e: unknown) {
      spinner.stop("KV作成中にエラー");
      if (isAlreadyExists(e)) {
        // Resolve existing KV namespace ID
        try {
          const listOutput = wrangler(["kv", "namespace", "list"], projectDir);
          const namespaces = JSON.parse(listOutput) as Array<{ id: string; title: string }>;
          const existing = namespaces.find((ns) => ns.title.includes("KV"));
          if (existing) {
            state.kvNamespaceId = existing.id;
            p.log.info(`既存KVを検出: ${existing.id.slice(0, 8)}...`);
          } else {
            throw new Error("既存KV NamespaceのID解決に失敗しました。手動でIDを設定してください。");
          }
        } catch (listErr: unknown) {
          throw new Error(`KV ID解決失敗: ${listErr instanceof Error ? listErr.message : "unknown"}`);
        }
      } else {
        throw e;
      }
    }
  } else {
    p.log.info(`KV既存: ${state.kvNamespaceId.slice(0, 8)}...`);
  }
}

/** Create Queues */
export async function createQueues(state: SetupState, projectDir: string): Promise<void> {
  p.log.step(pc.bold("Queues 作成"));
  p.log.info("Queuesが未有効化の場合: https://dash.cloudflare.com → Workers & Pages → Queues で有効化");

  const ready = await p.confirm({
    message: "Queuesは有効化済みですか？",
    initialValue: true,
  });
  if (p.isCancel(ready) || !ready) {
    throw new Error("Queues有効化後に再実行してください");
  }

  const spinner = p.spinner();
  spinner.start("Queuesを作成中...");
  for (const name of [state.sendQueueName, state.dlqName]) {
    try {
      wrangler(["queues", "create", name], projectDir);
    } catch (e: unknown) {
      if (!isAlreadyExists(e)) throw e;
    }
  }
  spinner.stop("Queues作成完了 (send + DLQ)");
}

/** Create R2 bucket */
export async function createR2(state: SetupState, projectDir: string): Promise<void> {
  p.log.step(pc.bold("R2 Bucket 作成"));
  p.log.info("R2はCloudflare Dashboardで事前に有効化が必要です（無料）。");
  p.log.info("未有効化の場合: https://dash.cloudflare.com → R2 Object Storage → Activate R2");

  const ready = await p.confirm({
    message: "R2は有効化済みですか？（有効化してからEnterを押してください）",
    initialValue: true,
  });
  if (p.isCancel(ready) || !ready) {
    throw new Error("R2有効化後に再実行してください");
  }

  const spinner = p.spinner();
  spinner.start("R2 Bucketを作成中...");
  try {
    wrangler(["r2", "bucket", "create", state.r2BucketName], projectDir);
    spinner.stop("R2作成完了");
  } catch (e: unknown) {
    spinner.stop("R2作成中にエラー");
    if (isAlreadyExists(e)) {
      p.log.info("R2 Bucketは既に存在します。");
    } else {
      const msg = e instanceof Error ? e.message : "";
      const stderr = e instanceof WranglerError ? e.stderr : "";
      if (msg.includes("10042") || stderr.includes("enable R2")) {
        p.log.error("R2が有効化されていません。");
        p.log.error("1. https://dash.cloudflare.com にアクセス");
        p.log.error("2. 左メニュー「R2 Object Storage」をクリック");
        p.log.error("3.「Activate R2」をクリック（無料、カード登録要）");
        p.log.error("4. 有効化後、このコマンドを再実行してください");
      }
      throw e;
    }
  }
}
