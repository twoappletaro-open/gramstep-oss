"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { Input } from "../ui/input";
import { Card } from "../ui/card";
import { createApiClient, getApiUrl } from "../../lib/api-client";
import {
  formatConversationStatus,
  getStatusVariant,
  formatFollowerStatus,
  formatTimestamp,
} from "../../lib/user-helpers";

type Tag = { id: string; name: string };

type UserData = {
  id: string;
  ig_scoped_id: string;
  ig_username: string | null;
  display_name: string | null;
  follower_status: string;
  conversation_status: string | null;
  assigned_operator_id: string | null;
  control_mode: string | null;
  score: number;
  metadata: string;
  is_opted_out: number;
  is_blocked: number;
  profile_image_r2_key: string | null;
  timezone: string | null;
  preferred_delivery_hour: number | null;
  created_at: number;
  last_interaction_at: number | null;
  updated_at: number;
  tags?: Tag[];
  is_test_account?: boolean;
  test_account_id?: string | null;
};

type UserDetailResponse = {
  user: Omit<UserData, "tags" | "is_test_account" | "test_account_id">;
  tags: Tag[];
  is_test_account: boolean;
  test_account_id: string | null;
};

export function UserDetail({
  userId,
  accountId,
}: {
  userId: string;
  accountId: string;
}) {
  const t = useTranslations("users");
  const pathname = usePathname(); // e.g. "/ja/users/xxx"
  const tCommon = useTranslations("common");
  const [user, setUser] = useState<UserData | null>(null);
  const [loading, setLoading] = useState(true);
  const [newTag, setNewTag] = useState("");
  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [resettingFirstTriggerHistory, setResettingFirstTriggerHistory] = useState(false);
  const [firstTriggerResetMessage, setFirstTriggerResetMessage] = useState<string | null>(null);
  const [togglingTestAccount, setTogglingTestAccount] = useState(false);
  const [testAccountMessage, setTestAccountMessage] = useState<string | null>(null);

  const apiUrl =
    typeof window !== "undefined"
      ? (getApiUrl())
      : "";
  const client = createApiClient(apiUrl);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await client.users.get(userId, accountId);
    if (result.ok) {
      const detail = result.value as UserDetailResponse;
      const u: UserData = {
        ...detail.user,
        tags: detail.tags,
        is_test_account: detail.is_test_account,
        test_account_id: detail.test_account_id,
      };
      setUser(u);
      setDisplayName(u.display_name ?? "");
    }
    setLoading(false);
  }, [userId, accountId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleSaveDisplayName() {
    if (!user) return;
    await client.users.update(userId, accountId, { display_name: displayName });
    setEditing(false);
    void load();
  }

  async function handleAddTag() {
    if (!user || !newTag.trim()) return;
    await client.users.addTag(userId, accountId, newTag.trim());
    setNewTag("");
    void load();
  }

  async function handleRemoveTag(tagId: string) {
    if (!user) return;
    await client.users.removeTag(userId, tagId);
    void load();
  }

  async function handleToggleOptOut() {
    if (!user) return;
    if (user.is_opted_out) {
      await client.users.optIn(userId, accountId);
    } else {
      await client.users.optOut(userId, accountId);
    }
    void load();
  }

  async function handleToggleBlock() {
    if (!user) return;
    if (user.is_blocked) {
      await client.users.unblock(userId, accountId);
    } else {
      await client.users.block(userId, accountId);
    }
    void load();
  }

  async function handleResetFirstTriggerHistory() {
    if (!user) return;
    const shouldContinue = window.confirm(
      "初回トリガー履歴をクリアします。同じアカウントで初回送信テストを繰り返すための操作です。通常ユーザーには使わず、テストユーザーだけで実行してください。",
    );
    if (!shouldContinue) return;

    setResettingFirstTriggerHistory(true);
    setFirstTriggerResetMessage(null);
    const result = await client.users.resetFirstTriggerHistory(userId, accountId);
    if (result.ok) {
      setFirstTriggerResetMessage(`初回トリガー履歴を ${result.value.cleared} 件クリアしました。`);
    } else {
      setFirstTriggerResetMessage(result.error.message);
    }
    setResettingFirstTriggerHistory(false);
  }

  async function handleRegisterTestAccount() {
    if (!user) return;
    const shouldContinue = window.confirm(
      "このユーザーをテストユーザーとして登録します。同じアカウントで初回送信テストを繰り返したい場合にのみ使ってください。",
    );
    if (!shouldContinue) return;

    setTogglingTestAccount(true);
    setTestAccountMessage(null);
    const result = await client.users.registerTestAccount(userId, accountId);
    if (result.ok) {
      setUser((current) =>
        current
          ? {
            ...current,
            is_test_account: result.value.is_test_account,
            test_account_id: result.value.test_account_id,
          }
          : current,
      );
      setTestAccountMessage(
        result.value.changed
          ? "テストユーザーに登録しました。初回トリガー履歴のクリアが使えます。"
          : "このユーザーはすでにテストユーザーです。",
      );
    } else {
      setTestAccountMessage(result.error.message);
    }
    setTogglingTestAccount(false);
  }

  async function handleUnregisterTestAccount() {
    if (!user) return;
    const shouldContinue = window.confirm(
      "テストユーザー登録を解除します。解除すると初回トリガー履歴のクリアは使えなくなります。",
    );
    if (!shouldContinue) return;

    setTogglingTestAccount(true);
    setTestAccountMessage(null);
    const result = await client.users.unregisterTestAccount(userId, accountId);
    if (result.ok) {
      setUser((current) =>
        current
          ? {
            ...current,
            is_test_account: result.value.is_test_account,
            test_account_id: result.value.test_account_id,
          }
          : current,
      );
      setTestAccountMessage(
        result.value.changed
          ? "テストユーザー登録を解除しました。通常ユーザーとして扱われます。"
          : "このユーザーはテストユーザー登録されていません。",
      );
      setFirstTriggerResetMessage(null);
    } else {
      setTestAccountMessage(result.error.message);
    }
    setTogglingTestAccount(false);
  }

  if (loading) {
    return <p className="text-muted-foreground">{tCommon("loading")}</p>;
  }

  if (!user) {
    return <p className="text-muted-foreground">{t("notFound")}</p>;
  }

  const status = formatConversationStatus(user.conversation_status);
  const metadata = (() => {
    try {
      return JSON.parse(user.metadata) as Record<string, string>;
    } catch {
      return {};
    }
  })();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-cobalt-700">
            {user.ig_username ?? user.ig_scoped_id}
          </h1>
          <p className="text-muted-foreground">
            {t("igScopedId")}: {user.ig_scoped_id}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={getStatusVariant(status)}>
            {t(`status${capitalize(status)}` as Parameters<typeof t>[0])}
          </Badge>
          <a href={`${pathname}/chat`}>
            <Button>{t("openChat")}</Button>
          </a>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {/* Profile Card */}
        <Card className="p-4 space-y-3">
          <h2 className="text-lg font-semibold">{t("profile")}</h2>

          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t("displayName")}</span>
              {editing ? (
                <div className="flex items-center gap-2">
                  <Input
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    className="h-7 w-40"
                  />
                  <Button size="sm" onClick={handleSaveDisplayName}>
                    {tCommon("save")}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setEditing(false)}
                  >
                    {tCommon("cancel")}
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span>{user.display_name ?? "—"}</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setEditing(true)}
                  >
                    {tCommon("edit")}
                  </Button>
                </div>
              )}
            </div>

            <div className="flex justify-between">
              <span className="text-muted-foreground">
                {t("followerStatus")}
              </span>
              <span>{formatFollowerStatus(user.follower_status)}</span>
            </div>

            <div className="flex justify-between">
              <span className="text-muted-foreground">{t("score")}</span>
              <span>{user.score}</span>
            </div>

            <div className="flex justify-between">
              <span className="text-muted-foreground">
                {t("lastInteraction")}
              </span>
              <span>{formatTimestamp(user.last_interaction_at)}</span>
            </div>

            <div className="flex justify-between">
              <span className="text-muted-foreground">
                {t("createdAt")}
              </span>
              <span>{formatTimestamp(user.created_at)}</span>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-2 border-t">
            <Button
              variant={user.is_opted_out ? "default" : "outline"}
              size="sm"
              onClick={handleToggleOptOut}
            >
              {user.is_opted_out ? t("optIn") : t("optOut")}
            </Button>
            <Button
              variant={user.is_blocked ? "default" : "destructive"}
              size="sm"
              onClick={handleToggleBlock}
            >
              {user.is_blocked ? t("unblock") : t("block")}
            </Button>
          </div>
        </Card>

        {/* Tags Card */}
        <Card className="p-4 space-y-3">
          <h2 className="text-lg font-semibold">{t("tags")}</h2>

          <div className="flex flex-wrap gap-2">
            {(user.tags ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("noTags")}</p>
            ) : (
              (user.tags ?? []).map((tag) => (
                <Badge
                  key={tag.id}
                  variant="secondary"
                  className="cursor-pointer"
                  onClick={() => handleRemoveTag(tag.id)}
                >
                  {tag.name} ×
                </Badge>
              ))
            )}
          </div>

          <div className="flex gap-2">
            <Input
              placeholder={t("addTagPlaceholder")}
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleAddTag();
              }}
              className="flex-1"
            />
            <Button size="sm" onClick={handleAddTag} disabled={!newTag.trim()}>
              {t("addTag")}
            </Button>
          </div>
        </Card>

        {/* Metadata Card */}
        {Object.keys(metadata).length > 0 && (
          <Card className="p-4 space-y-3">
            <h2 className="text-lg font-semibold">{t("metadata")}</h2>
            <div className="space-y-1 text-sm">
              {Object.entries(metadata).map(([key, value]) => (
                <div key={key} className="flex justify-between">
                  <span className="text-muted-foreground">{key}</span>
                  <span>{value}</span>
                </div>
              ))}
            </div>
          </Card>
        )}

        <Card className="p-4 space-y-3 md:col-span-2">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">初回トリガー送信テスト</h2>
              <p className="text-sm text-muted-foreground">
                同じアカウントで「初回のみ」の自動返信テストを繰り返すために、このユーザーの
                `trigger_fire_logs` をクリアします。
              </p>
            </div>
            <Badge variant={user.is_test_account ? "default" : "secondary"}>
              {user.is_test_account ? "テストユーザー" : "通常ユーザー"}
            </Badge>
          </div>

          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            テストユーザー専用の操作です。通常ユーザーでは使わないでください。初回送信テストをやり直したい時だけ実行します。
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {user.is_test_account ? (
              <Button
                type="button"
                variant="secondary"
                onClick={handleUnregisterTestAccount}
                disabled={togglingTestAccount}
              >
                {togglingTestAccount ? "更新中..." : "テストユーザー登録を解除"}
              </Button>
            ) : (
              <Button
                type="button"
                variant="default"
                onClick={handleRegisterTestAccount}
                disabled={togglingTestAccount}
              >
                {togglingTestAccount ? "登録中..." : "テストユーザーに登録"}
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              onClick={handleResetFirstTriggerHistory}
              disabled={resettingFirstTriggerHistory || togglingTestAccount || !user.is_test_account}
            >
              {resettingFirstTriggerHistory ? "クリア中..." : "初回トリガー履歴をクリア"}
            </Button>
            {!user.is_test_account && (
              <span className="text-sm text-muted-foreground">
                先にこの詳細画面でテストユーザー登録すると、同じアカウントで初回送信テストを繰り返せます。
              </span>
            )}
          </div>

          {testAccountMessage && (
            <p className="text-sm text-muted-foreground">{testAccountMessage}</p>
          )}
          {firstTriggerResetMessage && (
            <p className="text-sm text-muted-foreground">{firstTriggerResetMessage}</p>
          )}
        </Card>
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
