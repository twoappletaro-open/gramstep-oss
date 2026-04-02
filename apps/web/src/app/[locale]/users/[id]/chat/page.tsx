"use client";

import { use } from "react";
import { ChatPanel } from "../../../../../components/users/chat-panel";

export default function ChatPage({
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
      <ChatPanel userId={id} accountId={accountId} />
    </main>
  );
}
