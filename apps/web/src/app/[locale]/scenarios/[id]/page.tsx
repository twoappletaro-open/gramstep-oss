"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { ScenarioForm } from "../../../../components/scenarios/scenario-form";
import { createApiClient, getApiUrl } from "../../../../lib/api-client";
import type { UpdateScenarioInput, TriggerType, ConditionConfig } from "@gramstep/shared";

type ScenarioDetail = {
  id: string;
  name: string;
  trigger_type: TriggerType;
  trigger_config: string;
  is_active: boolean;
  bot_disclosure_enabled: boolean;
  version: number;
  steps: {
    step_order: number;
    delay_seconds: number;
    message_type: string;
    message_payload: string;
    condition_config: ConditionConfig | null;
  }[];
};

export default function EditScenarioPage() {
  const t = useTranslations("scenarios");
  const tCommon = useTranslations("common");
  const params = useParams();
  const id = params.id as string;

  const [scenario, setScenario] = useState<ScenarioDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apiUrl = typeof window !== "undefined"
    ? (getApiUrl())
    : "";

  useEffect(() => {
    async function load() {
      const client = createApiClient(apiUrl);
      const result = await client.scenarios.get(id);
      if (result.ok) {
        // APIはcamelCase、フォームはsnake_case — 正規化
        const v = result.value as Record<string, unknown>;
        const steps = ((v.steps ?? []) as Array<Record<string, unknown>>).map((s) => ({
          step_order: (s.stepOrder ?? s.step_order ?? 0) as number,
          delay_seconds: (s.delaySeconds ?? s.delay_seconds ?? 0) as number,
          message_type: (s.messageType ?? s.message_type ?? "text") as string,
          message_payload: (s.messagePayload ?? s.message_payload ?? "") as string,
          condition_config: (s.conditionConfig ?? s.condition_config ?? null) as ConditionConfig | null,
        }));
        setScenario({
          id: v.id as string,
          name: v.name as string,
          trigger_type: (v.triggerType ?? v.trigger_type) as TriggerType,
          trigger_config: (v.triggerConfig ?? v.trigger_config ?? "{}") as string,
          is_active: (v.isActive ?? v.is_active ?? true) as boolean,
          bot_disclosure_enabled: (v.botDisclosureEnabled ?? v.bot_disclosure_enabled ?? false) as boolean,
          version: (v.version ?? 1) as number,
          steps,
        });
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
    const result = await client.scenarios.update(id, data as UpdateScenarioInput);
    if (result.ok) {
      window.location.href = "../../scenarios";
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

  if (!scenario) {
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
      <ScenarioForm
        initialData={scenario}
        onSubmit={handleSubmit}
        loading={saving}
      />
    </main>
  );
}
