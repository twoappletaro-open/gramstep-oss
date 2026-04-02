"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { createApiClient, getApiUrl } from "../../../../../lib/api-client";
import { Button } from "../../../../../components/ui/button";

type SurveyResponseItem = {
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
};

type SurveyReportMeta = {
  survey: {
    id: string;
    name: string;
  };
  summary: {
    total_sessions: number;
  };
};

const PAGE_SIZE = 50;

function formatDate(timestamp: number | null): string {
  if (!timestamp) return "未完了";
  return new Date(timestamp * 1000).toLocaleString("ja-JP");
}

export default function SurveyResponsesPage() {
  const params = useParams<{ id: string; locale: string }>();
  const id = params.id as string;
  const locale = params.locale ?? "ja";
  const apiUrl = typeof window !== "undefined" ? getApiUrl() : "";
  const accountId = typeof window !== "undefined" ? localStorage.getItem("gramstep_account_id") ?? "" : "";

  const [page, setPage] = useState(1);
  const [report, setReport] = useState<SurveyReportMeta | null>(null);
  const [responses, setResponses] = useState<SurveyResponseItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const totalPages = useMemo(() => {
    const totalSessions = report?.summary.total_sessions ?? 0;
    return Math.max(1, Math.ceil(totalSessions / PAGE_SIZE));
  }, [report]);

  useEffect(() => {
    async function loadReportMeta() {
      if (!apiUrl || !accountId) return;
      const client = createApiClient(apiUrl);
      const result = await client.surveys.report(accountId, id);
      if (result.ok) {
        const value = result.value as SurveyReportMeta;
        setReport({
          survey: value.survey,
          summary: value.summary,
        });
      } else {
        setError(result.error.message);
      }
    }
    void loadReportMeta();
  }, [accountId, apiUrl, id]);

  useEffect(() => {
    async function loadResponses() {
      if (!apiUrl || !accountId) {
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      const client = createApiClient(apiUrl);
      const result = await client.surveys.responses(accountId, id, {
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      });
      if (result.ok) {
        setResponses(result.value as SurveyResponseItem[]);
      } else {
        setError(result.error.message);
      }
      setLoading(false);
    }
    void loadResponses();
  }, [accountId, apiUrl, id, page]);

  return (
    <main className="mx-auto max-w-6xl p-6 space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-cobalt-700">
            {report?.survey.name ?? "アンケート"} 回答一覧
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            全ての回答セッションをページ単位で確認できます。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/${locale}/surveys/${id}/report`}>
            <Button type="button" variant="outline">レポートに戻る</Button>
          </Link>
          <Link href={`/${locale}/surveys/${id}`}>
            <Button type="button" variant="outline">編集に戻る</Button>
          </Link>
        </div>
      </div>

      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm text-muted-foreground">回答セッション総数</div>
            <div className="mt-2 text-3xl font-bold text-cobalt-700">{report?.summary.total_sessions ?? 0}</div>
          </div>
          <div className="text-sm text-muted-foreground">
            {page} / {totalPages} ページ
          </div>
        </div>
      </section>

      {error ? <div className="rounded-md bg-red-50 p-3 text-sm text-red-600">{error}</div> : null}

      {loading ? (
        <div className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-muted-foreground">
          読み込み中...
        </div>
      ) : responses.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-muted-foreground">
          まだ回答はありません。
        </div>
      ) : (
        <div className="space-y-4">
          {responses.map((response) => (
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
                <div className="text-sm text-right text-muted-foreground">
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

          {totalPages > 1 ? (
            <div className="flex items-center justify-between">
              <Button
                type="button"
                variant="outline"
                disabled={page <= 1}
                onClick={() => setPage((current) => Math.max(current - 1, 1))}
              >
                前へ
              </Button>
              <span className="text-sm text-muted-foreground">{page} / {totalPages}</span>
              <Button
                type="button"
                variant="outline"
                disabled={page >= totalPages}
                onClick={() => setPage((current) => Math.min(current + 1, totalPages))}
              >
                次へ
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </main>
  );
}
