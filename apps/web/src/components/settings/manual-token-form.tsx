"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { Label } from "../ui/label";
import { Button } from "../ui/button";

interface ManualTokenFormProps {
  apiUrl: string;
  onUpdated?: () => Promise<void> | void;
}

interface ManualTokenResponse {
  ok: boolean;
  username?: string | null;
  ig_user_id?: string;
}

export function ManualTokenForm({ apiUrl, onUpdated }: ManualTokenFormProps) {
  const [igUserId, setIgUserId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function handleSubmit() {
    if (!apiUrl || !igUserId.trim() || !accessToken.trim() || submitting) return;

    setSubmitting(true);
    setMessage("");
    setError("");

    try {
      const token = sessionStorage.getItem("accessToken") ?? "";
      const accountId = localStorage.getItem("gramstep_account_id") ?? "";

      const res = await fetch(`${apiUrl}/api/auth/manual-token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(accountId ? { "x-account-id": accountId } : {}),
        },
        body: JSON.stringify({
          ig_user_id: igUserId.trim(),
          access_token: accessToken.trim(),
        }),
      });

      const body = await res.json().catch(() => ({ error: res.statusText })) as
        | ManualTokenResponse
        | { error?: string };

      if (!res.ok) {
        setError("error" in body && body.error ? body.error : "トークンの更新に失敗しました");
        return;
      }

      setAccessToken("");
      setMessage(
        `トークンを更新しました${"username" in body && body.username ? ` (@${body.username})` : ""}`,
      );

      await onUpdated?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "トークンの更新に失敗しました");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>手動トークン更新</CardTitle>
        <CardDescription>
          Meta側で権限を追加して新しいアクセストークンを発行した場合、ここから上書きできます。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="ig_user_id">IG User ID</Label>
          <Input
            id="ig_user_id"
            placeholder="1784..."
            value={igUserId}
            onChange={(e) => setIgUserId(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="access_token">アクセストークン</Label>
          <Textarea
            id="access_token"
            placeholder="IGAAX..."
            value={accessToken}
            onChange={(e) => setAccessToken(e.target.value)}
            rows={6}
          />
        </div>

        <div className="flex items-center gap-4">
          <Button onClick={handleSubmit} disabled={submitting || !igUserId.trim() || !accessToken.trim()}>
            {submitting ? "更新中..." : "トークンを更新"}
          </Button>
          {message && <span className="text-sm text-muted-foreground">{message}</span>}
          {error && <span className="text-sm text-destructive">{error}</span>}
        </div>

        <p className="text-xs text-muted-foreground">
          入力したトークンは保存後に再表示されません。IG User ID は Meta のトークン生成画面に表示される値を使ってください。
        </p>
      </CardContent>
    </Card>
  );
}
