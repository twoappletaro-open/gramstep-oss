"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { createApiClient, getApiUrl } from "../../../../../lib/api-client";
import { Button } from "../../../../../components/ui/button";

type SurveyReport = {
  survey: {
    id: string;
    name: string;
    is_active: boolean;
    response_user_count: number;
  };
  summary: {
    total_sessions: number;
    completed_sessions: number;
    completion_rate: number;
    unique_users: number;
    latest_response_at: number | null;
  };
  questions: Array<{
    step_id: string;
    step_order: number;
    question_text: string;
    field_type: "default_attribute" | "custom_attribute" | "free_input";
    field_key: string | null;
    answer_mode: "free_text" | "choice";
    response_count: number;
    latest_answered_at: number | null;
    choice_breakdown: Array<{
      label: string;
      value: string;
      response_count: number;
    }>;
    sample_answers: Array<{
      answer_value: string;
      answer_label: string | null;
      answered_at: number;
      ig_username: string | null;
      display_name: string | null;
    }>;
  }>;
  recent_responses: Array<{
    session_id: string;
    ig_user_id: string;
    ig_username: string | null;
    display_name: string | null;
    started_at: number;
    completed_at: number | null;
    answers: Array<{
      step_order: number;
      question_text: string;
      answer_value: string;
      answer_label: string | null;
      answered_at: number;
    }>;
  }>;
};

function formatDate(timestamp: number | null): string {
  if (!timestamp) return "未完了";
  return new Date(timestamp * 1000).toLocaleString("ja-JP");
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export default function SurveyReportPage() {
  const params = useParams<{ id: string; locale: string }>();
  const id = params.id as string;
  const locale = params.locale ?? "ja";
  const apiUrl = typeof window !== "undefined" ? getApiUrl() : "";
  const accountId = typeof window !== "undefined" ? localStorage.getItem("gramstep_account_id") ?? "" : "";

  const [report, setReport] = useState<SurveyReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const client = createApiClient(apiUrl);
      const result = await client.surveys.report(accountId, id);
      if (result.ok) {
        setReport(result.value as SurveyReport);
      } else {
        setError(result.error.message);
      }
      setLoading(false);
    }
    void load();
  }, [accountId, apiUrl, id]);

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
    anchor.download = `${report?.survey.name ?? id}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  if (loading) {
    return <main className="mx-auto max-w-6xl p-6 text-gray-500">読み込み中...</main>;
  }

  if (!report) {
    return <main className="mx-auto max-w-6xl p-6 text-red-600">{error ?? "レポートを取得できませんでした"}</main>;
  }

  return (
    <main className="mx-auto max-w-6xl p-6 space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-cobalt-700">{report.survey.name} レポート</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            回答数の集計と、直近の回答内容をまとめて確認できます。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/${locale}/surveys/${id}`}>
            <Button type="button" variant="outline">編集に戻る</Button>
          </Link>
          <Button type="button" variant="outline" onClick={handleExport}>
            CSVをダウンロード
          </Button>
        </div>
      </div>

      {error ? <div className="rounded-md bg-red-50 p-3 text-sm text-red-600">{error}</div> : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <div className="text-sm text-muted-foreground">回答セッション数</div>
          <div className="mt-2 text-3xl font-bold text-cobalt-700">{report.summary.total_sessions}</div>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <div className="text-sm text-muted-foreground">完了数</div>
          <div className="mt-2 text-3xl font-bold text-cobalt-700">{report.summary.completed_sessions}</div>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <div className="text-sm text-muted-foreground">完了率</div>
          <div className="mt-2 text-3xl font-bold text-cobalt-700">{formatPercent(report.summary.completion_rate)}</div>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <div className="text-sm text-muted-foreground">回答ユーザー数</div>
          <div className="mt-2 text-3xl font-bold text-cobalt-700">{report.summary.unique_users}</div>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <div className="text-sm text-muted-foreground">最新回答</div>
          <div className="mt-2 text-sm font-medium text-cobalt-700">{formatDate(report.summary.latest_response_at)}</div>
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-xl font-semibold text-cobalt-700">設問ごとの集計</h2>
          <p className="mt-1 text-sm text-muted-foreground">各質問の回答数と、選択肢別の内訳または最新回答例です。</p>
        </div>
        <div className="space-y-4">
          {report.questions.map((question) => (
            <div key={question.step_id} className="rounded-xl border border-gray-200 bg-white p-5 space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="font-medium text-cobalt-700">
                    Q{question.step_order}. {question.question_text}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    回答方式: {question.answer_mode === "choice" ? "選択肢" : "自由入力"}
                    {question.field_key ? ` / 保存先: ${question.field_key}` : ""}
                  </div>
                </div>
                <div className="text-sm text-right text-muted-foreground">
                  <div>回答数: {question.response_count}</div>
                  <div>最新: {formatDate(question.latest_answered_at)}</div>
                </div>
              </div>

              {question.answer_mode === "choice" ? (
                <div className="space-y-3">
                  {question.choice_breakdown.map((option) => {
                    const percent = question.response_count > 0
                      ? Math.round((option.response_count / question.response_count) * 100)
                      : 0;
                    return (
                      <div key={`${question.step_id}-${option.value}`} className="space-y-1">
                        <div className="flex items-center justify-between text-sm">
                          <span>{option.label}</span>
                          <span className="text-muted-foreground">{option.response_count}件 / {percent}%</span>
                        </div>
                        <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                          <div className="h-full rounded-full bg-steel-500" style={{ width: `${percent}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : question.sample_answers.length > 0 ? (
                <div className="space-y-3">
                  {question.sample_answers.map((answer, index) => (
                    <div key={`${question.step_id}-${index}`} className="rounded-lg bg-gray-50 p-3">
                      <div className="text-sm text-gray-800">{answer.answer_label || answer.answer_value}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {answer.display_name || answer.ig_username || "unknown"} / {formatDate(answer.answered_at)}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-lg bg-gray-50 p-4 text-sm text-muted-foreground">
                  まだ回答がありません。
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-cobalt-700">直近の回答一覧</h2>
            <p className="mt-1 text-sm text-muted-foreground">最新20件の回答セッションを表示しています。</p>
          </div>
          <Link href={`/${locale}/surveys/${id}/responses`}>
            <Button type="button" variant="outline">全ての回答を見る</Button>
          </Link>
        </div>

        {report.recent_responses.length === 0 ? (
          <div className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-muted-foreground">
            まだ回答はありません。
          </div>
        ) : (
          <div className="space-y-4">
            {report.recent_responses.map((response) => (
              <div key={response.session_id} className="rounded-xl border border-gray-200 bg-white p-5 space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="font-medium text-cobalt-700">
                      {response.display_name || response.ig_username || response.ig_user_id}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      @{response.ig_username || "unknown"} / {response.ig_user_id}
                    </div>
                  </div>
                  <div className="text-sm text-muted-foreground text-right">
                    <div>開始: {formatDate(response.started_at)}</div>
                    <div>完了: {formatDate(response.completed_at)}</div>
                  </div>
                </div>

                <div className="space-y-3">
                  {response.answers.map((answer) => (
                    <div key={`${response.session_id}-${answer.step_order}`} className="rounded-lg bg-gray-50 p-3">
                      <div className="text-sm font-medium text-cobalt-700">
                        Q{answer.step_order}. {answer.question_text}
                      </div>
                      <div className="mt-1 text-sm text-gray-700">
                        {answer.answer_label || answer.answer_value}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        回答日時: {formatDate(answer.answered_at)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
