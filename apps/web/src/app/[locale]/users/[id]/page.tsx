"use client";

import { use } from "react";
import { UserDetail } from "../../../../components/users/user-detail";

export default function UserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const accountId = typeof window !== "undefined"
    ? localStorage.getItem("gramstep_account_id") ?? ""
    : "default";

  return (
    <main className="mx-auto max-w-6xl p-6">
      <UserDetail userId={id} accountId={accountId} />
    </main>
  );
}
