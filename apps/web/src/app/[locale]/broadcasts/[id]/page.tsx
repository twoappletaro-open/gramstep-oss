"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { BroadcastForm, type BroadcastFormData } from "../../../../components/broadcasts/broadcast-form";
import { createApiClient, getApiUrl } from "../../../../lib/api-client";

type BroadcastDetail = BroadcastFormData & {
  status: string;
};

export default function EditBroadcastPage() {
  const params = useParams();
  const id = params.id as string;
  const apiUrl = typeof window !== "undefined" ? getApiUrl() : "";
  const accountId = typeof window !== "undefined"
    ? localStorage.getItem("gramstep_account_id") ?? ""
    : "default";

  const [broadcast, setBroadcast] = useState<BroadcastDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const client = createApiClient(apiUrl);
      const result = await client.broadcasts.get(id, accountId);
      if (result.ok) {
        setBroadcast(result.value as BroadcastDetail);
      } else {
        setError(result.error.message);
      }
      setLoading(false);
    }
    void load();
  }, [accountId, apiUrl, id]);

  async function handleSubmit(payload: BroadcastFormData, mode: "draft" | "publish") {
    setSaving(true);
    setError(null);
    const client = createApiClient(apiUrl);
    const result = await client.broadcasts.update(id, accountId, {
      name: payload.name,
      template_id: payload.template_id,
      segment: payload.segment,
      scheduled_at: payload.scheduled_at,
      save_mode: mode,
    });

    if (result.ok) {
      window.location.href = mode === "draft"
        ? `../../broadcasts/${id}`
        : "../../broadcasts";
    } else {
      setError(result.error.message);
    }
    setSaving(false);
  }

  if (loading) {
    return (
      <main className="mx-auto max-w-5xl p-6">
        <p className="text-muted-foreground">読み込み中...</p>
      </main>
    );
  }

  if (!broadcast) {
    return (
      <main className="mx-auto max-w-5xl p-6">
        <p className="text-destructive">{error ?? "一斉配信が見つかりません"}</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl p-6">
      <h1 className="mb-6 text-2xl font-bold text-cobalt-700">一斉配信編集</h1>
      {error && (
        <div className="mb-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}
      <BroadcastForm
        accountId={accountId}
        initialData={broadcast}
        loading={saving}
        onSubmit={handleSubmit}
      />
    </main>
  );
}
