"use client";

import { CampaignList } from "../../../components/campaigns/campaign-list";

export default function CampaignsPage() {
  const accountId = typeof window !== "undefined"
    ? localStorage.getItem("gramstep_account_id") ?? ""
    : "default";

  return (
    <main className="mx-auto max-w-6xl p-6">
      <CampaignList accountId={accountId} />
    </main>
  );
}
