import { execSync } from "node:child_process";
import * as p from "@clack/prompts";
import pc from "picocolors";
import { SetupError } from "./check-deps.js";
import type { SetupState } from "../lib/state.js";

/** Guide user through Instagram account connection and Meta Console configuration */
export async function connectInstagram(state: SetupState, _projectDir: string): Promise<void> {
  p.log.step(pc.bold("Instagramアカウント接続 & Meta Console 設定"));

  // --- 1. Token paste ---
  await registerToken(state);

  // --- 2. Webhook subscription ---
  p.log.step(pc.bold("Webhookサブスクリプションをオン"));
  p.log.info("トークン生成画面で " + pc.yellow("「Webhookサブスクリプション」をオン") + " にしてください。");
  const webhookSubDone = await p.confirm({
    message: "Webhookサブスクリプションをオンにしましたか？",
    initialValue: true,
  });
  if (p.isCancel(webhookSubDone)) throw new SetupError("ユーザーがキャンセルしました");

  // --- 3. Webhook configuration ---
  const webhookUrl = `${state.workerUrl}/webhook`;
  p.log.step(pc.bold("Webhooksを設定"));
  p.log.info("ユースケース → カスタマイズ → " + pc.yellow("「3. Webhooksを設定する」") + " を開いてください。");
  p.log.info("");
  p.log.info(`  Callback URL:   ${pc.cyan(webhookUrl)}`);
  p.log.info(`  Verify Token:   ${pc.yellow(state.webhookVerifyToken)}`);
  p.log.info("");
  p.log.info("上記の値を設定してください。");
  const webhookDone = await p.confirm({
    message: "Webhooksの設定は完了しましたか？",
    initialValue: true,
  });
  if (p.isCancel(webhookDone)) throw new SetupError("ユーザーがキャンセルしました");

  // --- 4. Business Login redirect URI ---
  const callbackUrl = `${state.workerUrl}/api/auth/callback`;
  p.log.step(pc.bold("Instagramビジネスログインを設定"));
  p.log.info("ユースケース → カスタマイズ → " + pc.yellow("「Instagramビジネスログインを設定」") + " を開いてください。");
  p.log.info("");
  p.log.info("  有効な OAuth リダイレクトURI に追加:");
  p.log.info(`    ${pc.cyan(callbackUrl)}`);
  p.log.info("");
  const bizLoginDone = await p.confirm({
    message: "リダイレクトURIを設定しましたか？",
    initialValue: true,
  });
  if (p.isCancel(bizLoginDone)) throw new SetupError("ユーザーがキャンセルしました");

  // --- 5. App Review ---
  p.log.step(pc.bold("アプリレビュー"));
  p.log.info("ダッシュボード → " + pc.yellow("「アプリレビュー」") + " へ移動してください。");
  p.log.info(pc.dim("※ 詳しい申請手順はセットアップ完了後のサマリーに表示されます。"));
  const reviewDone = await p.confirm({
    message: "アプリレビューのページを確認しましたか？",
    initialValue: true,
  });
  if (p.isCancel(reviewDone)) throw new SetupError("ユーザーがキャンセルしました");

  p.log.success("Meta Console の基本設定が完了しました。");
}

async function registerToken(state: SetupState): Promise<void> {
  p.log.info(`${pc.bold("Meta Developers Console でトークンを生成してください:")}`);
  p.log.info("");
  p.log.info("  ユースケース → カスタマイズ → 「2. アクセストークンを生成する」");
  p.log.info("  → テスターアカウントの「トークンを生成」をクリック");
  p.log.info("  → Instagramにログインして認証を許可");
  p.log.info("  → 表示されたアクセストークンとIG User IDをコピー");
  p.log.info("");

  const igUserId = await p.text({
    message: "Instagram User ID（トークン生成画面に表示されている数値）:",
    placeholder: "1234567890",
    validate: (v) => (/^\d+$/.test(v) ? undefined : "数値を入力してください"),
  });
  if (p.isCancel(igUserId)) throw new SetupError("ユーザーがキャンセルしました");

  const token = await p.password({
    message: "アクセストークン:",
    validate: (v) => (v.length < 20 ? "トークンが短すぎます" : undefined),
  });
  if (p.isCancel(token)) throw new SetupError("ユーザーがキャンセルしました");

  const spinner = p.spinner();
  spinner.start("トークンを登録中...");
  try {
    const res = execSync(
      `curl -s -w "\\n%{http_code}" -X POST "${state.workerUrl}/api/auth/manual-token" ` +
      `-H "Content-Type: application/json" ` +
      `-d '${JSON.stringify({ access_token: String(token), ig_user_id: String(igUserId) })}'`,
      { encoding: "utf-8", timeout: 30_000 },
    );
    const lines = res.trim().split("\n");
    const httpCode = lines[lines.length - 1];
    if (httpCode === undefined || !httpCode.startsWith("2")) {
      const body = lines.slice(0, -1).join("\n");
      spinner.stop("登録失敗");
      p.log.error(`Worker応答: ${httpCode} ${body.slice(0, 200)}`);
      p.log.info("後で管理画面から手動で接続できます。");
      return;
    }
    spinner.stop("トークン登録完了");
    p.log.success("Instagramアカウントが接続されました。");
  } catch (e: unknown) {
    spinner.stop("登録失敗");
    p.log.error(e instanceof Error ? e.message.slice(0, 200) : "Unknown error");
    p.log.info("後で管理画面から手動で接続できます。");
  }
}
