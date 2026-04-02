"use client";

import { useState } from "react";
import { BroadcastForm, type BroadcastFormData } from "../../../../components/broadcasts/broadcast-form";
import { createApiClient, getApiUrl } from "../../../../lib/api-client";

export default function NewBroadcastPage() {
  const apiUrl = typeof window !== "undefined" ? getApiUrl() : "";
  const accountId = typeof window !== "undefined"
    ? localStorage.getItem("gramstep_account_id") ?? ""
    : "default";

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(payload: BroadcastFormData, mode: "draft" | "publish") {
    setLoading(true);
    setError(null);
    const client = createApiClient(apiUrl);
    const result = await client.broadcasts.create(accountId, {
      name: payload.name,
      template_id: payload.template_id,
      segment: payload.segment,
      scheduled_at: payload.scheduled_at,
      save_mode: mode,
    });

    if (result.ok) {
      const created = result.value as { id: string };
      window.location.href = mode === "draft"
        ? `../broadcasts/${created.id}`
        : "../broadcasts";
    } else {
      setError(result.error.message);
    }
    setLoading(false);
  }

  return (
    <main className="mx-auto max-w-5xl p-6">
      <h1 className="mb-6 text-2xl font-bold text-cobalt-700">一斉配信作成</h1>
      {error && (
        <div className="mb-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}
      <BroadcastForm accountId={accountId} loading={loading} onSubmit={handleSubmit} />
    </main>
  );
}
