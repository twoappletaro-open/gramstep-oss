"use client";

import { AutomationList } from "../../../components/automations/automation-list";

export default function AutomationsPage() {
  const accountId = typeof window !== "undefined"
    ? localStorage.getItem("gramstep_account_id") ?? ""
    : "default";

  return (
    <main className="mx-auto max-w-6xl p-6">
      <AutomationList accountId={accountId} />
    </main>
  );
}
