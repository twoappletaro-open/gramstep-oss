"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { Input } from "../ui/input";
import { Card } from "../ui/card";
import { Select } from "../ui/select";
import { Textarea } from "../ui/textarea";
import { createApiClient, getApiUrl } from "../../lib/api-client";
import {
  formatConversationStatus,
  getStatusVariant,
  formatTimestamp,
} from "../../lib/user-helpers";
import type { ConversationStatus } from "@gramstep/shared";

type Message = {
  id: string;
  direction: "inbound" | "outbound";
  message_type: string;
  content: string | null;
  source_type: string;
  delivery_status: string;
  ig_message_id: string | null;
  media_r2_key: string | null;
  created_at: number;
};

type UserInfo = {
  id: string;
  ig_username: string | null;
  display_name: string | null;
  conversation_status: string | null;
  control_mode: string | null;
  assigned_operator_id: string | null;
};

export function ChatPanel({
  userId,
  accountId,
}: {
  userId: string;
  accountId: string;
}) {
  const t = useTranslations("chat");
  const tCommon = useTranslations("common");
  const [messages, setMessages] = useState<Message[]>([]);
  const [user, setUser] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [messageText, setMessageText] = useState("");
  const [sendError, setSendError] = useState("");
  const [statusValue, setStatusValue] = useState<string>("unread");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const apiUrl =
    typeof window !== "undefined"
      ? (getApiUrl())
      : "";
  const client = createApiClient(apiUrl);

  const loadUser = useCallback(async () => {
    const result = await client.users.get(userId, accountId);
    if (result.ok) {
      const data = result.value as { user: UserInfo } | UserInfo;
      const u = "user" in data ? data.user : data;
      setUser(u);
      setStatusValue(formatConversationStatus(u.conversation_status));
    }
  }, [userId, accountId]);

  const loadMessages = useCallback(async () => {
    const result = await client.chats.messages(userId, accountId, {
      limit: 50,
    });
    if (result.ok) {
      const msgs = result.value as Message[];
      // Reverse so oldest is first (API returns newest first)
      setMessages(msgs.reverse());
    }
  }, [userId, accountId]);

  const load = useCallback(async () => {
    setLoading(true);
    await Promise.all([loadUser(), loadMessages()]);
    setLoading(false);
  }, [loadUser, loadMessages]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSend() {
    if (!messageText.trim() || sending) return;
    setSending(true);
    setSendError("");

    const result = await client.chats.send(userId, accountId, {
      ig_user_id: userId,
      message_type: "text",
      content: messageText.trim(),
    });

    if (result.ok) {
      setMessageText("");
      await loadMessages();
    } else {
      setSendError(result.error.message || t("sendFailed"));
    }
    setSending(false);
  }

  async function handleTakeControl() {
    const result = await client.chats.takeControl(userId, accountId);
    if (result.ok) {
      void loadUser();
    }
  }

  async function handleReleaseControl() {
    const result = await client.chats.releaseControl(userId, accountId);
    if (result.ok) {
      void loadUser();
    }
  }

  async function handleStatusChange(newStatus: string) {
    if (!newStatus || newStatus === statusValue) return;
    setStatusValue(newStatus);
    await client.chats.updateStatus(
      userId,
      accountId,
      newStatus as ConversationStatus,
    );
    void loadUser();
  }

  const isHumanMode = user?.control_mode === "human";

  if (loading) {
    return <p className="text-muted-foreground">{tCommon("loading")}</p>;
  }

  return (
    <div className="flex flex-col h-[calc(100vh-200px)] max-h-[700px]">
      {/* Chat Header */}
      <div className="flex items-center justify-between border-b p-4">
        <div className="flex items-center gap-3">
          <a href={`..`}>
            <Button variant="ghost" size="sm">
              {tCommon("back")}
            </Button>
          </a>
          <div>
            <h2 className="font-semibold">
              {user?.display_name ?? user?.ig_username ?? userId}
            </h2>
            <Badge
              variant={getStatusVariant(
                formatConversationStatus(user?.conversation_status),
              )}
              className="text-xs"
            >
              {t(
                `status${capitalize(formatConversationStatus(user?.conversation_status))}` as Parameters<typeof t>[0],
              )}
            </Badge>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Status selector */}
          <Select
            value={statusValue}
            onChange={(e) => void handleStatusChange(e.target.value)}
            className="w-[140px] h-8 text-sm"
          >
            <option value="unread">{t("statusUnread")}</option>
            <option value="in_progress">{t("statusInProgress")}</option>
            <option value="resolved">{t("statusResolved")}</option>
            <option value="custom">{t("statusCustom")}</option>
          </Select>

          {/* Control toggle */}
          {isHumanMode ? (
            <Button
              variant="outline"
              size="sm"
              onClick={handleReleaseControl}
            >
              {t("releaseControl")}
            </Button>
          ) : (
            <Button size="sm" onClick={handleTakeControl}>
              {t("takeControl")}
            </Button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 ? (
          <p className="text-center text-muted-foreground text-sm">
            {t("noMessages")}
          </p>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.direction === "outbound" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[70%] rounded-lg px-3 py-2 text-sm ${
                  msg.direction === "outbound"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted"
                }`}
              >
                <p>{msg.content ?? `[${msg.message_type}]`}</p>
                <div
                  className={`flex items-center gap-1 mt-1 text-xs ${
                    msg.direction === "outbound"
                      ? "text-primary-foreground/70"
                      : "text-muted-foreground"
                  }`}
                >
                  <span>{formatTimestamp(msg.created_at)}</span>
                  {msg.direction === "outbound" && (
                    <span>
                      {msg.delivery_status === "read"
                        ? "✓✓"
                        : msg.delivery_status === "delivered"
                          ? "✓"
                          : msg.delivery_status === "failed"
                            ? "✗"
                            : "○"}
                    </span>
                  )}
                  {msg.source_type === "manual" && (
                    <Badge variant="outline" className="text-[10px] px-1 py-0 h-4">
                      {t("manual")}
                    </Badge>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="border-t p-4">
        {isHumanMode ? (
          <div className="flex gap-2">
            <Textarea
              placeholder={t("messagePlaceholder")}
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void handleSend();
                }
              }}
              className="flex-1 min-h-[40px] max-h-[120px] resize-none"
              rows={1}
            />
            <Button
              onClick={handleSend}
              disabled={!messageText.trim() || sending}
            >
              {sending ? tCommon("loading") : t("send")}
            </Button>
          </div>
        ) : (
          <Card className="p-3 text-center text-sm text-muted-foreground">
            {t("botControlMessage")}
            <Button
              variant="link"
              size="sm"
              className="ml-1"
              onClick={handleTakeControl}
            >
              {t("takeControl")}
            </Button>
          </Card>
        )}
        {isHumanMode && (
          <>
            <p className="text-xs text-muted-foreground mt-1">
              {t("humanAgentNote")}
            </p>
            {sendError && (
              <p className="text-xs text-destructive mt-1">
                {sendError}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function capitalize(s: string): string {
  if (!s) return s;
  return s
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}
