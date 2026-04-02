"use client";

import { useEffect, useState } from "react";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { Label } from "../ui/label";
import { Badge } from "../ui/badge";

interface PrivacyPolicyEditorProps {
  apiUrl: string;
}

export function PrivacyPolicyEditor({ apiUrl }: PrivacyPolicyEditorProps) {
  const [html, setHtml] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const policyUrl = `${apiUrl}/privacy-policy`;

  useEffect(() => {
    fetch(policyUrl)
      .then((r) => r.text())
      .then((text) => {
        setHtml(text);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [policyUrl]);

  async function handleSave() {
    setSaving(true);
    setMessage(null);
    try {
      const token = sessionStorage.getItem("accessToken") ?? "";
      const res = await fetch(`${apiUrl}/api/settings/privacy-policy`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ html }),
      });
      if (res.ok) {
        setMessage("保存しました");
      } else {
        const body = await res.json().catch(() => ({})) as { error?: string };
        setMessage(`保存失敗: ${body.error ?? res.statusText}`);
      }
    } catch (e: unknown) {
      setMessage(`エラー: ${e instanceof Error ? e.message : "Unknown"}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">プライバシーポリシー</h2>
        <a href={policyUrl} target="_blank" rel="noopener noreferrer">
          <Badge variant="outline">プレビュー</Badge>
        </a>
      </div>
      <p className="text-sm text-gray-500">
        Meta App Review に必要なプライバシーポリシーページです。
        Worker URL: <code className="text-xs bg-gray-100 px-1 rounded">{policyUrl}</code>
      </p>

      {loading ? (
        <p className="text-gray-400">読み込み中...</p>
      ) : (
        <>
          <div className="space-y-1">
            <Label>HTML内容（直接編集可能）</Label>
            <Textarea
              value={html}
              onChange={(e) => setHtml(e.target.value)}
              rows={12}
              className="font-mono text-xs"
            />
          </div>
          <div className="flex items-center gap-3">
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "保存中..." : "保存"}
            </Button>
            {message && (
              <span className={`text-sm ${message.startsWith("保存しました") ? "text-powder-600" : "text-terra-500"}`}>
                {message}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
