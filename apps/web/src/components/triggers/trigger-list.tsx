"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { normalizeTrigger } from "../../lib/normalize";
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
import { formatTriggerTypeLabel } from "../../lib/scenario-helpers";
import { formatMatchTypeLabel, formatFireModeLabel } from "../../lib/trigger-helpers";

type Trigger = {
  id: string;
  name: string;
  trigger_type: string;
  match_type: string;
  fire_mode: string;
  keywords: string[];
  is_active: boolean;
  version: number;
};

export function TriggerList({ accountId }: { accountId: string }) {
  const t = useTranslations("triggers");
  const tCommon = useTranslations("common");
  const pathname = usePathname();
  const [triggers, setTriggers] = useState<Trigger[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<Trigger | null>(null);
  const [deleting, setDeleting] = useState(false);

  const apiUrl = typeof window !== "undefined"
    ? (getApiUrl())
    : "";
  const client = createApiClient(apiUrl);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await client.triggers.list(accountId);
    if (result.ok) {
      setTriggers((result.value as Array<Record<string, unknown>>).map(normalizeTrigger) as unknown as Trigger[]);
    }
    setLoading(false);
  }, [accountId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    const result = await client.triggers.delete(deleteTarget.id);
    if (result.ok) {
      setTriggers((prev) => prev.filter((tr) => tr.id !== deleteTarget.id));
    }
    setDeleting(false);
    setDeleteTarget(null);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-cobalt-700">{t("title")}</h1>
        <a href="./triggers/new">
          <Button>{t("create")}</Button>
        </a>
      </div>

      {loading ? (
        <p className="text-muted-foreground py-8 text-center">{tCommon("loading")}</p>
      ) : triggers.length === 0 ? (
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
              <TableHead>{t("triggerType")}</TableHead>
              <TableHead>{t("matchType")}</TableHead>
              <TableHead>{t("fireMode")}</TableHead>
              <TableHead>{t("status")}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {triggers.map((tr) => (
              <TableRow key={tr.id}>
                <TableCell>
                  <a href={`${pathname}/${tr.id}`} className="font-medium text-cobalt-700 hover:text-steel-500 transition-colors">
                    {tr.name}
                  </a>
                </TableCell>
                <TableCell>{formatTriggerTypeLabel(tr.trigger_type)}</TableCell>
                <TableCell>{formatMatchTypeLabel(tr.match_type)}</TableCell>
                <TableCell>{formatFireModeLabel(tr.fire_mode)}</TableCell>
                <TableCell>
                  <Badge variant={tr.is_active ? "default" : "secondary"}>
                    {tr.is_active ? t("active") : t("inactive")}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <a href={`${pathname}/${tr.id}`}>
                    <Button variant="ghost" size="sm">{tCommon("edit")}</Button>
                  </a>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive"
                    onClick={() => setDeleteTarget(tr)}
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
