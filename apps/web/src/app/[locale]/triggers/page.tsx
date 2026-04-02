"use client";

import { TriggerList } from "../../../components/triggers/trigger-list";

export default function TriggersPage() {
  const accountId = typeof window !== "undefined"
    ? localStorage.getItem("gramstep_account_id") ?? ""
    : "default";

  return (
    <main className="mx-auto max-w-6xl p-6">
      <TriggerList accountId={accountId} />
    </main>
  );
}
