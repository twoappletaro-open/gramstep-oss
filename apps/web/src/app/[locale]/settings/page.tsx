"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { createApiClient, getApiUrl } from "../../../lib/api-client";
import { Button } from "../../../components/ui/button";
import { Badge } from "../../../components/ui/badge";
import { AppReviewForm, type AppReviewSettings } from "../../../components/settings/app-review-form";
import { PrivacyPolicyEditor } from "../../../components/settings/privacy-policy-editor";
import { AppConfigPanel } from "../../../components/settings/app-config-panel";

interface AccountInfo {
  id: string;
  igUsername: string | null;
  timezone: string;
  healthScore: string;
  tokenExpiresAt: number;
}

export default function SettingsPage() {
  const t = useTranslations("settings");
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const apiUrl = getApiUrl();
  const accountId = typeof window !== "undefined" ? localStorage.getItem("gramstep_account_id") ?? "" : "";

  async function loadAccount() {
    if (!apiUrl || !accountId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const client = createApiClient(apiUrl);
    await client.analytics.health(accountId).then((result) => {
      if (result.ok) {
        const v = result.value as {
          ig_username?: string; timezone?: string; health_score?: string;
          token_expires_at?: number; connected?: boolean;
        };
        setAccount({
          id: accountId,
          igUsername: v.ig_username ?? null,
          timezone: v.timezone ?? "Asia/Tokyo",
          healthScore: v.health_score ?? "normal",
          tokenExpiresAt: v.token_expires_at ?? 0,
        });
      }
      setLoading(false);
    }).catch(() => setLoading(false));
  }

  useEffect(() => {
    void loadAccount();
  }, [apiUrl, accountId]);

  const isConnected = account && account.igUsername && account.igUsername !== "pending_setup";
  const connectUrl = `${apiUrl}/api/auth/connect`;

  return (
    <div className="space-y-6 max-w-3xl">
      <h1 className="text-2xl font-bold text-cobalt-700">{t("title")}</h1>
      <p className="text-muted-foreground">{t("description")}</p>

      {/* Instagram接続 */}
      <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-4">
        <h2 className="text-lg font-semibold text-cobalt-700">{t("connectInstagram")}</h2>
        <p className="text-sm text-muted-foreground">{t("connectDescription")}</p>

        {loading ? (
          <p className="text-muted-foreground">読み込み中...</p>
        ) : isConnected ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Badge variant="default">接続中</Badge>
              <span className="font-medium text-cobalt-700">@{account.igUsername}</span>
            </div>
            <p className="text-sm text-muted-foreground">
              タイムゾーン: {account.timezone} / ヘルス: {account.healthScore}
            </p>
            <a href={connectUrl}>
              <Button variant="outline" size="sm">{t("reconnectButton")}</Button>
            </a>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Badge variant="secondary">未接続</Badge>
            </div>
            <a href={connectUrl}>
              <Button>{t("connectButton")}</Button>
            </a>
          </div>
        )}
      </div>

      {/* アプリ設定 */}
      <AppConfigPanel apiUrl={apiUrl} onTokenUpdated={loadAccount} />

      {/* プライバシーポリシー */}
      <PrivacyPolicyEditor apiUrl={apiUrl} />

      {/* App Review */}
      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <AppReviewForm
          initialSettings={{
            privacy_policy_url: `${apiUrl}/privacy-policy`,
            purpose_description: "",
            verification_steps: "",
            human_agent_status: "not_requested",
          }}
          onSave={async () => {}}
          onUpdateHumanAgent={async () => {}}
        />
      </div>
    </div>
  );
}
