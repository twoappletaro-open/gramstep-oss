#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { resolve, join } from "node:path";
import { existsSync, readdirSync, mkdirSync } from "node:fs";
import * as p from "@clack/prompts";
import pc from "picocolors";
import { loadState, saveState, deleteState, isDone, markDone } from "./lib/state.js";
import type { SetupState } from "./lib/state.js";
import { checkDeps } from "./steps/check-deps.js";
import { authenticate } from "./steps/auth.js";
import { collectCredentials } from "./steps/prompts.js";
import { createDatabase, createKv, createQueues, createR2 } from "./steps/database.js";
import { deployWorker } from "./steps/deploy-worker.js";
import { setSecrets } from "./steps/secrets.js";
import { seedOperator } from "./steps/seed-operator.js";
import { deployAdmin } from "./steps/deploy-admin.js";
import { connectInstagram } from "./steps/connect-instagram.js";
import { showSummary } from "./steps/summary.js";

type StepFn = (state: SetupState, dir: string) => Promise<void>;

const PUBLIC_REPO_URL = "https://github.com/twoappletaro-open/gramstep-oss.git";

const STEPS: ReadonlyArray<{ id: string; name: string; fn: StepFn }> = [
  { id: "check-deps", name: "環境チェック", fn: (_s, _d) => checkDeps() },
  { id: "auth", name: "Cloudflare認証", fn: authenticate },
  { id: "prompts", name: "認証情報入力", fn: (s, _d) => collectCredentials(s) },
  { id: "database", name: "D1データベース", fn: createDatabase },
  { id: "kv", name: "KV Namespace", fn: createKv },
  { id: "queues", name: "Queues", fn: createQueues },
  { id: "r2", name: "R2 Bucket", fn: createR2 },
  { id: "deploy-worker", name: "Workerデプロイ", fn: deployWorker },
  { id: "secrets", name: "Secrets設定", fn: setSecrets },
  { id: "seed-operator", name: "管理者作成", fn: seedOperator },
  { id: "deploy-admin", name: "管理画面デプロイ", fn: deployAdmin },
  { id: "connect-instagram", name: "Instagram接続", fn: connectInstagram },
  { id: "summary", name: "完了", fn: (s, _d) => { showSummary(s); return Promise.resolve(); } },
];

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    showHelp();
    return;
  }

  const fresh = args.includes("--fresh");
  const command = args.find((a) => !a.startsWith("-")) ?? "setup";

  if (command === "setup") {
    await setup(fresh);
  } else if (command === "redeploy") {
    await redeploy();
  } else {
    throw new Error(`Unknown command: ${command}`);
  }
}

function showHelp(): void {
  console.log(`
${pc.bold("create-gramstep")} - GramStep ワンコマンドセットアップ

${pc.bold("使い方:")}
  npx create-gramstep            空ディレクトリならGramStep本体を取得してセットアップ
  npx create-gramstep setup      初回セットアップ（Cloudflareにデプロイ）
  npx create-gramstep setup --fresh  状態をリセットして最初からセットアップ
  npx create-gramstep redeploy   コード更新のみ再デプロイ（リソース再作成なし）
  npx create-gramstep --help     ヘルプを表示
`);
}

