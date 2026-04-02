"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { createApiClient, getApiUrl } from "../../../../lib/api-client";
import { SurveyForm } from "../../../../components/surveys/survey-form";
import type { CreateSurveyInput, UpdateSurveyInput } from "@gramstep/shared";

type SurveyDetail = {
  id: string;
  name: string;
  is_active: boolean;
  completion_template_id: string | null;
  steps: Array<{
    step_order: number;
    field_type: "default_attribute" | "custom_attribute" | "free_input";
    field_key: string | null;
    answer_mode: "free_text" | "choice";
    question_text: string;
    options: Array<{ label: string; value: string }>;
  }>;
};

export default function EditSurveyPage() {
  const params = useParams<{ id: string; locale: string }>();
  const id = params.id as string;
  const locale = params.locale ?? "ja";
  const apiUrl = typeof window !== "undefined" ? getApiUrl() : "";

  const [survey, setSurvey] = useState<SurveyDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const client = createApiClient(apiUrl);
      const result = await client.surveys.get(id);
      if (result.ok) {
        setSurvey(result.value as SurveyDetail);
      } else {
        setError(result.error.message);
      }
      setLoading(false);
    }
    void load();
  }, [apiUrl, id]);

  async function handleSubmit(data: CreateSurveyInput | UpdateSurveyInput) {
    setSaving(true);
    setError(null);
    const client = createApiClient(apiUrl);
    const result = await client.surveys.update(id, data as UpdateSurveyInput);
    if (result.ok) {
      window.location.href = `/${locale}/surveys`;
      return;
    }
    setError(result.error.message);
    setSaving(false);
  }

  if (loading) {
    return <main className="mx-auto max-w-5xl p-6 text-gray-500">読み込み中...</main>;
  }

  if (!survey) {
    return <main className="mx-auto max-w-5xl p-6 text-red-600">{error ?? "アンケートが見つかりません"}</main>;
  }

  return (
    <main className="mx-auto max-w-5xl p-6">
      <h1 className="mb-6 text-2xl font-bold text-cobalt-700">アンケートを編集</h1>
      {error && <div className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-600">{error}</div>}
      <SurveyForm
        initialData={survey}
        onSubmit={handleSubmit}
        loading={saving}
      />
    </main>
  );
}
