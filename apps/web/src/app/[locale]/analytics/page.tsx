"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { DeliveryMetrics } from "../../../components/analytics/delivery-metrics";
import { AccountHealth } from "../../../components/analytics/account-health";

export default function AnalyticsPage() {
  const t = useTranslations("analytics");
  const [accountId, setAccountId] = useState("");
  const pathname = usePathname();
  const locale = pathname.split("/")[1] ?? "ja";

  useEffect(() => {
    if (typeof window === "undefined") return;
    setAccountId(localStorage.getItem("gramstep_account_id") ?? "");
  }, []);

  return (
    <main className="mx-auto max-w-6xl p-6 space-y-8">
      <h1 className="text-2xl font-bold text-cobalt-700">{t("title")}</h1>
      <AccountHealth accountId={accountId} />
      <DeliveryMetrics accountId={accountId} locale={locale} />
    </main>
  );
}
