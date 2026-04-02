"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { createApiClient, getApiUrl } from "../../../../lib/api-client";
import { SurveyForm } from "../../../../components/surveys/survey-form";
import type { CreateSurveyInput, UpdateSurveyInput } from "@gramstep/shared";

export default function NewSurveyPage() {
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? "ja";
  const apiUrl = typeof window !== "undefined" ? getApiUrl() : "";
  const accountId = typeof window !== "undefined"
    ? localStorage.getItem("gramstep_account_id") ?? ""
    : "";
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(data: CreateSurveyInput | UpdateSurveyInput) {
    setSaving(true);
    setError(null);
    const client = createApiClient(apiUrl);
    const result = await client.surveys.create(accountId, data as CreateSurveyInput);
    if (result.ok) {
      window.location.href = `/${locale}/surveys`;
      return;
    }
    setError(result.error.message);
    setSaving(false);
  }

  return (
    <main className="mx-auto max-w-5xl p-6">
      <h1 className="mb-6 text-2xl font-bold text-cobalt-700">アンケートを作成</h1>
      {error && <div className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-600">{error}</div>}
      <SurveyForm onSubmit={handleSubmit} loading={saving} />
    </main>
  );
}
