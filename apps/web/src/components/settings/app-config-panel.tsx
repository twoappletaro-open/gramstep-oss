"use client";

import { useEffect, useState } from "react";
import { Badge } from "../ui/badge";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Tooltip } from "../ui/tooltip";
import { ManualTokenForm } from "./manual-token-form";

interface AppConfig {
  metaAppId: string;
  metaAppSecret: string;
  metaApiVersion: string;
  webhookVerifyToken: string;
  dashboardUrl: string;
  webhookUrl: string;
  oauthCallbackUrl: string;
  privacyPolicyUrl: string;
  dataDeletionUrl: string;
}

export function AppConfigPanel({
  apiUrl,
  onTokenUpdated,
}: {
  apiUrl: string;
  onTokenUpdated?: () => Promise<void> | void;
}) {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = sessionStorage.getItem("accessToken") ?? "";
    fetch(`${apiUrl}/api/app-config`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json() as Promise<AppConfig>)
      .then(setConfig)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [apiUrl]);

  if (loading) return <p className="text-gray-400">読み込み中...</p>;
  if (!config) return <p className="text-terra-500">設定を取得できませんでした</p>;

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-4">
      <h2 className="text-lg font-semibold">アプリ設定</h2>
      <p className="text-sm text-gray-500">
        Meta Developers Consoleに設定するURLと、現在のアプリ情報です。
        App IDやSecretを変更する場合はCLIから再設定してください:
        <code className="text-xs bg-gray-100 px-1 rounded ml-1">
          echo "新しい値" | npx wrangler secret put META_APP_ID
        </code>
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ConfigField label="Meta App ID" value={config.metaAppId} />
        <ConfigField label="Meta App Secret" value={config.metaAppSecret} masked />
        <ConfigField label="API Version" value={config.metaApiVersion} />
        <ConfigField label="Webhook Verify Token" value={config.webhookVerifyToken} masked />
      </div>

      <h3 className="text-sm font-semibold mt-4 pt-4 border-t">Meta Developers Console に設定するURL</h3>
      <div className="space-y-2">
        <CopyField label="Webhook URL" value={config.webhookUrl} hint="Instagram → Webhooks → Callback URL" />
        <CopyField label="OAuth Redirect URI" value={config.oauthCallbackUrl} hint="Instagram → ビジネスログイン → 有効なOAuthリダイレクトURI" />
        <CopyField label="プライバシーポリシーURL" value={config.privacyPolicyUrl} hint="設定 → 基本 → プライバシーポリシーのURL" />
        <CopyField label="データ削除URL" value={config.dataDeletionUrl} hint="設定 → 基本 → データの削除手順URL" />
      </div>

      <h3 className="text-sm font-semibold mt-6 pt-4 border-t">Meta Developers Console 設定ガイド</h3>
      <p className="text-xs text-gray-500 mb-2">
        セットアップCLI（<code className="bg-gray-100 px-1 rounded">npx create-gramstep setup</code>）完了時にも詳細手順が表示されます。
      </p>

      <SetupSection
        title="1. アプリ作成"
        location="https://developers.facebook.com/apps/"
        steps={[
          "「アプリを作成」→「Instagramでメッセージとコンテンツを管理」を選択",
          "ビジネスポートフォリオはリンクしない → 公開要件は「次へ」でスルー",
        ]}
      />

      <SetupSection
        title="2. アクセス許可を追加"
        location="ダッシュボード → ユースケース → カスタマイズ"
        steps={[
          "「必要なメッセージアクセス許可を追加する」→「追加」を2回クリック",
          "1回目: instagram_business_manage_messages（DM送受信）",
          "2回目: Business Asset User Profile Access（ユーザー名・表示名・プロフィール画像の取得に必須）",
          "HUMAN_AGENT（7日間の有人返信に必要）",
        ]}
      />

      <SetupSection
        title="3. テスター追加 → Instagram側で承認"
        location="アプリの役割 → 役割 → Instagramテスター"
        steps={[
          "対象のInstagramアカウントをテスターとして追加",
          "表示されるリンクからInstagram管理画面へ移動",
          "「テスターへのご招待」タブを開いて承認",
        ]}
      />

      <SetupSection
        title="4. アクセストークン生成 → 接続"
        location="ユースケース → カスタマイズ → 「アクセストークンを生成する」"
        steps={[
          "「トークンを生成」→ ログイン → 認証許可 → トークンをコピー",
          "コピーしたトークンを手動トークン登録APIで登録（CLIに表示されるcurlコマンド使用）",
          "「Webhookサブスクリプション」をオンにする",
        ]}
      />

      <SetupSection
        title="5. Webhooks設定"
        location="ユースケース → カスタマイズ → 「Webhooksを設定する」"
        steps={[
          `Callback URL: 上記の「Webhook URL」をコピーして設定`,
          `Verify Token: 上記の「Webhook Verify Token」をコピーして設定`,
        ]}
      />

      <SetupSection
        title="6. ビジネスログイン設定"
        location="ユースケース → カスタマイズ → 「Instagramビジネスログインを設定」"
        steps={[
          "有効なOAuthリダイレクトURIに上記の「OAuth Redirect URI」を設定",
        ]}
      />

      <SetupSection
        title="7. 基本設定 → アプリレビュー"
        location="設定 → 基本 / アプリレビュー"
        steps={[
          "プライバシーポリシーURL・データ削除URL・連絡先メールを設定（上記URLをコピー）",
          "アプリレビューへ移動して権限申請（スクリーンキャスト動画が必要）",
          "7日間の有人返信を使う場合は HUMAN_AGENT も追加申請",
        ]}
      />

      <div className="mt-6 pt-4 border-t">
        <ManualTokenForm apiUrl={apiUrl} onUpdated={onTokenUpdated} />
      </div>
    </div>
  );
}

function ConfigField({ label, value, masked }: { label: string; value: string; masked?: boolean }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-gray-500">{label}</Label>
      <div className="flex items-center gap-2">
        <Badge variant={value ? "default" : "secondary"} className="font-mono text-xs">
          {value || "未設定"}
        </Badge>
        {masked && <span className="text-xs text-gray-400">(マスク表示)</span>}
      </div>
    </div>
  );
}

function SetupSection({ title, location, steps }: { title: string; location: string; steps: string[] }) {
  return (
    <div className="mt-3 p-3 bg-gray-50 rounded-lg space-y-2">
      <div className="flex items-start justify-between">
        <h4 className="text-sm font-medium">{title}</h4>
      </div>
      <p className="text-xs text-gray-500">{location}</p>
      <ul className="text-xs text-gray-700 space-y-1 list-disc list-inside">
        {steps.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ul>
    </div>
  );
}

function CopyField({ label, value, hint }: { label: string; value: string; hint: string }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  }

  return (
    <div className="space-y-1">
      <Label className="flex items-center gap-1 text-xs text-gray-500">
        {label}
        <Tooltip content={hint} />
      </Label>
      <div className="flex items-center gap-2">
        <Input value={value} readOnly className="font-mono text-xs bg-gray-50" />
        <button
          onClick={handleCopy}
          className="px-2 py-1 text-xs border rounded hover:bg-gray-50 whitespace-nowrap"
        >
          {copied ? "コピー済み" : "コピー"}
        </button>
      </div>
    </div>
  );
}
