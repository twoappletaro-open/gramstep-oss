import { writeFileSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import * as p from "@clack/prompts";
import pc from "picocolors";
import { wranglerWithStdin } from "../lib/wrangler.js";
import type { SetupState } from "../lib/state.js";

/** Build and deploy Admin UI (Next.js + OpenNext) to Cloudflare Workers */
export async function deployAdmin(state: SetupState, projectDir: string): Promise<void> {
  p.log.step(pc.bold("管理画面 (Admin UI) デプロイ"));

  const webDir = join(projectDir, "apps", "web");
  const adminWorkerName = `${state.workerName}-admin`;

  // Write .env.production with Worker URL
  const envPath = join(webDir, ".env.production");
  writeFileSync(envPath, `NEXT_PUBLIC_API_URL=${state.workerUrl}\n`, "utf-8");

  // Build Next.js
  const spinner = p.spinner();
  spinner.start("Next.jsをビルド中...");
  try {
    execSync("pnpm run build", {
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
  spinner2.start("OpenNext ビルド & Cloudflare Workers にデプロイ中...");
  try {
    const output = execSync(`npx opennextjs-cloudflare build && npx opennextjs-cloudflare deploy`, {
      cwd: webDir,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 300_000,
    });

    // Extract URL from deploy output
    const urlMatch = output.match(/(https:\/\/[^\s]+\.workers\.dev)/);
    state.adminUrl = urlMatch?.[1] ?? `https://${adminWorkerName}.workers.dev`;
    state.dashboardUrl = state.adminUrl;

    spinner2.stop(`管理画面デプロイ完了: ${pc.cyan(state.adminUrl)}`);

    // Worker側のDASHBOARD_URLを更新（CORS許可に必要）
    const workerDir = join(projectDir, "apps", "worker");
    p.log.info("Worker側のCORS設定（DASHBOARD_URL）を更新中...");
    try {
      wranglerWithStdin(["secret", "put", "DASHBOARD_URL"], state.adminUrl, workerDir);
      p.log.success("DASHBOARD_URL更新完了（CORS有効化）");
    } catch {
      p.log.warn("DASHBOARD_URL更新に失敗。手動で設定してください:");
      p.log.warn(`  echo "${state.adminUrl}" | npx wrangler secret put DASHBOARD_URL`);
    }
  } catch (e: unknown) {
    spinner2.stop("管理画面デプロイ失敗");
    const msg = e instanceof Error ? e.message : "";
    const stderr = (e as { stderr?: string }).stderr ?? "";
    p.log.error("OpenNext/Cloudflareデプロイでエラーが発生しました。");
    p.log.info(`手動デプロイ: cd apps/web && pnpm build && npx opennextjs-cloudflare deploy`);
    if (stderr) p.log.info(pc.dim(stderr.slice(0, 300)));
    throw new Error(`管理画面デプロイ失敗: ${msg.slice(0, 300)}`);
  } finally {
    if (existsSync(envPath)) unlinkSync(envPath);
  }
}
