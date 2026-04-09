import * as p from "@clack/prompts";
import pc from "picocolors";
import { generateHex, generateApiKey } from "../lib/crypto.js";
import { SetupError } from "./check-deps.js";
import type { SetupState } from "../lib/state.js";

const META_SETUP_GUIDE = `
${pc.bold("Meta Developers アプリ事前準備:")}

  1. ${pc.cyan("https://developers.facebook.com/apps/")} → 「アプリを作成」
     → アプリ名に任意の名前を入力して「次へ」
     → 左のフィルターで ${pc.yellow("「すべて」")} を選び、${pc.yellow("「Instagramでメッセージとコンテンツを管理」")} のみチェックして「次へ」
     → ${pc.yellow("現時点ではビジネスポートフォリオをリンクしない")} を選んで「次へ」
     → 公開の要件は「次へ」でスルー
     → 概要で「アプリを作成」
     ${pc.dim("※ ここで作成できない場合は、不要なアプリを削除する必要があります")}

  2. ダッシュボードの概要で「Instagramでメッセージとコンテンツを管理」→ ${pc.yellow("「ユースケースをカスタマイズ」")}
     → ${pc.yellow("「Add all required permissions」")} をクリック
     → ボタンが ${pc.yellow("「Go to permissions and features」")} に変わったら再度クリック
     → アクセス許可と機能で ${pc.yellow("Business Asset User Profile Access")} を追加
     ${pc.dim("※ HUMAN_AGENT（7日間の有人返信）も必要に応じて追加")}

  3. 左メニュー「アプリの役割」→「役割」
     ${pc.yellow("→ 「メンバーを追加」から Instagramテスターとして対象アカウントを追加")}

  4. 表示される
     ${pc.yellow("「Instagramユーザーは、プロフィールのアプリとウェブサイトセクションから招待を管理できます。」")}
     のリンクをクリック
     → Instagram管理画面で「テスターへのご招待」タブを開いて承認

  補足:
     CLIで入力する ${pc.bold("アプリID")} と ${pc.bold("app secret")} は
     ${pc.yellow("アプリの設定 → ベーシック")} から取得できます

  ${pc.dim("後続のCLIステップでアクセストークン生成、Webhook設定、Instagramビジネスログイン、公開前設定を順番に案内します")}

`;

/** Collect Instagram API credentials and generate secrets */
export async function collectCredentials(state: SetupState): Promise<void> {
  p.log.step(pc.bold("Instagram API 設定"));
  console.log(META_SETUP_GUIDE);

  const ready = await p.confirm({
    message: "Meta Developersアプリの作成と上記の設定は完了していますか？",
    initialValue: true,
  });
  if (p.isCancel(ready) || !ready) {
    p.log.info("上記の手順を完了後、再実行してください。");
    throw new SetupError("Meta Developersアプリ設定が未完了です");
  }

  if (!state.metaAppId) {
    p.log.info(`${pc.dim("アプリの設定 → ベーシック → アプリID から取得")}`);
    const appId = await p.text({
      message: "アプリID:",
      placeholder: "1234567890123456",
      validate: (v) => (v.length < 5 ? "App IDが短すぎます" : undefined),
    });
    if (p.isCancel(appId)) throw new SetupError("ユーザーがキャンセルしました");
    state.metaAppId = String(appId);
  }

  if (!state.metaAppSecret) {
    p.log.info(`${pc.dim("アプリの設定 → ベーシック → app secret から取得")}`);
    const appSecret = await p.password({
      message: "App Secret:",
      validate: (v) => (v.length < 16 ? "App Secretが短すぎます" : undefined),
    });
    if (p.isCancel(appSecret)) throw new SetupError("ユーザーがキャンセルしました");
    state.metaAppSecret = String(appSecret);
  }

  if (!state.workerName) {
    const name = await p.text({
      message: "Worker名（Cloudflareにデプロイされる名前）:",
      placeholder: "gramstep-worker",
      initialValue: "gramstep-worker",
      validate: (v) => (/^[a-z0-9-]+$/.test(v) ? undefined : "小文字英数字とハイフンのみ"),
    });
    if (p.isCancel(name)) throw new SetupError("ユーザーがキャンセルしました");
    state.workerName = String(name);
  }

  // Auto-generate secrets
  if (!state.webhookVerifyToken) state.webhookVerifyToken = generateHex(16);
  if (!state.encryptionKey) state.encryptionKey = generateHex(32);
  if (!state.jwtSecret) state.jwtSecret = generateHex(32);
  if (!state.refreshSecret) state.refreshSecret = generateHex(32);
  if (!state.apiKey) state.apiKey = generateApiKey();

  if (!state.operatorEmail) {
    const email = await p.text({
      message: "管理者メールアドレス:",
      placeholder: "admin@example.com",
      validate: (v) => (v.includes("@") ? undefined : "有効なメールアドレスを入力"),
    });
    if (p.isCancel(email)) throw new SetupError("ユーザーがキャンセルしました");
    state.operatorEmail = String(email);
  }

  p.log.success("認証情報を準備しました（シークレットは自動生成済み）");
}
