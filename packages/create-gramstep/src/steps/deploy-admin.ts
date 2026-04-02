import { writeFileSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import * as p from "@clack/prompts";
import pc from "picocolors";
import { wrangler, wranglerWithStdin, WranglerError } from "../lib/wrangler.js";
import type { SetupState } from "../lib/state.js";

/** Build and deploy Admin UI (Next.js) to Cloudflare Pages */
export async function deployAdmin(state: SetupState, projectDir: string): Promise<void> {
  p.log.step(pc.bold("管理画面 (Admin UI) デプロイ"));

  const webDir = join(projectDir, "apps", "web");
  const pagesProject = `${state.workerName}-admin`;

  // Write .env.production with Worker URL
  const envPath = join(webDir, ".env.production");
  writeFileSync(envPath, `NEXT_PUBLIC_API_URL=${state.workerUrl}\n`, "utf-8");

  // Build
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
    spinner.stop("ビルド完了");
  } catch (e: unknown) {
    spinner.stop("ビルド失敗");
    if (existsSync(envPath)) unlinkSync(envPath);
    const msg = e instanceof Error ? e.message : "";
    throw new Error(`Next.jsビルド失敗: ${msg.slice(0, 300)}`);
  }

  // Deploy to Cloudflare Pages
  const spinner2 = p.spinner();
  spinner2.start("Cloudflare Pagesにデプロイ中...");
  try {
    // Create Pages project (idempotent)
    try {
      wrangler(["pages", "project", "create", pagesProject, "--production-branch", "main"], projectDir);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "";
      const stderr = e instanceof WranglerError ? e.stderr : "";
      if (!msg.includes("already exists") && !stderr.includes("already exists") &&
          !msg.includes("already taken") && !stderr.includes("already taken")) {
        throw e;
      }
    }

    // Deploy
    const outDir = join(webDir, ".next", "standalone");
    const deployDir = existsSync(outDir) ? outDir : join(webDir, "out");
    const output = wrangler(["pages", "deploy", deployDir, "--project-name", pagesProject], projectDir);

    // Extract URL
    const urlMatch = output.match(/(https:\/\/[^\s]+\.pages\.dev)/);
    state.adminUrl = urlMatch?.[1] ?? `https://${pagesProject}.pages.dev`;
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
    const stderr = e instanceof WranglerError ? e.stderr : "";
    if (stderr.includes("pages") || stderr.includes("Pages")) {
      p.log.error("Cloudflare Pagesでエラーが発生しました。");
      p.log.info("手動デプロイ: cd apps/web && pnpm build && npx wrangler pages deploy .next/standalone");
    }
    throw e;
  } finally {
    if (existsSync(envPath)) unlinkSync(envPath);
  }
}
