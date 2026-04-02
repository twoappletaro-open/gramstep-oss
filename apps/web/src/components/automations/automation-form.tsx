"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select } from "../ui/select";
import { Switch } from "../ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { ConditionEditor } from "./condition-editor";
import { ActionEditor, type ActionFormData } from "../triggers/action-editor";
import type {
  AutomationCondition,
  CreateAutomationRuleInput,
  UpdateAutomationRuleInput,
} from "@gramstep/shared";

type AutomationFormProps = {
  initialData?: {
    id: string;
    name: string;
    condition_group: {
      logic: "and" | "or";
      conditions: AutomationCondition[];
    };
    actions: ActionFormData[];
    is_active: boolean;
    version: number;
  };
  onSubmit: (data: CreateAutomationRuleInput | UpdateAutomationRuleInput) => Promise<void>;
  loading: boolean;
};

export function AutomationForm({ initialData, onSubmit, loading }: AutomationFormProps) {
  const t = useTranslations("automations");
  const tCommon = useTranslations("common");

  const [name, setName] = useState(initialData?.name ?? "");
  const [logic, setLogic] = useState<"and" | "or">(initialData?.condition_group.logic ?? "and");
  const [conditions, setConditions] = useState<AutomationCondition[]>(
    initialData?.condition_group.conditions ?? [
      { field: "tag", operator: "has", value: "" },
    ],
  );
  const [actions, setActions] = useState<ActionFormData[]>(
    initialData?.actions ?? [{ type: "send_template", templateId: "" }],
  );
  const [isActive, setIsActive] = useState(initialData?.is_active ?? true);
  const [errors, setErrors] = useState<Record<string, string>>({});

  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = t("nameRequired");
    if (conditions.length === 0) errs.conditions = t("conditionsRequired");
    if (actions.length === 0) errs.actions = t("actionsRequired");
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    const conditionGroup = { logic, conditions };

    if (initialData) {
      await onSubmit({
        name,
        condition_group: conditionGroup,
        actions,
        is_active: isActive,
        version: initialData.version,
      } satisfies UpdateAutomationRuleInput);
    } else {
      await onSubmit({
        name,
        condition_group: conditionGroup,
        actions,
        is_active: isActive,
      } satisfies CreateAutomationRuleInput);
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
            <Label htmlFor="automation-name">{t("name")}</Label>
            <Input
              id="automation-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={255}
            />
            {errors.name && <p className="text-sm text-destructive">{errors.name}</p>}
          </div>

          {initialData && (
            <div className="flex items-center space-x-3">
              <Switch id="automation-active" checked={isActive} onCheckedChange={setIsActive} />
              <Label htmlFor="automation-active">{t("active")}</Label>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("conditionsTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>{t("logicType")}</Label>
            <Select
              value={logic}
              onChange={(e) => setLogic(e.target.value as "and" | "or")}
            >
              <option value="and">{t("logicAnd")}</option>
              <option value="or">{t("logicOr")}</option>
            </Select>
          </div>
          <ConditionEditor conditions={conditions} onChange={setConditions} />
          {errors.conditions && <p className="text-sm text-destructive">{errors.conditions}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("actionsTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <ActionEditor actions={actions} onChange={setActions} />
          {errors.actions && <p className="mt-2 text-sm text-destructive">{errors.actions}</p>}
        </CardContent>
      </Card>

      <div className="flex justify-end space-x-2">
        <a href="../automations">
          <Button type="button" variant="outline">{tCommon("cancel")}</Button>
        </a>
        <Button type="submit" disabled={loading}>
          {loading ? tCommon("loading") : tCommon("save")}
        </Button>
      </div>
    </form>
  );
}
