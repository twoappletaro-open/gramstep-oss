import * as p from "@clack/prompts";
import pc from "picocolors";
import type { SetupState } from "../lib/state.js";

/** Create admin operator by calling the deployed worker's dev-seed endpoint */
export async function seedOperator(state: SetupState, _projectDir: string): Promise<void> {
  p.log.step(pc.bold("管理者アカウント作成"));

  if (!state.workerUrl) {
    throw new Error("Worker URLが不明です。deploy-workerステップを先に完了してください。");
  }

  const seedUrl = `${state.workerUrl}/api/admin/auth/dev-seed`;

  const spinner = p.spinner();
  spinner.start("管理者アカウントを作成中...");

  try {
    const response = await fetch(seedUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: state.operatorEmail }),
    });

    if (response.status === 403) {
      // 管理者が既に存在する場合はスキップ
      spinner.stop("管理者は既に作成済みです（スキップ）");
      p.log.info("前回のセットアップで作成された管理者アカウントをそのまま使用します。");
      return;
    }

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`dev-seed失敗 (HTTP ${response.status}): ${body.slice(0, 200)}`);
    }

    const result = await response.json() as {
      ok: boolean;
      operatorId?: string;
      email?: string;
      password?: string;
    };

    if (!result.ok || !result.email || !result.password) {
      throw new Error(`dev-seed応答が不正: ${JSON.stringify(result).slice(0, 200)}`);
    }

    state.operatorEmail = result.email;
    state.operatorPassword = result.password;

    spinner.stop("管理者アカウント作成完了");

    p.log.success(pc.bold("管理者ログイン情報:"));
    p.log.info(`  メール:     ${pc.cyan(result.email)}`);
    p.log.info(`  パスワード: ${pc.cyan(result.password)}`);
    p.log.warn("  このパスワードは今回のみ表示されます。安全な場所に保存してください。");

  } catch (e: unknown) {
    spinner.stop("管理者アカウント作成失敗");
    const msg = e instanceof Error ? e.message : "Unknown error";

    // If it's a network error (worker not ready), provide guidance
    if (msg.includes("fetch") || msg.includes("ECONNREFUSED") || msg.includes("network")) {
      p.log.error("Workerにアクセスできません。デプロイが完了するまで数秒お待ちください。");
      p.log.info(`手動で作成する場合: ${pc.cyan(`curl -X POST ${seedUrl}`)}`);
    }
    throw e;
  }
}
