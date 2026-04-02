"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Heartbeat,
  Database,
  HardDrives,
  Queue,
  TreeStructure,
  Lightning,
  Users,
  ArrowsClockwise,
  ChartBar,
  Gear,
  ArrowRight,
} from "@phosphor-icons/react";
import type { Icon } from "@phosphor-icons/react";
import { getApiUrl } from "../../lib/api-client";
import { AnalyticsOverview } from "../../components/dashboard/analytics-overview";

interface HealthData {
  status: string;
  timestamp: number;
  checks: Record<string, string>;
}

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full ${ok ? "bg-powder-500" : "bg-gray-300"}`}
    />
  );
}

export default function DashboardPage() {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [accountId, setAccountId] = useState("");
  const pathname = usePathname();
  const locale = pathname.split("/")[1] ?? "ja";
  const t = useTranslations("dashboard");

  useEffect(() => {
    const apiUrl = getApiUrl();
    if (!apiUrl) return;
    fetch(`${apiUrl}/health`)
      .then((r) => r.json() as Promise<HealthData>)
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setAccountId(localStorage.getItem("gramstep_account_id") ?? "");
  }, []);

  const checks: { key: string; label: string; icon: Icon }[] = [
    { key: "worker", label: "Worker", icon: Heartbeat },
    { key: "d1", label: "D1 Database", icon: Database },
    { key: "kv", label: "KV Cache", icon: HardDrives },
    { key: "queues", label: "Queues", icon: Queue },
  ];

  const quickLinks: { href: string; labelKey: string; descKey: string; icon: Icon; color: string }[] = [
    { href: "scenarios", labelKey: "scenarios", descKey: "scenariosDesc", icon: TreeStructure, color: "text-steel-500" },
    { href: "triggers", labelKey: "triggers", descKey: "triggersDesc", icon: Lightning, color: "text-powder-500" },
    { href: "users", labelKey: "users", descKey: "usersDesc", icon: Users, color: "text-steel-500" },
    { href: "automations", labelKey: "automations", descKey: "automationsDesc", icon: ArrowsClockwise, color: "text-powder-500" },
    { href: "analytics", labelKey: "analytics", descKey: "analyticsDesc", icon: ChartBar, color: "text-steel-500" },
    { href: "settings", labelKey: "settings", descKey: "settingsDesc", icon: Gear, color: "text-powder-500" },
  ];

  const navT = useTranslations("nav");

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-cobalt-700">{t("title")}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t("welcome")}</p>
      </div>

      {/* System status */}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-widest text-steel-500 mb-3">
          {t("systemStatus")}
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {checks.map((c) => {
            const Icon = c.icon;
            const ok = health?.checks[c.key] === "ok";
            return (
              <div
                key={c.key}
                className="bg-white border border-gray-200 rounded-xl p-4 flex items-center gap-3"
              >
                <div className="w-9 h-9 rounded-lg bg-steel-50 flex items-center justify-center flex-shrink-0">
                  <Icon size={20} weight="duotone" className="text-steel-500" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground leading-none">{c.label}</p>
                  <div className="flex items-center gap-1.5 mt-1">
                    <StatusDot ok={ok} />
                    <p className={`text-sm font-medium leading-none ${ok ? "text-cobalt-700" : "text-gray-400"}`}>
                      {ok ? t("active") : t("checking")}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <AnalyticsOverview accountId={accountId} locale={locale} />

      {/* Quick links */}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-widest text-steel-500 mb-3">
          {t("quickLinks")}
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {quickLinks.map((link) => {
            const Icon = link.icon;
            return (
              <Link
                key={link.href}
                href={`/${locale}/${link.href}`}
                className="bg-white border border-gray-200 rounded-xl p-4 flex items-start gap-3 hover:border-steel-300 transition-colors group"
              >
                <div className={`w-9 h-9 rounded-lg ${link.color === "text-steel-500" ? "bg-steel-50" : "bg-powder-50"} flex items-center justify-center flex-shrink-0`}>
                  <Icon size={20} weight="duotone" className={link.color} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <p className="font-medium text-sm text-cobalt-700 group-hover:text-steel-600 transition-colors">
                      {navT(link.labelKey)}
                    </p>
                    <ArrowRight size={14} className="text-gray-300 group-hover:text-steel-400 transition-colors" />
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{t(link.descKey)}</p>
                </div>
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
}
