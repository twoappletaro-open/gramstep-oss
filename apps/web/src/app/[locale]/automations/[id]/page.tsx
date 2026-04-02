"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { AutomationForm } from "../../../../components/automations/automation-form";
import { createApiClient, getApiUrl } from "../../../../lib/api-client";
import type {
  UpdateAutomationRuleInput,
  AutomationCondition,
  TriggerAction,
} from "@gramstep/shared";

type AutomationDetail = {
  id: string;
  name: string;
  condition_group: {
    logic: "and" | "or";
    conditions: AutomationCondition[];
  };
  actions: TriggerAction[];
  is_active: boolean;
  version: number;
};

export default function EditAutomationPage() {
  const t = useTranslations("automations");
  const tCommon = useTranslations("common");
  const params = useParams();
  const id = params.id as string;

  const [rule, setRule] = useState<AutomationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apiUrl = typeof window !== "undefined"
    ? (getApiUrl())
    : "";

  useEffect(() => {
    async function load() {
      const client = createApiClient(apiUrl);
      const result = await client.automations.get(id);
      if (result.ok) {
        setRule(result.value as AutomationDetail);
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
    const result = await client.automations.update(id, data as UpdateAutomationRuleInput);
    if (result.ok) {
      window.location.href = "../../automations";
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

  if (!rule) {
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
      <AutomationForm
        initialData={rule}
        onSubmit={handleSubmit}
        loading={saving}
      />
    </main>
  );
}
