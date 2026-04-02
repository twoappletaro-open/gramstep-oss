"use client";

import { ScenarioList } from "../../../components/scenarios/scenario-list";

export default function ScenariosPage() {
  // TODO: accountId should come from auth context (Task 14.1)
  const accountId = typeof window !== "undefined"
    ? localStorage.getItem("gramstep_account_id") ?? ""
    : "default";

  return (
    <main className="mx-auto max-w-6xl p-6">
      <ScenarioList accountId={accountId} />
    </main>
  );
}
