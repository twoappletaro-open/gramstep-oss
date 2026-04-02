"use client";

import { TemplateList } from "../../../components/templates/template-list";

export default function TemplatesPage() {
  const accountId = typeof window !== "undefined"
    ? localStorage.getItem("gramstep_account_id") ?? ""
    : "default";

  return (
    <main className="mx-auto max-w-6xl p-6">
      <TemplateList accountId={accountId} />
    </main>
  );
}
