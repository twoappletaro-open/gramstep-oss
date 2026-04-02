"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "../../../components/ui/card";
import { getApiUrl } from "../../../lib/api-client";

export default function LoginPage() {
  const t = useTranslations("auth");
  const tCommon = useTranslations("common");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [apiUrl, setApiUrl] = useState(() => getApiUrl());
  const needsManualUrl = !process.env.NEXT_PUBLIC_API_URL && !apiUrl;
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (apiUrl) {
        localStorage.setItem("gramstep_api_url", apiUrl);
        sessionStorage.setItem("apiUrl", apiUrl);
      }
      const res = await fetch(`${apiUrl}/api/admin/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (!res.ok) {
        setError(t("loginError"));
        return;
      }

      const data = (await res.json()) as {
        accessToken: string;
        refreshToken?: string;
        operator: { id: string; email: string; role: string; accountId?: string };
        totpRequired?: boolean;
      };

      if (data.totpRequired) {
        setError("2要素認証(TOTP)が必要です。現在未対応のため、管理者に連絡してください。");
        return;
      }

      sessionStorage.setItem("accessToken", data.accessToken);
      if (data.refreshToken) {
        sessionStorage.setItem("refreshToken", data.refreshToken);
      }
      if (data.operator.accountId) {
        localStorage.setItem("gramstep_account_id", data.operator.accountId);
      }

      window.location.href = "./";
    } catch {
      setError(t("loginError"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-cream-100 p-4">
      <Card className="w-full max-w-sm border border-gray-200">
        <CardHeader>
          <div className="flex items-center gap-2.5 mb-2">
            <div className="w-8 h-8 rounded-lg bg-cobalt-700 text-white flex items-center justify-center text-sm font-bold">
              G
            </div>
            <span className="text-lg font-semibold text-cobalt-700">GramStep</span>
          </div>
          <CardTitle className="text-xl text-cobalt-700">{tCommon("appName")}</CardTitle>
          <CardDescription>{t("login")}</CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4">
            {error && (
              <div className="rounded-md bg-terra-50 border border-terra-200 p-3 text-sm text-terra-600">
                {error}
              </div>
            )}
            {needsManualUrl && (
              <div className="space-y-2">
                <Label htmlFor="apiUrl">Worker API URL</Label>
                <Input
                  id="apiUrl"
                  type="url"
                  value={apiUrl}
                  onChange={(e) => setApiUrl(e.target.value)}
                  placeholder="https://gramstep-worker.xxxxx.workers.dev"
                  required
                />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="email">{t("email")}</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">{t("password")}</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                autoComplete="current-password"
              />
              <p className="text-xs text-muted-foreground">
                {t("passwordRequirements")}
              </p>
            </div>
          </CardContent>
          <CardFooter>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? tCommon("loading") : t("loginButton")}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </main>
  );
}
