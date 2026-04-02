"use client";

import { UserList } from "../../../components/users/user-list";

export default function UsersPage() {
  const accountId = typeof window !== "undefined"
    ? localStorage.getItem("gramstep_account_id") ?? ""
    : "default";

  return (
    <main className="mx-auto max-w-6xl p-6">
      <UserList accountId={accountId} />
    </main>
  );
}
