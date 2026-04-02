"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { normalizeAutomation } from "../../lib/normalize";
import { useTranslations } from "next-intl";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "../ui/table";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogContent,
  DialogFooter,
} from "../ui/dialog";
import { createApiClient, getApiUrl } from "../../lib/api-client";
import { formatLogicLabel } from "../../lib/automation-helpers";

type AutomationRule = {
  id: string;
  name: string;
  condition_group: { logic: string; conditions: unknown[] };
  actions: unknown[];
  is_active: boolean;
  version: number;
};

export function AutomationList({ accountId }: { accountId: string }) {
  const t = useTranslations("automations");
  const tCommon = useTranslations("common");
  const pathname = usePathname();
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<AutomationRule | null>(null);
  const [deleting, setDeleting] = useState(false);

  const apiUrl = typeof window !== "undefined"
    ? (getApiUrl())
    : "";
  const client = createApiClient(apiUrl);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await client.automations.list(accountId);
    if (result.ok) {
      setRules((result.value as Array<Record<string, unknown>>).map(normalizeAutomation) as unknown as AutomationRule[]);
    }
    setLoading(false);
  }, [accountId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    const result = await client.automations.delete(deleteTarget.id);
    if (result.ok) {
      setRules((prev) => prev.filter((r) => r.id !== deleteTarget.id));
    }
    setDeleting(false);
    setDeleteTarget(null);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-cobalt-700">{t("title")}</h1>
        <a href="./automations/new">
          <Button>{t("create")}</Button>
        </a>
      </div>

      {loading ? (
        <p className="text-muted-foreground py-8 text-center">{tCommon("loading")}</p>
      ) : rules.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-12 text-center">
          <p className="text-muted-foreground" data-testid="empty-state">
            {t("empty")}
          </p>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("name")}</TableHead>
              <TableHead>{t("logic")}</TableHead>
              <TableHead>{t("conditions")}</TableHead>
              <TableHead>{t("actions")}</TableHead>
              <TableHead>{t("status")}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rules.map((r) => (
              <TableRow key={r.id}>
                <TableCell>
                  <a href={`${pathname}/${r.id}`} className="font-medium text-cobalt-700 hover:text-steel-500 transition-colors">
                    {r.name}
                  </a>
                </TableCell>
                <TableCell>{formatLogicLabel(r.condition_group.logic)}</TableCell>
                <TableCell>{r.condition_group.conditions.length}</TableCell>
                <TableCell>{r.actions.length}</TableCell>
                <TableCell>
                  <Badge variant={r.is_active ? "default" : "secondary"}>
                    {r.is_active ? t("active") : t("inactive")}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <a href={`${pathname}/${r.id}`}>
                    <Button variant="ghost" size="sm">{tCommon("edit")}</Button>
                  </a>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive"
                    onClick={() => setDeleteTarget(r)}
                  >
                    {tCommon("delete")}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        </div>
      )}

      <Dialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogHeader>
          <DialogTitle>{t("deleteConfirmTitle")}</DialogTitle>
        </DialogHeader>
        <DialogContent>
          <p>{t("deleteConfirmMessage", { name: deleteTarget?.name ?? "" })}</p>
        </DialogContent>
        <DialogFooter>
          <Button variant="outline" onClick={() => setDeleteTarget(null)}>
            {tCommon("cancel")}
          </Button>
          <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
            {deleting ? tCommon("loading") : tCommon("delete")}
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
