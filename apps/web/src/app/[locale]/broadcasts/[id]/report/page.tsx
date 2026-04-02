"use client";

import { useParams } from "next/navigation";
import { BroadcastReport } from "../../../../../components/broadcasts/broadcast-report";

export default function BroadcastReportPage() {
  const params = useParams();
  const id = params.id as string;
  const accountId = typeof window !== "undefined"
    ? localStorage.getItem("gramstep_account_id") ?? ""
    : "default";

  return (
    <main className="mx-auto max-w-6xl p-6">
      <BroadcastReport accountId={accountId} broadcastId={id} />
    </main>
  );
}
