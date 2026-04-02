import { Hono } from "hono";
import type { Env } from "../env.js";

const privacyPolicyRoute = new Hono<{ Bindings: Env }>();

const DEFAULT_POLICY = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>プライバシーポリシー</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 800px; margin: 0 auto; padding: 2rem; line-height: 1.8; color: #333; }
    h1 { font-size: 1.5rem; border-bottom: 2px solid #eee; padding-bottom: 0.5rem; }
    h2 { font-size: 1.2rem; margin-top: 2rem; }
    .updated { color: #888; font-size: 0.9rem; }
  </style>
</head>
<body>
  <h1>プライバシーポリシー</h1>
  <p class="updated">最終更新日: {{DATE}}</p>

  <h2>1. 収集する情報</h2>
  <p>本サービスはInstagram Messaging APIを通じて、以下の情報を収集します:</p>
  <ul>
    <li>Instagramユーザー名、表示名、プロフィール情報</li>
    <li>ダイレクトメッセージの内容（テキスト、画像、動画）</li>
    <li>メッセージの送受信日時、既読状態</li>
    <li>コメント、ストーリーリアクション</li>
  </ul>

  <h2>2. 情報の利用目的</h2>
  <ul>
    <li>自動メッセージ配信（シナリオ・ステップ配信）</li>
    <li>ユーザー対応（1:1チャット、カスタマーサポート）</li>
    <li>配信分析・効果測定</li>
    <li>サービスの改善・不具合対応</li>
  </ul>

  <h2>3. 情報の保存</h2>
  <p>データはCloudflare D1（SQLite）およびR2に暗号化して保存されます。メッセージログは30日間保持後、R2にアーカイブされます（90日保持）。</p>

  <h2>4. 第三者への提供</h2>
  <p>法令に基づく場合を除き、収集した個人情報を第三者に提供することはありません。</p>

  <h2>5. データの削除</h2>
  <p>ユーザーはいつでもデータの削除を要求できます。Meta Data Deletion Callbackに対応しており、削除リクエストから30日以内に処理されます。</p>

  <h2>6. Cookie・トラッキング</h2>
  <p>本サービスはセッション管理目的のCookieのみを使用します。サードパーティのトラッキングツールは使用しません。</p>

  <h2>7. お問い合わせ</h2>
  <p>プライバシーに関するお問い合わせは以下までご連絡ください:</p>
  <p>メール: {{EMAIL}}</p>

  <h2>8. ポリシーの変更</h2>
  <p>本ポリシーは必要に応じて更新されます。重要な変更がある場合は、サービス内で通知します。</p>
</body>
</html>`;

function renderDeletionConfirmationPage(confirmationCode: string): string {
  const escapedCode = confirmationCode.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case "\"": return "&quot;";
      case "'": return "&#39;";
      default: return char;
    }
  });

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>データ削除リクエスト受付</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 720px; margin: 0 auto; padding: 2rem; line-height: 1.8; color: #333; }
    h1 { font-size: 1.5rem; margin-bottom: 1rem; }
    .card { border: 1px solid #e5e7eb; border-radius: 16px; padding: 1.5rem; background: #fafafa; }
    code { background: #f1f5f9; padding: 0.2rem 0.4rem; border-radius: 6px; }
    .muted { color: #666; font-size: 0.95rem; }
  </style>
</head>
<body>
  <h1>データ削除リクエストを受け付けました</h1>
  <div class="card">
    <p>Instagram 経由のデータ削除リクエストを受信しました。削除処理は保持期間ポリシーに従って進行します。</p>
    <p><strong>確認コード:</strong> <code>${escapedCode}</code></p>
    <p class="muted">このコードはサポート問い合わせ時の照合に使用できます。</p>
  </div>
</body>
</html>`;
}

// GET /privacy-policy — プライバシーポリシーページ
privacyPolicyRoute.get("/privacy-policy", async (c) => {
  // KVからカスタムポリシーを取得（管理画面で編集された場合）
  const custom = await c.env.KV.get("privacy_policy_html");
  if (custom) {
    return c.html(custom);
  }

  // デフォルトポリシーを表示
  const html = DEFAULT_POLICY
    .replace("{{DATE}}", new Date().toISOString().split("T")[0] ?? "")
    .replace("{{EMAIL}}", "twoappletaro@gmail.com");

  return c.html(html);
});

// GET /deletion — Meta data deletion callback confirmation page
privacyPolicyRoute.get("/deletion", async (c) => {
  const confirmationCode = c.req.query("confirmation_code") ?? "";
  return c.html(renderDeletionConfirmationPage(confirmationCode));
});

export { privacyPolicyRoute };
