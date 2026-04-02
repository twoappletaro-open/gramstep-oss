"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { Input } from "../ui/input";
import { Card } from "../ui/card";
import { Select } from "../ui/select";
import { Textarea } from "../ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { Label } from "../ui/label";
import { createApiClient, getApiUrl } from "../../lib/api-client";
import {
  formatConversationStatus,
  getStatusVariant,
  formatTimestamp,
} from "../../lib/user-helpers";
import type { ConversationStatus } from "@gramstep/shared";
import { cn } from "../../lib/utils";

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

type PackageOption = {
  id: string;
  name: string;
};

type UploadedMedia = {
  url: string;
  r2Key: string;
  contentType: string;
  name: string;
};

type ComposerMode = "text" | "image" | "video" | "audio" | "package";

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
  const [composerMode, setComposerMode] = useState<ComposerMode>("text");
  const [uploadedMedia, setUploadedMedia] = useState<UploadedMedia | null>(null);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [packageOptions, setPackageOptions] = useState<PackageOption[]>([]);
  const [selectedPackageId, setSelectedPackageId] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
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

  useEffect(() => {
    if (!accountId) return;
    client.packages.list(accountId).then((result) => {
      if (!result.ok) return;
      const options = (result.value as Array<{ id?: string; name?: string }>)
        .filter((pkg): pkg is { id: string; name: string } => Boolean(pkg.id && pkg.name))
        .map((pkg) => ({ id: pkg.id, name: pkg.name }));
      setPackageOptions(options);
    }).catch(() => undefined);
  }, [accountId]);

  async function uploadMedia(file: File) {
    setUploadingMedia(true);
    setSendError("");
    try {
      const token = typeof sessionStorage !== "undefined" ? sessionStorage.getItem("accessToken") ?? "" : "";
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch(`${apiUrl}/api/media/upload`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "x-account-id": accountId,
        },
        body: formData,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        setSendError(body.error ?? t("sendFailed"));
        return;
      }

      const data = await res.json() as { url: string; r2Key: string; contentType: string };
      setUploadedMedia({
        url: data.url,
        r2Key: data.r2Key,
        contentType: data.contentType,
        name: file.name,
      });
    } catch (error: unknown) {
      setSendError(error instanceof Error ? error.message : t("sendFailed"));
    } finally {
      setUploadingMedia(false);
    }
  }

  function resetComposerState() {
    setMessageText("");
    setUploadedMedia(null);
    setSelectedPackageId("");
    setScheduledAt("");
  }

  async function handleSend() {
    if (sending) return;
    setSending(true);
    setSendError("");

    let result;
    if (composerMode === "text") {
      if (!messageText.trim()) {
        setSending(false);
        return;
      }
      result = await client.chats.send(userId, accountId, {
        ig_user_id: userId,
        message_type: "text",
        content: messageText.trim(),
      });
    } else if (composerMode === "package") {
      if (!selectedPackageId) {
        setSendError("パッケージを選択してください");
        setSending(false);
        return;
      }

      let scheduledAtSeconds: number | undefined;
      if (scheduledAt) {
        const nextTime = Math.floor(new Date(scheduledAt).getTime() / 1000);
        const now = Math.floor(Date.now() / 1000);
        if (!Number.isFinite(nextTime) || nextTime <= now) {
          setSendError("予約時刻は現在より後に設定してください");
          setSending(false);
          return;
        }
        if (nextTime > now + (7 * 24 * 60 * 60)) {
          setSendError("予約送信は7日以内で設定してください");
          setSending(false);
          return;
        }
        scheduledAtSeconds = nextTime;
      }

      result = await client.chats.send(userId, accountId, {
        ig_user_id: userId,
        message_type: "package",
        package_id: selectedPackageId,
        ...(scheduledAtSeconds ? { scheduled_at: scheduledAtSeconds } : {}),
      });
    } else {
      if (!uploadedMedia) {
        setSendError("先にファイルをアップロードしてください");
        setSending(false);
        return;
      }
      if (!isUploadedMediaCompatible(composerMode, uploadedMedia.contentType)) {
        setSendError(`${formatModeLabel(composerMode)}に対応したファイルをアップロードしてください`);
        setSending(false);
        return;
      }

      result = await client.chats.send(userId, accountId, {
        ig_user_id: userId,
        message_type: composerMode,
        media_url: uploadedMedia.url,
        media_r2_key: uploadedMedia.r2Key,
      });
    }

    if (result.ok) {
      resetComposerState();
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
                {renderMessageBody(msg, apiUrl)}
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
        {!isHumanMode && (
          <Card className="mb-3 p-3 text-center text-sm text-muted-foreground">
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

        <div className={cn("space-y-3", !isHumanMode && "opacity-60")}>
          <Tabs value={composerMode} onValueChange={(value) => {
            setComposerMode(value as ComposerMode);
            setSendError("");
          }}>
            <TabsList className="w-full justify-start overflow-x-auto">
              <TabsTrigger value="text">テキスト</TabsTrigger>
              <TabsTrigger value="image">画像</TabsTrigger>
              <TabsTrigger value="video">動画</TabsTrigger>
              <TabsTrigger value="audio">音声</TabsTrigger>
              <TabsTrigger value="package">パッケージ</TabsTrigger>
            </TabsList>

            <TabsContent value="text" className="mt-3">
              <Textarea
                placeholder={t("messagePlaceholder")}
                value={messageText}
                onChange={(e) => setMessageText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && isHumanMode) {
                    e.preventDefault();
                    void handleSend();
                  }
                }}
                className="min-h-[72px] resize-none"
                rows={3}
                disabled={!isHumanMode}
              />
            </TabsContent>

            {(["image", "video", "audio"] as const).map((mode) => (
              <TabsContent key={mode} value={mode} className="mt-3 space-y-3">
                <div className="space-y-2">
                  <Label>{formatModeLabel(mode)}</Label>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className={cn(
                      "inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm",
                      isHumanMode ? "cursor-pointer hover:bg-muted/50" : "cursor-not-allowed bg-muted/30",
                    )}>
                      <span>{uploadingMedia ? "アップロード中..." : `${formatModeLabel(mode)}を選択`}</span>
                      <input
                        type="file"
                        accept={acceptForMode(mode)}
                        className="hidden"
                        disabled={uploadingMedia || !isHumanMode}
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (!file) return;
                          void uploadMedia(file);
                          event.currentTarget.value = "";
                        }}
                      />
                    </label>
                    <span className="text-xs text-muted-foreground">
                      {helperTextForMode(mode)}
                    </span>
                  </div>
                  {uploadedMedia && (
                    <div className={cn(
                      "rounded-md border px-3 py-2 text-sm",
                      isUploadedMediaCompatible(mode, uploadedMedia.contentType)
                        ? "border-border bg-muted/30"
                        : "border-destructive/40 bg-destructive/5",
                    )}>
                      <p className="font-medium">{uploadedMedia.name}</p>
                      <p className="text-xs text-muted-foreground">{uploadedMedia.contentType}</p>
                    </div>
                  )}
                </div>
              </TabsContent>
            ))}

            <TabsContent value="package" className="mt-3 space-y-3">
              <div className="space-y-2">
                <Label htmlFor="manual-package">送信するパッケージ</Label>
                <Select
                  id="manual-package"
                  value={selectedPackageId}
                  onChange={(e) => setSelectedPackageId(e.target.value)}
                  disabled={!isHumanMode}
                >
                  <option value="">パッケージを選択</option>
                  {packageOptions.map((pkg) => (
                    <option key={pkg.id} value={pkg.id}>
                      {pkg.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="manual-schedule">配信予約日時</Label>
                <Input
                  id="manual-schedule"
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                  disabled={!isHumanMode}
                />
                <p className="text-xs text-muted-foreground">
                  空欄なら即時送信します。予約送信は7日以内です。
                </p>
              </div>
            </TabsContent>
          </Tabs>

          <div className="flex justify-end">
            <Button
              onClick={handleSend}
              disabled={!isHumanMode || sending || uploadingMedia}
            >
              {sending ? tCommon("loading") : t("send")}
            </Button>
          </div>
        </div>

        <p className="text-xs text-muted-foreground mt-1">
          {isHumanMode
            ? t("humanAgentNote")
            : "送信するには先に「有人対応を開始」を押してください。"}
        </p>
        {sendError && (
          <p className="text-xs text-destructive mt-1">
            {sendError}
          </p>
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

function acceptForMode(mode: Exclude<ComposerMode, "text" | "package">): string {
  if (mode === "image") {
    return "image/jpeg,image/png,image/gif,image/webp";
  }
  if (mode === "video") {
    return "video/mp4";
  }
  return "audio/mpeg,audio/mp4";
}

function helperTextForMode(mode: Exclude<ComposerMode, "text" | "package">): string {
  if (mode === "image") {
    return "JPG, PNG, GIF, WebP";
  }
  if (mode === "video") {
    return "MP4";
  }
  return "MP3, M4A";
}

function formatModeLabel(mode: Exclude<ComposerMode, "text" | "package">): string {
  if (mode === "image") return "画像";
  if (mode === "video") return "動画";
  return "音声";
}

function isUploadedMediaCompatible(
  mode: Exclude<ComposerMode, "text" | "package">,
  contentType: string,
): boolean {
  if (mode === "image") return contentType.startsWith("image/");
  if (mode === "video") return contentType.startsWith("video/");
  return contentType.startsWith("audio/");
}

function renderMessageBody(message: Message, apiUrl: string) {
  const mediaUrl = message.media_r2_key
    ? `${apiUrl}/api/media/${message.media_r2_key}`
    : null;

  if (message.message_type === "image" && mediaUrl) {
    return (
      <div className="space-y-2">
        <img src={mediaUrl} alt="sent media" className="max-h-64 rounded-md object-cover" />
        {message.content && <p>{message.content}</p>}
      </div>
    );
  }

  if (message.message_type === "video" && mediaUrl) {
    return (
      <div className="space-y-2">
        <video src={mediaUrl} controls className="max-h-64 rounded-md" />
        {message.content && <p>{message.content}</p>}
      </div>
    );
  }

  if (message.message_type === "audio" && mediaUrl) {
    return (
      <div className="space-y-2">
        <audio src={mediaUrl} controls className="w-full" />
        {message.content && <p>{message.content}</p>}
      </div>
    );
  }

  return <p>{message.content ?? `[${message.message_type}]`}</p>;
}
