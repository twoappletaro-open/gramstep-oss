"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Textarea } from "../ui/textarea";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";

export interface AppReviewSettings {
  privacy_policy_url: string;
  purpose_description: string;
  verification_steps: string;
  human_agent_status: "not_requested" | "pending" | "approved" | "rejected";
}

interface AppReviewFormProps {
  initialSettings: AppReviewSettings;
  onSave: (settings: Partial<AppReviewSettings>) => Promise<void>;
  onUpdateHumanAgent: (status: string) => Promise<void>;
}

const STATUS_LABELS: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  not_requested: { label: "未申請", variant: "secondary" },
  pending: { label: "審査中", variant: "outline" },
  approved: { label: "承認済み", variant: "default" },
  rejected: { label: "却下", variant: "destructive" },
};

export function AppReviewForm({
  initialSettings,
  onSave,
  onUpdateHumanAgent,
}: AppReviewFormProps) {
  const [settings, setSettings] = useState(initialSettings);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const handleSave = async () => {
    setSaving(true);
    setMessage("");
    try {
      await onSave({
        privacy_policy_url: settings.privacy_policy_url,
        purpose_description: settings.purpose_description,
        verification_steps: settings.verification_steps,
      });
      setMessage("保存しました");
    } catch {
      setMessage("保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  const handleHumanAgentUpdate = async (status: string) => {
    try {
      await onUpdateHumanAgent(status);
      setSettings((prev) => ({
        ...prev,
        human_agent_status: status as AppReviewSettings["human_agent_status"],
      }));
    } catch {
      setMessage("ステータス更新に失敗しました");
    }
  };

  const statusInfo = STATUS_LABELS[settings.human_agent_status] ?? STATUS_LABELS["not_requested"]!;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Meta App Review設定</CardTitle>
          <CardDescription>
            Meta App Reviewに必要な情報を管理します。プライバシーポリシーURLと利用目的はMeta Developer Consoleに入力する内容です。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="privacy_policy_url">プライバシーポリシーURL</Label>
            <Input
              id="privacy_policy_url"
              type="url"
              placeholder="https://example.com/privacy"
              value={settings.privacy_policy_url}
              onChange={(e) =>
                setSettings((prev) => ({
                  ...prev,
                  privacy_policy_url: e.target.value,
                }))
              }
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="purpose_description">利用目的説明</Label>
            <Textarea
              id="purpose_description"
              placeholder="Instagram DM自動配信によるマーケティング自動化を目的として使用します..."
              rows={4}
              value={settings.purpose_description}
              onChange={(e) =>
                setSettings((prev) => ({
                  ...prev,
                  purpose_description: e.target.value,
                }))
              }
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="verification_steps">アプリ検証手順</Label>
            <Textarea
              id="verification_steps"
              placeholder="1. テストアカウントでログイン&#10;2. シナリオを作成&#10;3. テストDMを送信"
              rows={6}
              value={settings.verification_steps}
              onChange={(e) =>
                setSettings((prev) => ({
                  ...prev,
                  verification_steps: e.target.value,
                }))
              }
            />
          </div>

          <div className="flex items-center gap-4">
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "保存中..." : "保存"}
            </Button>
            {message && <span className="text-sm text-muted-foreground">{message}</span>}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>HUMAN_AGENT権限</CardTitle>
          <CardDescription>
            HUMAN_AGENTタグを使用すると、手動返信の24時間ウィンドウが7日間に延長されます。Meta App Reviewで承認が必要です。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium">現在のステータス:</span>
            <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>
          </div>

          <div className="flex gap-2">
            {settings.human_agent_status === "not_requested" && (
              <Button
                variant="outline"
                onClick={() => handleHumanAgentUpdate("pending")}
              >
                申請済みとしてマーク
              </Button>
            )}
            {settings.human_agent_status === "pending" && (
              <>
                <Button onClick={() => handleHumanAgentUpdate("approved")}>
                  承認済みとしてマーク
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => handleHumanAgentUpdate("rejected")}
                >
                  却下としてマーク
                </Button>
              </>
            )}
            {(settings.human_agent_status === "approved" ||
              settings.human_agent_status === "rejected") && (
              <Button
                variant="outline"
                onClick={() => handleHumanAgentUpdate("not_requested")}
              >
                リセット
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
