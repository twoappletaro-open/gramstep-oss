"use client";

import { useTranslations } from "next-intl";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select } from "../ui/select";
import { Card, CardContent } from "../ui/card";
import type { AutomationCondition } from "@gramstep/shared";

const CONDITION_FIELDS = [
  { value: "tag", label: "タグ" },
  { value: "score", label: "スコア" },
  { value: "metadata", label: "メタデータ" },
] as const;

const CONDITION_OPERATORS = [
  { value: "has", label: "持っている" },
  { value: "not_has", label: "持っていない" },
  { value: "eq", label: "等しい" },
  { value: "neq", label: "等しくない" },
  { value: "gt", label: "より大きい" },
  { value: "gte", label: "以上" },
  { value: "lt", label: "未満" },
  { value: "lte", label: "以下" },
] as const;

type ConditionEditorProps = {
  conditions: AutomationCondition[];
  onChange: (conditions: AutomationCondition[]) => void;
};

export function ConditionEditor({ conditions, onChange }: ConditionEditorProps) {
  const t = useTranslations("automations");

  function updateCondition(index: number, patch: Partial<AutomationCondition>) {
    const updated = conditions.map((c, i) =>
      i === index ? { ...c, ...patch } : c,
    );
    onChange(updated);
  }

  function addCondition() {
    onChange([
      ...conditions,
      { field: "tag", operator: "has", value: "" },
    ]);
  }

  function removeCondition(index: number) {
    onChange(conditions.filter((_, i) => i !== index));
  }

  return (
    <div className="space-y-3">
      {conditions.map((cond, index) => (
        <Card key={index} className="border-l-4 border-l-blue-400">
          <CardContent className="space-y-3 p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-muted-foreground">
                {t("conditionNumber", { number: index + 1 })}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-destructive"
                onClick={() => removeCondition(index)}
                disabled={conditions.length <= 1}
              >
                ×
              </Button>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label>{t("conditionField")}</Label>
                <Select
                  value={cond.field}
                  onChange={(e) =>
                    updateCondition(index, {
                      field: e.target.value as AutomationCondition["field"],
                    })
                  }
                >
                  {CONDITION_FIELDS.map((f) => (
                    <option key={f.value} value={f.value}>{f.label}</option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1">
                <Label>{t("conditionOperator")}</Label>
                <Select
                  value={cond.operator}
                  onChange={(e) =>
                    updateCondition(index, {
                      operator: e.target.value as AutomationCondition["operator"],
                    })
                  }
                >
                  {CONDITION_OPERATORS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1">
                <Label>{t("conditionValue")}</Label>
                <Input
                  value={String(cond.value)}
                  onChange={(e) => {
                    const v = cond.field === "score" ? Number(e.target.value) : e.target.value;
                    updateCondition(index, { value: v });
                  }}
                  type={cond.field === "score" ? "number" : "text"}
                />
              </div>
            </div>

            {cond.field === "metadata" && (
              <div className="space-y-1">
                <Label>{t("metadataKey")}</Label>
                <Input
                  value={cond.key ?? ""}
                  onChange={(e) => updateCondition(index, { key: e.target.value })}
                />
              </div>
            )}
          </CardContent>
        </Card>
      ))}

      <div className="flex justify-center">
        <Button type="button" variant="outline" onClick={addCondition}>
          + {t("addCondition")}
        </Button>
      </div>
    </div>
  );
}
