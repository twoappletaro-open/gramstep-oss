"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { TriggerForm } from "../../../../components/triggers/trigger-form";
import { createApiClient, getApiUrl } from "../../../../lib/api-client";
import type { CreateTriggerInput } from "@gramstep/shared";

export default function NewTriggerPage() {
  const t = useTranslations("triggers");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apiUrl = typeof window !== "undefined"
    ? (getApiUrl())
    : "";
  const accountId = typeof window !== "undefined"
    ? localStorage.getItem("gramstep_account_id") ?? ""
    : "default";

  async function handleSubmit(data: unknown) {
    setLoading(true);
    setError(null);
    const client = createApiClient(apiUrl);
    const result = await client.triggers.create(accountId, data as CreateTriggerInput);
    if (result.ok) {
      window.location.href = "../triggers";
    } else {
      setError(result.error.message);
    }
    setLoading(false);
  }

  return (
    <main className="mx-auto max-w-4xl p-6">
      <h1 className="mb-6 text-2xl font-bold text-cobalt-700">{t("createTitle")}</h1>
      {error && (
        <div className="mb-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}
      <TriggerForm onSubmit={handleSubmit} loading={loading} />
    </main>
  );
}
