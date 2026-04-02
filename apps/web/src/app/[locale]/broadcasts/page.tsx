"use client";

import { BroadcastList } from "../../../components/broadcasts/broadcast-list";

export default function BroadcastsPage() {
  const accountId = typeof window !== "undefined"
    ? localStorage.getItem("gramstep_account_id") ?? ""
    : "default";

  return (
    <main className="mx-auto max-w-6xl p-6">
      <BroadcastList accountId={accountId} />
    </main>
  );
}
