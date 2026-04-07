import { writeFileSync, unlinkSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import * as p from "@clack/prompts";
import pc from "picocolors";
import { wranglerWithStdin } from "../lib/wrangler.js";
import type { SetupState } from "../lib/state.js";
import { cleanupWorkerConfig, writeWorkerConfig } from "../lib/worker-config.js";

/** Build and deploy Admin UI (Next.js + OpenNext) to Cloudflare Workers */
export async function deployAdmin(state: SetupState, projectDir: string): Promise<void> {
  p.log.step(pc.bold("管理画面 (Admin UI) デプロイ"));

  const webDir = join(projectDir, "apps", "web");
  const adminWorkerName = `${state.workerName}-admin`;
  const webWranglerPath = join(webDir, "wrangler.toml");
  const originalWranglerToml = existsSync(webWranglerPath) ? readFileSync(webWranglerPath, "utf-8") : null;

  // Write .env.production with Worker URL
  const envPath = join(webDir, ".env.production");
  writeFileSync(envPath, `NEXT_PUBLIC_API_URL=${state.workerUrl}\n`, "utf-8");

  if (originalWranglerToml) {
    const nextToml = originalWranglerToml.match(/^name\s*=\s*".*"$/m)
      ? originalWranglerToml.replace(/^name\s*=\s*".*"$/m, `name = "${adminWorkerName}"`)
      : `name = "${adminWorkerName}"\n${originalWranglerToml}`;
    writeFileSync(webWranglerPath, nextToml, "utf-8");
  }

  // Build Next.js
  const spinner = p.spinner();
  spinner.start("Next.jsをビルド中...");
  try {
    execFileSync("pnpm", ["run", "build"], {
      cwd: webDir,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 300_000,
      env: {
        ...process.env,
        NEXT_PUBLIC_API_URL: state.workerUrl,
      },
    });
    spinner.stop("Next.jsビルド完了");
  } catch (e: unknown) {
    spinner.stop("Next.jsビルド失敗");
    if (existsSync(envPath)) unlinkSync(envPath);
    const msg = e instanceof Error ? e.message : "";
    throw new Error(`Next.jsビルド失敗: ${msg.slice(0, 300)}`);
  }

  // Build & Deploy with OpenNext for Cloudflare
  const spinner2 = p.spinner();
  spinner2.start("OpenNext ビルド中...");
  try {
    execFileSync("npx", ["opennextjs-cloudflare", "build", "--config", "wrangler.toml"], {
      cwd: webDir,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 300_000,
    });
    spinner2.stop("OpenNext ビルド完了");

    p.log.step(pc.bold("OpenNext / Cloudflare デプロイ"));
    p.log.info("ここで表示される Wrangler のログが、そのままデプロイ詳細です。");

    execFileSync("npx", ["opennextjs-cloudflare", "deploy", "--config", "wrangler.toml"], {
      cwd: webDir,
      encoding: "utf-8",
      stdio: "inherit",
      timeout: 300_000,
    });

    state.adminUrl = `https://${adminWorkerName}.workers.dev`;
    state.dashboardUrl = state.adminUrl;

    p.log.success(`管理画面デプロイ完了: ${pc.cyan(state.adminUrl)}`);

    // Worker側のDASHBOARD_URLを更新（CORS許可に必要）
    const workerDir = join(projectDir, "apps", "worker");
    p.log.info("Worker側のCORS設定（DASHBOARD_URL）を更新中...");
    const workerConfigPath = writeWorkerConfig(workerDir, state, "wrangler.dashboard.toml");
    try {
      wranglerWithStdin(["secret", "put", "DASHBOARD_URL", "--config", workerConfigPath], state.adminUrl, workerDir);
      p.log.success("DASHBOARD_URL更新完了（CORS有効化）");
    } catch {
      p.log.warn("DASHBOARD_URL更新に失敗。手動で設定してください:");
      p.log.warn(`  Worker名: ${state.workerName}`);
      p.log.warn(`  値: ${state.adminUrl}`);
      p.log.warn("  その後、create-gramstep を再実行するか wrangler から Secret を再投入してください。");
    } finally {
      cleanupWorkerConfig(workerConfigPath);
    }
  } catch (e: unknown) {
    spinner2.stop("管理画面デプロイ失敗");
    const msg = e instanceof Error ? e.message : "";
    p.log.error("OpenNext/Cloudflareデプロイでエラーが発生しました。");
    p.log.info("手動デプロイ:");
    p.log.info("  cd apps/web");
    p.log.info("  pnpm run build");
    p.log.info("  npx opennextjs-cloudflare build --config wrangler.toml");
    p.log.info("  npx opennextjs-cloudflare deploy --config wrangler.toml");
    throw new Error(`管理画面デプロイ失敗: ${msg.slice(0, 300)}`);
  } finally {
    if (existsSync(envPath)) unlinkSync(envPath);
    if (originalWranglerToml !== null) {
      writeFileSync(webWranglerPath, originalWranglerToml, "utf-8");
    }
  }
}
