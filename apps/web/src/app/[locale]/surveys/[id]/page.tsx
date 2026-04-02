"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { createApiClient, getApiUrl } from "../../../../lib/api-client";
import { SurveyForm } from "../../../../components/surveys/survey-form";
import type { CreateSurveyInput, UpdateSurveyInput } from "@gramstep/shared";
import { Button } from "../../../../components/ui/button";

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
  const accountId = typeof window !== "undefined" ? localStorage.getItem("gramstep_account_id") ?? "" : "";

  const [survey, setSurvey] = useState<SurveyDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const client = createApiClient(apiUrl);
      const surveyResult = await client.surveys.get(id);

      if (surveyResult.ok) {
        setSurvey(surveyResult.value as SurveyDetail);
      } else {
        setError(surveyResult.error.message);
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

  async function handleExport() {
    const client = createApiClient(apiUrl);
    const result = await client.surveys.exportCsv(accountId, id);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }

    const blob = new Blob([result.value], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${survey?.name ?? id}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  if (loading) {
    return <main className="mx-auto max-w-5xl p-6 text-gray-500">読み込み中...</main>;
  }

  if (!survey) {
    return <main className="mx-auto max-w-5xl p-6 text-red-600">{error ?? "アンケートが見つかりません"}</main>;
  }

  return (
    <main className="mx-auto max-w-5xl p-6">
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-cobalt-700">アンケートを編集</h1>
        <div className="flex items-center gap-2">
          <Link href={`/${locale}/surveys/${id}/report`}>
            <Button type="button" variant="outline">レポートを見る</Button>
          </Link>
          <Button type="button" variant="outline" onClick={handleExport}>
            回答CSVをダウンロード
          </Button>
        </div>
      </div>
      {error && <div className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-600">{error}</div>}
      <SurveyForm
        initialData={survey}
        onSubmit={handleSubmit}
        loading={saving}
      />
    </main>
  );
}
