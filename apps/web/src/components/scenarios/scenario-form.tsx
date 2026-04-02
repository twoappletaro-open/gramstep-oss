"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select } from "../ui/select";
import { Switch } from "../ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { StepFlowEditor, type StepFormData } from "./step-flow-editor";
import { Tooltip } from "../ui/tooltip";
import type { TriggerType, CreateScenarioInput, UpdateScenarioInput } from "@gramstep/shared";

const TRIGGER_TYPES: { value: TriggerType; label: string }[] = [
  { value: "comment", label: "コメント" },
  { value: "story_comment", label: "ストーリーコメント" },
  { value: "story_mention", label: "ストーリーメンション" },
  { value: "live_comment", label: "ライブコメント" },
  { value: "dm", label: "DM" },
  { value: "url_param", label: "URLパラメータ" },
  { value: "ice_breaker", label: "Ice Breaker" },
];

type ScenarioFormProps = {
  initialData?: {
    id: string;
    name: string;
    trigger_type: TriggerType;
    trigger_config: string;
    is_active: boolean;
    bot_disclosure_enabled: boolean;
    version: number;
    steps: StepFormData[];
  };
  onSubmit: (data: CreateScenarioInput | UpdateScenarioInput) => Promise<void>;
  loading: boolean;
};

export function ScenarioForm({ initialData, onSubmit, loading }: ScenarioFormProps) {
  const t = useTranslations("scenarios");
  const tCommon = useTranslations("common");

  const [name, setName] = useState(initialData?.name ?? "");
  const [triggerType, setTriggerType] = useState<TriggerType>(initialData?.trigger_type ?? "dm");
  const [triggerConfig, setTriggerConfig] = useState(initialData?.trigger_config ?? "{}");
  const [botDisclosure, setBotDisclosure] = useState(initialData?.bot_disclosure_enabled ?? false);
  const [isActive, setIsActive] = useState(initialData?.is_active ?? true);
  const [steps, setSteps] = useState<StepFormData[]>(
    initialData?.steps ?? [
      { step_order: 1, delay_seconds: 0, message_type: "text", message_payload: "", condition_config: null },
    ],
  );
  const [errors, setErrors] = useState<Record<string, string>>({});

  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = t("nameRequired");
    if (steps.length === 0) errs.steps = t("stepsRequired");
    for (const step of steps) {
      if (!step.message_payload.trim()) {
        errs[`step_${step.step_order}`] = t("messageRequired");
      }
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    const stepsInput = steps.map((s) => ({
      step_order: s.step_order,
      delay_seconds: s.delay_seconds,
      absolute_datetime: null,
      message_type: s.message_type as "text" | "image" | "generic" | "quick_reply",
      message_payload: s.message_payload,
      condition_config: s.condition_config,
    }));

    if (initialData) {
      await onSubmit({
        name,
        trigger_type: triggerType,
        trigger_config: triggerConfig,
        is_active: isActive,
        bot_disclosure_enabled: botDisclosure,
        steps: stepsInput,
        version: initialData.version,
      } satisfies UpdateScenarioInput);
    } else {
      await onSubmit({
        name,
        trigger_type: triggerType,
        trigger_config: triggerConfig,
        bot_disclosure_enabled: botDisclosure,
        steps: stepsInput,
      } satisfies CreateScenarioInput);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("basicSettings")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="scenario-name">{t("name")}</Label>
            <Input
              id="scenario-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={255}
            />
            {errors.name && <p className="text-sm text-destructive">{errors.name}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="trigger-type">{t("triggerType")}</Label>
            <Select
              id="trigger-type"
              value={triggerType}
              onChange={(e) => setTriggerType(e.target.value as TriggerType)}
            >
              {TRIGGER_TYPES.map((tt) => (
                <option key={tt.value} value={tt.value}>
                  {tt.label}
                </option>
              ))}
            </Select>
          </div>

          <div className="flex items-center space-x-3">
            <Switch
              id="bot-disclosure"
              checked={botDisclosure}
              onCheckedChange={setBotDisclosure}
            />
            <Label htmlFor="bot-disclosure" className="flex items-center gap-1">
              {t("botDisclosure")}
              <Tooltip content="カリフォルニア州法等で義務付けられたボット開示。有効にすると、シナリオ開始時に「このメッセージは自動送信です」と通知します" />
            </Label>
          </div>

          {initialData && (
            <div className="flex items-center space-x-3">
              <Switch
                id="is-active"
                checked={isActive}
                onCheckedChange={setIsActive}
              />
              <Label htmlFor="is-active">{t("active")}</Label>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("stepsTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <StepFlowEditor steps={steps} onChange={setSteps} errors={errors} />
          {errors.steps && <p className="mt-2 text-sm text-destructive">{errors.steps}</p>}
        </CardContent>
      </Card>

      <div className="flex justify-end space-x-2">
        <a href="../scenarios">
          <Button type="button" variant="outline">{tCommon("cancel")}</Button>
        </a>
        <Button type="submit" disabled={loading}>
          {loading ? tCommon("loading") : tCommon("save")}
        </Button>
      </div>
    </form>
  );
}