async function setup(fresh: boolean): Promise<void> {
  console.log("");
  p.intro(pc.bgCyan(pc.black(" GramStep Setup ")));
  p.log.info("Cloudflare無料枠にGramStepをデプロイします。");
  p.log.info("中断しても再実行で途中から再開できます。\n");

  const projectDir = ensureProjectRoot();

  if (fresh) {
    deleteState(projectDir);
    p.log.info(pc.yellow("--fresh: 前回の進捗をリセットしました。最初からセットアップを開始します。"));
  }

  const state = loadState(projectDir);

  // 全ステップ完了済み（前回成功後の再実行）を検知
  const allDone = STEPS.every((s) => isDone(state, s.id));
  if (allDone) {
    p.log.warn("セットアップは既に完了しています。");
    p.log.info("コード更新のみ再デプロイする場合: npx create-gramstep redeploy");
    p.log.info("最初からやり直す場合: npx create-gramstep setup --fresh");
    const force = await p.confirm({
      message: "全リソースを再作成しますか？（既存のSecrets/トークンが再生成され、既存セッションが無効化されます）",
      initialValue: false,
    });
    if (p.isCancel(force) || !force) {
      p.outro("キャンセルしました。");
      return;
    }
    // Reset completed steps for full re-run
    state.completedSteps = [];
  } else if (state.completedSteps.length > 0) {
    p.log.info(`前回の進捗を検出: ${state.completedSteps.length}/${STEPS.length} ステップ完了済み`);
  }

  for (const step of STEPS) {
    if (isDone(state, step.id)) {
      p.log.info(`${pc.dim("✓")} ${step.name} ${pc.dim("(完了済み・スキップ)")}`);
      continue;
    }

    try {
      await step.fn(state, projectDir);
      markDone(state, step.id);
      saveState(projectDir, state);
    } catch (e: unknown) {
      saveState(projectDir, state);
      p.log.error(`ステップ「${step.name}」でエラーが発生しました。`);
      p.log.error(e instanceof Error ? e.message : "Unknown error");
      p.log.info("再実行すると、このステップから再開されます。");
      throw e;
    }
  }

  // Success: remove secrets from state but keep resource IDs for redeploy
  state.metaAppSecret = "";
  state.encryptionKey = "";
  state.jwtSecret = "";
  state.refreshSecret = "";
  state.operatorPassword = "";
  saveState(projectDir, state);

  p.outro(pc.green("セットアップが正常に完了しました!"));
}

/** Redeploy worker code only (no resource creation, no secret regeneration) */
async function redeploy(): Promise<void> {
  console.log("");
  p.intro(pc.bgYellow(pc.black(" GramStep Redeploy ")));
  p.log.info("Workerコードのみ再デプロイします（リソース再作成・Secrets再生成なし）。\n");

  const projectDir = ensureProjectRoot();
  const state = loadState(projectDir);

  if (!state.d1DatabaseId || !state.kvNamespaceId || !state.workerName) {
    p.log.error("セットアップが完了していません。先に setup を実行してください。");
    throw new Error("Setup not completed");
  }

  await deployWorker(state, projectDir);
  saveState(projectDir, state);

  p.log.success(`再デプロイ完了: ${pc.cyan(state.workerUrl)}`);
  p.outro(pc.green("done!"));
}

/** Find project root (look for pnpm-workspace.yaml or apps/worker) */
function findProjectRoot(): string | null {
  let dir = process.cwd();
  for (let i = 0; i < 10; i++) {
    if (existsSync(resolve(dir, "pnpm-workspace.yaml"))) return dir;
    if (existsSync(resolve(dir, "apps", "worker"))) return dir;
    dir = resolve(dir, "..");
  }
  return null;
}

function ensureProjectRoot(): string {
  const existingRoot = findProjectRoot();
  if (existingRoot) return existingRoot;

  const cwd = process.cwd();
  const cwdEntries = existsSync(cwd) ? readdirSync(cwd) : [];
  const targetDir = cwdEntries.length === 0 ? cwd : join(cwd, "gramstep");

  if (!existsSync(targetDir)) {
    mkdirSync(targetDir, { recursive: true });
  }

  const targetEntries = readdirSync(targetDir);
  if (targetEntries.length > 0) {
    throw new Error(
      `GramStep のソースが見つかりません。空のディレクトリで実行するか、既存の GramStep リポジトリ直下で実行してください: ${targetDir}`,
    );
  }

  p.log.step(pc.bold("GramStep ソース取得"));
  p.log.info(`公開リポジトリを取得中: ${pc.cyan(PUBLIC_REPO_URL)}`);

  try {
    execFileSync("git", ["clone", "--depth=1", PUBLIC_REPO_URL, targetDir], {
      stdio: "inherit",
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown error";
    throw new Error(`公開リポジトリの取得に失敗しました。git が使える状態か確認してください: ${message}`);
  }

  try {
    execFileSync("pnpm", ["install"], {
      cwd: targetDir,
      stdio: "inherit",
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown error";
    throw new Error(`依存関係のインストールに失敗しました。${targetDir} で pnpm install を確認してください: ${message}`);
  }

  p.log.success(`GramStep ソース取得完了: ${pc.cyan(targetDir)}`);
  return targetDir;
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
