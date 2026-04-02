"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { normalizeScenario } from "../../lib/normalize";
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

type Scenario = {
  id: string;
  name: string;
  trigger_type: string;
  is_active: boolean;
  steps_count?: number;
  version: number;
  created_at: number;
};

export function ScenarioList({ accountId }: { accountId: string }) {
  const t = useTranslations("scenarios");
  const tCommon = useTranslations("common");
  const pathname = usePathname();
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<Scenario | null>(null);
  const [deleting, setDeleting] = useState(false);

  const apiUrl = typeof window !== "undefined"
    ? (getApiUrl())
    : "";
  const client = createApiClient(apiUrl);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await client.scenarios.list(accountId);
    if (result.ok) {
      setScenarios((result.value as Array<Record<string, unknown>>).map(normalizeScenario) as unknown as Scenario[]);
    }
    setLoading(false);
  }, [accountId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    const result = await client.scenarios.delete(deleteTarget.id);
    if (result.ok) {
      setScenarios((prev) => prev.filter((s) => s.id !== deleteTarget.id));
    }
    setDeleting(false);
    setDeleteTarget(null);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-cobalt-700">{t("title")}</h1>
        <a href="./scenarios/new">
          <Button>{t("create")}</Button>
        </a>
      </div>

      {loading ? (
        <p className="text-muted-foreground py-8 text-center">{tCommon("loading")}</p>
      ) : scenarios.length === 0 ? (
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
              <TableHead>{t("status")}</TableHead>
              <TableHead>{t("steps")}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {scenarios.map((s) => (
              <TableRow key={s.id}>
                <TableCell>
                  <a href={`${pathname}/${s.id}`} className="font-medium text-cobalt-700 hover:text-steel-500 transition-colors">
                    {s.name}
                  </a>
                </TableCell>
                <TableCell>{formatTriggerTypeLabel(s.trigger_type)}</TableCell>
                <TableCell>
                  <Badge variant={s.is_active ? "default" : "secondary"}>
                    {s.is_active ? t("active") : t("inactive")}
                  </Badge>
                </TableCell>
                <TableCell>{s.steps_count ?? "—"}</TableCell>
                <TableCell className="text-right">
                  <a href={`${pathname}/${s.id}`}>
                    <Button variant="ghost" size="sm">{tCommon("edit")}</Button>
                  </a>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive"
                    onClick={() => setDeleteTarget(s)}
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
