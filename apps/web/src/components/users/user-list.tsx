"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { Input } from "../ui/input";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "../ui/table";
import { Select } from "../ui/select";
import { createApiClient, getApiUrl } from "../../lib/api-client";
import {
  formatConversationStatus,
  getStatusVariant,
  formatTimestamp,
} from "../../lib/user-helpers";

type IgUser = {
  id: string;
  ig_username: string | null;
  display_name: string | null;
  follower_status: string;
  conversation_status: string | null;
  score: number;
  is_opted_out: number;
  is_blocked: number;
  last_interaction_at: number | null;
  last_message_content: string | null;
  last_message_direction: string | null;
  is_test_account?: number;
};

type ListResponse = {
  data: IgUser[];
  total: number;
  page: number;
  per_page: number;
};

export function UserList({ accountId }: { accountId: string }) {
  const t = useTranslations("users");
  const tCommon = useTranslations("common");
  const pathname = usePathname(); // e.g. "/ja/users"
  const [users, setUsers] = useState<IgUser[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");

  const apiUrl =
    typeof window !== "undefined"
      ? (getApiUrl())
      : "";
  const client = createApiClient(apiUrl);

  const load = useCallback(async () => {
    setLoading(true);
    const params: Record<string, unknown> = { page };
    if (search) params.search = search;
    if (statusFilter) params.status = statusFilter;

    const result = await client.chats.list(accountId, params as Record<string, string>);
    if (result.ok) {
      const resp = result.value as ListResponse;
      setUsers(resp.data);
      setTotal(resp.total);
    }
    setLoading(false);
  }, [accountId, page, search, statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const perPage = 20;
  const totalPages = Math.ceil(total / perPage);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-cobalt-700">{t("title")}</h1>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <Input
          placeholder={tCommon("search")}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          className="max-w-xs"
          data-testid="search-input"
        />
        <Select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value === "all" ? "" : e.target.value);
            setPage(1);
          }}
          className="w-[180px]"
          data-testid="status-filter"
        >
          <option value="all">{t("allStatuses")}</option>
          <option value="unread">{t("statusUnread")}</option>
          <option value="in_progress">{t("statusInProgress")}</option>
          <option value="resolved">{t("statusResolved")}</option>
        </Select>
      </div>

      {loading ? (
        <p className="text-muted-foreground py-8 text-center">{tCommon("loading")}</p>
      ) : users.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-12 text-center">
          <p className="text-muted-foreground" data-testid="empty-state">
            {t("empty")}
          </p>
        </div>
      ) : (
        <>
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("username")}</TableHead>
                <TableHead>{t("displayName")}</TableHead>
                <TableHead>{t("conversationStatus")}</TableHead>
                <TableHead>{t("score")}</TableHead>
                <TableHead>{t("lastInteraction")}</TableHead>
                <TableHead>{t("lastMessage")}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <a
                        href={`${pathname}/${u.id}`}
                        className="font-medium text-cobalt-700 hover:text-steel-500 transition-colors"
                      >
                        {u.ig_username ?? "—"}
                      </a>
                      {Boolean(u.is_test_account) && (
                        <Badge variant="secondary">テストユーザー</Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>{u.display_name ?? "—"}</TableCell>
                  <TableCell>
                    <Badge
                      variant={getStatusVariant(
                        formatConversationStatus(u.conversation_status),
                      )}
                    >
                      {t(
                        `status${capitalize(formatConversationStatus(u.conversation_status))}` as Parameters<typeof t>[0],
                      )}
                    </Badge>
                  </TableCell>
                  <TableCell>{u.score}</TableCell>
                  <TableCell>{formatTimestamp(u.last_interaction_at)}</TableCell>
                  <TableCell className="max-w-[200px] truncate">
                    {u.last_message_content
                      ? `${u.last_message_direction === "inbound" ? "←" : "→"} ${u.last_message_content}`
                      : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <a href={`${pathname}/${u.id}`}>
                      <Button variant="ghost" size="sm">
                        {t("detail")}
                      </Button>
                    </a>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                {t("prevPage")}
              </Button>
              <span className="text-sm text-muted-foreground">
                {page} / {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                {t("nextPage")}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function capitalize(s: string): string {
  if (!s) return s;
  // Convert snake_case to PascalCase: "in_progress" -> "InProgress"
  return s
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}
