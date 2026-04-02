import * as p from "@clack/prompts";
import pc from "picocolors";
import { generateHex, generateApiKey, generatePassword } from "../lib/crypto.js";
import { SetupError } from "./check-deps.js";
import type { SetupState } from "../lib/state.js";

const META_SETUP_GUIDE = `
${pc.bold("Meta Developers アプリ事前準備:")}

  1. ${pc.cyan("https://developers.facebook.com/apps/")} → 「アプリを作成」
     ${pc.yellow("→ 「Instagramでメッセージとコンテンツを管理」を選択")}
     → 現時点ではビジネスポートフォリオをリンクしない
     → 公開の要件は「次へ」でスルー → 「アプリを作成」

  2. ダッシュボード → ユースケース → カスタマイズ
     ${pc.yellow("「必要なメッセージアクセス許可を追加する」")}
       「追加」を ${pc.bold("2回")} クリック:
         1回目: ${pc.yellow("instagram_business_manage_messages")}（DM送受信）
         2回目: ${pc.yellow("Business Asset User Profile Access")}（プロフィール取得に必須）
       ${pc.dim("※ HUMAN_AGENT（7日間の有人返信）も必要に応じて追加")}

  3. アプリの役割 → 役割
     ${pc.yellow("→ 「Instagramテスター」として対象アカウントを追加")}
     → 表示されるリンクをクリック

  4. Instagram管理画面に移動したら:
     ${pc.yellow("→ 「テスターへのご招待」タブを開く → 承認")}

  5. 設定 → 基本 から ${pc.bold("アプリID")} と ${pc.bold("app secret")} を取得

  6. ${pc.dim("後続のCLIステップで Instagramビジネスログイン のリダイレクトURL設定を案内します")}

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
    p.log.info(`${pc.dim("設定 → 基本 → アプリID から取得")}`);
    const appId = await p.text({
      message: "アプリID:",
      placeholder: "1234567890123456",
      validate: (v) => (v.length < 5 ? "App IDが短すぎます" : undefined),
    });
    if (p.isCancel(appId)) throw new SetupError("ユーザーがキャンセルしました");
    state.metaAppId = String(appId);
  }

  if (!state.metaAppSecret) {
    p.log.info(`${pc.dim("設定 → 基本 → app secret から取得")}`);
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
  if (!state.operatorPassword) state.operatorPassword = generatePassword();

  p.log.success("認証情報を準備しました（シークレットは自動生成済み）");
}
