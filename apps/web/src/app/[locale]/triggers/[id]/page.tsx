"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { TriggerForm } from "../../../../components/triggers/trigger-form";
import { createApiClient, getApiUrl } from "../../../../lib/api-client";
import type {
  UpdateTriggerInput,
  TriggerType,
  MatchType,
  FireMode,
  ScheduleConfig,
  TriggerAction,
} from "@gramstep/shared";

type TriggerDetail = {
  id: string;
  name: string;
  trigger_type: TriggerType;
  match_type: MatchType;
  keywords: string[];
  actions: TriggerAction[];
  schedule_config: ScheduleConfig | null;
  fire_mode: FireMode;
  is_active: boolean;
  version: number;
};

export default function EditTriggerPage() {
  const t = useTranslations("triggers");
  const tCommon = useTranslations("common");
  const params = useParams();
  const id = params.id as string;

  const [trigger, setTrigger] = useState<TriggerDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apiUrl = typeof window !== "undefined"
    ? (getApiUrl())
    : "";

  useEffect(() => {
    async function load() {
      const client = createApiClient(apiUrl);
      const result = await client.triggers.get(id);
      if (result.ok) {
        setTrigger(result.value as TriggerDetail);
      } else {
        setError(result.error.message);
      }
      setLoading(false);
    }
    void load();
  }, [id, apiUrl]);

  async function handleSubmit(data: unknown) {
    setSaving(true);
    setError(null);
    const client = createApiClient(apiUrl);
    const result = await client.triggers.update(id, data as UpdateTriggerInput);
    if (result.ok) {
      window.location.href = "../../triggers";
    } else {
      if (result.error.status === 409) {
        setError(t("versionConflict"));
      } else {
        setError(result.error.message);
      }
    }
    setSaving(false);
  }

  if (loading) {
    return (
      <main className="mx-auto max-w-4xl p-6">
        <p className="text-muted-foreground">{tCommon("loading")}</p>
      </main>
    );
  }

  if (!trigger) {
    return (
      <main className="mx-auto max-w-4xl p-6">
        <p className="text-destructive">{error ?? t("notFound")}</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl p-6">
      <h1 className="mb-6 text-2xl font-bold text-cobalt-700">{t("editTitle")}</h1>
      {error && (
        <div className="mb-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}
      <TriggerForm
        initialData={trigger}
        onSubmit={handleSubmit}
        loading={saving}
      />
    </main>
  );
}
