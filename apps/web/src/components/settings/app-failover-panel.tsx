"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Input } from "../ui/input";
import { Label } from "../ui/label";

interface AppFailoverPanelProps {
  apiUrl: string;
  onUpdated?: () => Promise<void> | void;
}

interface AppFailoverStatus {
  primaryApp: {
    metaAppId: string;
    metaApiVersion: string;
    webhookUrl: string;
    oauthCallbackUrl: string;
  };
  secondaryApp: {
    metaAppId: string;
    metaAppSecretConfigured: boolean;
    webhookVerifyTokenConfigured: boolean;
  } | null;
  account: {
    activeSlot: "primary" | "secondary";
    effectiveSlot: "primary" | "secondary";
    primaryTokenConfigured: boolean;
    secondaryTokenConfigured: boolean;
    primaryIgUserId: string | null;
    secondaryIgUserId: string | null;
    primaryIgUsername: string | null;
    secondaryIgUsername: string | null;
    lastSwitchedAt: number | null;
  };
}

function authHeaders(accountId: string): Record<string, string> {
  const accessToken = sessionStorage.getItem("accessToken") ?? "";
  return {
    "Content-Type": "application/json",
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    ...(accountId ? { "x-account-id": accountId } : {}),
  };
}

export function AppFailoverPanel({ apiUrl, onUpdated }: AppFailoverPanelProps) {
  const [status, setStatus] = useState<AppFailoverStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [switchingTo, setSwitchingTo] = useState<"primary" | "secondary" | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [secondaryAppId, setSecondaryAppId] = useState("");
  const [secondaryAppSecret, setSecondaryAppSecret] = useState("");
  const [secondaryVerifyToken, setSecondaryVerifyToken] = useState("");

  async function loadStatus() {
    const accountId = localStorage.getItem("gramstep_account_id") ?? "";
    if (!apiUrl || !accountId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");
    const res = await fetch(`${apiUrl}/api/settings/app-failover`, {
      headers: authHeaders(accountId),
    });
    const body = await res.json().catch(() => ({ error: res.statusText })) as
      | AppFailoverStatus
      | { error?: string };

    if (!res.ok) {
      setError("error" in body && body.error ? body.error : "状態を取得できませんでした");
      setLoading(false);
      return;
    }

    const data = body as AppFailoverStatus;
    setStatus(data);
    setSecondaryAppId(data.secondaryApp?.metaAppId ?? "");
    setSecondaryAppSecret("");
    setSecondaryVerifyToken("");
    setLoading(false);
  }

  useEffect(() => {
    void loadStatus();
  }, [apiUrl]);

  async function saveSecondaryApp() {
    const accountId = localStorage.getItem("gramstep_account_id") ?? "";
    if (!apiUrl || !accountId || saving) return;

    setSaving(true);
    setMessage("");
    setError("");

    try {
      const res = await fetch(`${apiUrl}/api/settings/app-failover`, {
        method: "PUT",
        headers: authHeaders(accountId),
        body: JSON.stringify({
          metaAppId: secondaryAppId.trim(),
          metaAppSecret: secondaryAppSecret.trim(),
          webhookVerifyToken: secondaryVerifyToken.trim(),
        }),
      });
      const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? "サブアプリ情報の保存に失敗しました");
        return;
      }
      setMessage("サブアプリ情報を保存しました");
      setSecondaryAppSecret("");
      setSecondaryVerifyToken("");
      await loadStatus();
    } finally {
      setSaving(false);
    }
  }

  async function clearSecondaryApp() {
    const accountId = localStorage.getItem("gramstep_account_id") ?? "";
    if (!apiUrl || !accountId || saving) return;

    setSaving(true);
    setMessage("");
    setError("");

    try {
      const res = await fetch(`${apiUrl}/api/settings/app-failover`, {
        method: "DELETE",
        headers: authHeaders(accountId),
      });
      const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? "サブアプリ情報の削除に失敗しました");
        return;
      }
      setMessage("サブアプリ情報を削除しました");
      setSecondaryAppId("");
      setSecondaryAppSecret("");
      setSecondaryVerifyToken("");
      await loadStatus();
    } finally {
      setSaving(false);
    }
  }

  async function switchSlot(slot: "primary" | "secondary") {
    const accountId = localStorage.getItem("gramstep_account_id") ?? "";
    if (!apiUrl || !accountId || switchingTo) return;

    setSwitchingTo(slot);
    setMessage("");
    setError("");

    try {
      const res = await fetch(`${apiUrl}/api/settings/app-failover/switch`, {
        method: "POST",
        headers: authHeaders(accountId),
        body: JSON.stringify({ slot }),
      });
      const body = await res.json().catch(() => ({ error: res.statusText })) as
        | { warning?: string; error?: string }
        | { status?: AppFailoverStatus; warning?: string; error?: string };
      if (!res.ok) {
        setError(body.error ?? "切替に失敗しました");
        return;
      }
      setMessage(slot === "primary" ? "メインアプリへ切り替えました" : "サブアプリへ切り替えました");
      if ("warning" in body && body.warning) {
        setMessage(`${slot === "primary" ? "メイン" : "サブ"}へ切り替えました。${body.warning}`);
      }
      await loadStatus();
      await onUpdated?.();
    } finally {
      setSwitchingTo(null);
    }
  }

  const canSaveSecondaryApp =
    Boolean(secondaryAppId.trim()) &&
    Boolean(secondaryAppSecret.trim()) &&
    Boolean(secondaryVerifyToken.trim());

  const canSwitchToSecondary = Boolean(status?.secondaryApp) && Boolean(status?.account.secondaryTokenConfigured);

  return (
    <Card>
      <CardHeader>
        <CardTitle>アプリ切替</CardTitle>
        <CardDescription>
          メインとサブの Meta アプリを事前登録して、障害時や設定差し替え時に切り替えます。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {loading ? <p className="text-sm text-muted-foreground">読み込み中...</p> : null}

        {status ? (
          <div className="grid gap-4 md:grid-cols-2">
            <SlotCard
              title="メインアプリ"
              active={status.account.activeSlot === "primary"}
              effective={status.account.effectiveSlot === "primary"}
              tokenReady={status.account.primaryTokenConfigured}
              username={status.account.primaryIgUsername}
              igUserId={status.account.primaryIgUserId}
              metaAppId={status.primaryApp.metaAppId}
              action={
                <Button
                  size="sm"
                  variant={status.account.activeSlot === "primary" ? "outline" : "default"}
                  disabled={switchingTo !== null || !status.account.primaryTokenConfigured}
                  onClick={() => void switchSlot("primary")}
                >
                  {switchingTo === "primary" ? "切替中..." : "メインを使用"}
                </Button>
              }
            />

            <SlotCard
              title="サブアプリ"
              active={status.account.activeSlot === "secondary"}
              effective={status.account.effectiveSlot === "secondary"}
              tokenReady={status.account.secondaryTokenConfigured}
              username={status.account.secondaryIgUsername}
              igUserId={status.account.secondaryIgUserId}
              metaAppId={status.secondaryApp?.metaAppId ?? "未設定"}
              action={
                <Button
                  size="sm"
                  disabled={switchingTo !== null || !canSwitchToSecondary}
                  onClick={() => void switchSlot("secondary")}
                >
                  {switchingTo === "secondary" ? "切替中..." : "サブを使用"}
                </Button>
              }
            />
          </div>
        ) : null}

        <div className="rounded-lg border p-4 space-y-4">
          <div>
            <h3 className="text-sm font-semibold">サブアプリ情報</h3>
            <p className="text-xs text-muted-foreground mt-1">
              ここに保存した App ID / Secret / Verify Token は webhook 検証とサブ切替に使います。
            </p>
            {status?.secondaryApp ? (
              <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                <span>Secret: {status.secondaryApp.metaAppSecretConfigured ? "保存済み" : "未保存"}</span>
                <span>Verify Token: {status.secondaryApp.webhookVerifyTokenConfigured ? "保存済み" : "未保存"}</span>
              </div>
            ) : null}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="secondary_meta_app_id">Meta App ID</Label>
              <Input
                id="secondary_meta_app_id"
                value={secondaryAppId}
                onChange={(e) => setSecondaryAppId(e.target.value)}
                placeholder="1234567890"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="secondary_verify_token">Webhook Verify Token</Label>
              <Input
                id="secondary_verify_token"
                value={secondaryVerifyToken}
                onChange={(e) => setSecondaryVerifyToken(e.target.value)}
                placeholder="verify_token_xxx"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="secondary_meta_app_secret">Meta App Secret</Label>
            <Input
              id="secondary_meta_app_secret"
              type="password"
              value={secondaryAppSecret}
              onChange={(e) => setSecondaryAppSecret(e.target.value)}
              placeholder="app_secret_xxx"
            />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button disabled={!canSaveSecondaryApp || saving} onClick={() => void saveSecondaryApp()}>
              {saving ? "保存中..." : "サブアプリを保存"}
            </Button>
            <Button variant="outline" disabled={saving || !status?.secondaryApp} onClick={() => void clearSecondaryApp()}>
              削除
            </Button>
            {message ? <span className="text-sm text-muted-foreground">{message}</span> : null}
            {error ? <span className="text-sm text-destructive">{error}</span> : null}
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          サブへ切り替える前に、下の `手動トークン更新` で保存先を `サブアプリ` にしてトークン登録してください。
        </p>
      </CardContent>
    </Card>
  );
}

function SlotCard({
  title,
  active,
  effective,
  tokenReady,
  username,
  igUserId,
  metaAppId,
  action,
}: {
  title: string;
  active: boolean;
  effective: boolean;
  tokenReady: boolean;
  username: string | null;
  igUserId: string | null;
  metaAppId: string;
  action: ReactNode;
}) {
  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">{title}</span>
          {active ? <Badge variant="default">選択中</Badge> : null}
          {effective && !active ? <Badge variant="secondary">現在使用中</Badge> : null}
        </div>
        {action}
      </div>

      <dl className="space-y-1 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">App ID</dt>
          <dd className="font-mono text-right">{metaAppId}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">トークン</dt>
          <dd>{tokenReady ? "登録済み" : "未登録"}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">IG</dt>
          <dd className="text-right">{username ? `@${username}` : "未接続"}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">IG User ID</dt>
          <dd className="font-mono text-right">{igUserId ?? "-"}</dd>
        </div>
      </dl>
    </div>
  );
}
