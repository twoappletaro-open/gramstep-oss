"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Badge } from "../ui/badge";
import { createApiClient, getApiUrl } from "../../lib/api-client";
import type { AccountHealthResponse } from "../../lib/api-client";

function healthVariant(score: string): "default" | "warning" | "destructive" {
  switch (score) {
    case "normal":
      return "default";
    case "warning":
      return "warning";
    case "danger":
      return "destructive";
    default:
      return "default";
  }
}

export function AccountHealth({ accountId }: { accountId: string }) {
  const t = useTranslations("analytics");
  const tCommon = useTranslations("common");
  const [health, setHealth] = useState<AccountHealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const apiUrl =
    typeof window !== "undefined"
      ? (getApiUrl())
      : "";
  const client = createApiClient(apiUrl);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await client.analytics.health(accountId);
    if (result.ok) {
      setHealth(result.value);
    } else {
      setError(result.error.message);
    }
    setLoading(false);
  }, [accountId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return <p className="text-center py-8 text-muted-foreground">{tCommon("loading")}</p>;
  }

  if (error || !health) {
    return <p className="text-center py-8 text-terra-500">{error ?? tCommon("error")}</p>;
  }

  const healthLabel =
    health.health_score === "normal"
      ? t("healthNormal")
      : health.health_score === "warning"
        ? t("healthWarning")
        : t("healthDanger");

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold text-cobalt-700">{t("accountHealth")}</h2>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {/* Connection status */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">{t("connectionStatus")}</CardTitle>
          </CardHeader>
          <CardContent>
            <Badge variant={health.connected ? "default" : "destructive"}>
              {health.connected ? t("connected") : t("disconnected")}
            </Badge>
            {health.ig_username && (
              <p className="mt-1 text-sm text-muted-foreground">@{health.ig_username}</p>
            )}
          </CardContent>
        </Card>

        {/* Token expiry */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">{t("tokenExpiry")}</CardTitle>
          </CardHeader>
          <CardContent>
            {health.token_days_remaining > 0 ? (
              <div className="text-2xl font-bold text-cobalt-700">
                {t("daysRemaining", { days: health.token_days_remaining })}
              </div>
            ) : (
              <Badge variant="destructive">{t("expired")}</Badge>
            )}
          </CardContent>
        </Card>

        {/* Rate limit usage */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">{t("rateLimitUsage")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-cobalt-700">
              {health.rate_limit_usage.usage_percent.toFixed(0)}%
            </div>
            <p className="text-xs text-muted-foreground">
              {health.rate_limit_usage.daily_sent.toLocaleString()} / {health.rate_limit_usage.daily_limit.toLocaleString()}
            </p>
            <div className="mt-2 h-2 rounded-full bg-cream-100 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  health.rate_limit_usage.usage_percent > 80
                    ? "bg-terra-500"
                    : health.rate_limit_usage.usage_percent > 50
                      ? "bg-warning-400"
                      : "bg-steel-500"
                }`}
                style={{ width: `${Math.min(health.rate_limit_usage.usage_percent, 100)}%` }}
              />
            </div>
          </CardContent>
        </Card>

        {/* Health score */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">{t("healthScore")}</CardTitle>
          </CardHeader>
          <CardContent>
            <Badge variant={healthVariant(health.health_score)}>
              {healthLabel}
            </Badge>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
