"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ScenarioForm } from "../../../../components/scenarios/scenario-form";
import { createApiClient, getApiUrl } from "../../../../lib/api-client";
import type { CreateScenarioInput } from "@gramstep/shared";

export default function NewScenarioPage() {
  const t = useTranslations("scenarios");
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
    const result = await client.scenarios.create(accountId, data as CreateScenarioInput);
    if (result.ok) {
      window.location.href = "../scenarios";
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
      <ScenarioForm onSubmit={handleSubmit} loading={loading} />
    </main>
  );
}
