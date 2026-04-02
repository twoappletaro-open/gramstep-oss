"use client";

import { SurveyList } from "../../../components/surveys/survey-list";

export default function SurveysPage() {
  const accountId = typeof window !== "undefined"
    ? localStorage.getItem("gramstep_account_id") ?? ""
    : "default";

  return (
    <main className="mx-auto max-w-6xl p-6">
      <SurveyList accountId={accountId} />
    </main>
  );
}
