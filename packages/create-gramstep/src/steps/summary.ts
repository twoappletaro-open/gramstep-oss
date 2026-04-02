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
  パスワード: ${pc.cyan(state.operatorPassword || "（セットアップ時に表示済み）")}

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
  設定 → 基本:
  - プライバシーポリシーURL: ${pc.cyan(state.workerUrl + "/privacy-policy")}（自動生成済み）
  - データの削除手順URL: ${pc.cyan(state.workerUrl + "/api/data-deletion")}
  - 連絡先メールアドレス

${pc.bold("追加Step 2: App Review申請")}
  ダッシュボード → ${pc.yellow("「アプリレビュー」")}

  ${pc.yellow("申請する権限の用途説明（コピペ用）:")}

  ${pc.bold("instagram_business_manage_messages:")}
    GramStepはInstagram Messaging APIを使用したCRMツールです。
    ユーザーからのDM受信をWebhookで検知し、事前設定したシナリオに基づいて
    自動応答メッセージを送信します。管理者は管理画面から1:1チャットで
    ユーザーに手動返信します。24時間メッセージングウィンドウを管理し、
    Instagram APIの制約に準拠した配信制御を行います。

  スクリーンキャスト動画が必要です:
    Mac: ${pc.dim("Cmd+Shift+5")} で画面録画
    操作: ログイン → シナリオ作成 → トリガー設定 → DM送受信デモ

${pc.green("=========================================")}
${pc.dim("管理画面: " + (state.adminUrl || "未デプロイ"))}
${pc.dim("設定ページでWebhook URL / OAuth URI をコピー可能")}
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
