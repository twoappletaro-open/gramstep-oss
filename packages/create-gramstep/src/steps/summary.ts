import * as p from "@clack/prompts";
import pc from "picocolors";
import type { SetupState } from "../lib/state.js";

/** Display final setup summary */
export function showSummary(state: SetupState): void {
  p.log.step(pc.bold("セットアップ完了"));

  const summary = `
${pc.green("=========================================")}
${pc.green(pc.bold(" GramStep セットアップ完了!"))}
${pc.green("=========================================")}

${pc.bold("Worker URL:")}     ${pc.cyan(state.workerUrl)}
${pc.bold("Admin URL:")}      ${pc.cyan(state.adminUrl || "（未デプロイ）")}
${pc.bold("Health Check:")}   ${pc.cyan(state.workerUrl + "/health")}

${pc.bold("管理者ログイン:")}
  メール:     ${pc.cyan(state.operatorEmail)}
  パスワード: ${pc.cyan(state.operatorPassword || "（既存の管理者パスワードをそのまま使用）")}

${pc.green("=========================================")}
${pc.bold("動作テスト")}
${pc.green("=========================================")}

  ${pc.dim(`curl ${state.workerUrl}/health`)}
  Instagramから ${pc.bold("別アカウント")} でDMを送信 → 自動返答を確認

${pc.green("=========================================")}
${pc.bold("以上で基本設定は完了です!")}
${pc.green("=========================================")}

${pc.yellow("━━━ 製品版などとして外部提供をしたい場合は ━━━")}

${pc.bold("追加Step 1: 基本設定を完成させる")}
  左メニュー「公開」→「プライバシーポリシーURLのアプリ設定に移動」
  → アプリの設定 → ベーシック:
  - プライバシーポリシーURL: ${pc.cyan(state.workerUrl + "/privacy-policy")}（自動生成済み）
  - データの削除手順URL: ${pc.cyan(state.workerUrl + "/api/data-deletion")}
  - 連絡先メールアドレス
  - 入力後は右下の「変更を保存」

${pc.bold("追加Step 2: Meta側の公開状態を確認")}
  - 対象ユースケースで ${pc.yellow("「ユースケースをテストする」")} にチェックが入っていること
  - 左メニュー「公開」を開き、右下の ${pc.yellow("「公開」")} ボタンでアプリ全体を公開したこと
  - 実DMが届かない場合は、Webhookテスト送信だけでなく実際のDM受信でも確認すること

${pc.green("=========================================")}
${pc.dim("管理画面: " + (state.adminUrl || "未デプロイ"))}
${pc.dim("OAuth URI / Webhook URL は設定済み。必要なら管理画面の設定ページで再確認できます")}
${pc.green("=========================================")}
${pc.dim("公式ドキュメント:")}
${pc.dim("  Instagram API:  https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/")}
${pc.dim("  Messaging API:  https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/messaging-api/")}
${pc.dim("  Webhooks:       https://developers.facebook.com/docs/instagram-platform/webhooks/")}
${pc.dim("  App Review:     https://developers.facebook.com/docs/instagram-platform/app-review/")}
${pc.green("=========================================")}
`;

  console.log(summary);
}
