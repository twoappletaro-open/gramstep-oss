"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select } from "../ui/select";
import { Switch } from "../ui/switch";
import { Badge } from "../ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { ActionEditor, type ActionFormData } from "./action-editor";
import type {
  TriggerType,
  MatchType,
  FireMode,
  CreateTriggerInput,
  UpdateTriggerInput,
  ScheduleConfig,
} from "@gramstep/shared";

const TRIGGER_TYPES: { value: TriggerType; label: string }[] = [
  { value: "comment", label: "コメント" },
  { value: "story_comment", label: "ストーリーコメント" },
  { value: "story_mention", label: "ストーリーメンション" },
  { value: "live_comment", label: "ライブコメント" },
  { value: "dm", label: "DM" },
  { value: "url_param", label: "URLパラメータ" },
  { value: "ice_breaker", label: "Ice Breaker" },
];

const MATCH_TYPES: { value: MatchType; label: string }[] = [
  { value: "exact", label: "完全一致" },
  { value: "partial", label: "部分一致" },
  { value: "regex", label: "正規表現" },
];

const FIRE_MODES: { value: FireMode; label: string }[] = [
  { value: "unlimited", label: "無制限" },
  { value: "once", label: "1回のみ" },
  { value: "first_only", label: "初回のみ" },
];

type TriggerFormProps = {
  initialData?: {
    id: string;
    name: string;
    trigger_type: TriggerType;
    match_type: MatchType;
    keywords: string[];
    actions: ActionFormData[];
    schedule_config: ScheduleConfig | null;
    fire_mode: FireMode;
    is_active: boolean;
    version: number;
  };
  onSubmit: (data: CreateTriggerInput | UpdateTriggerInput) => Promise<void>;
  loading: boolean;
};

export function TriggerForm({ initialData, onSubmit, loading }: TriggerFormProps) {
  const t = useTranslations("triggers");
  const tCommon = useTranslations("common");

  const [name, setName] = useState(initialData?.name ?? "");
  const [triggerType, setTriggerType] = useState<TriggerType>(initialData?.trigger_type ?? "comment");
  const [matchType, setMatchType] = useState<MatchType>(initialData?.match_type ?? "partial");
  const [fireMode, setFireMode] = useState<FireMode>(initialData?.fire_mode ?? "unlimited");
  const [keywordInput, setKeywordInput] = useState("");
  const [keywords, setKeywords] = useState<string[]>(initialData?.keywords ?? []);
  const [actions, setActions] = useState<ActionFormData[]>(
    initialData?.actions ?? [{ type: "send_template", templateId: "" }],
  );
  const [isActive, setIsActive] = useState(initialData?.is_active ?? true);
  const [errors, setErrors] = useState<Record<string, string>>({});

  function addKeyword() {
    const kw = keywordInput.trim();
    if (kw && !keywords.includes(kw)) {
      setKeywords([...keywords, kw]);
    }
    setKeywordInput("");
  }

  function removeKeyword(kw: string) {
    setKeywords(keywords.filter((k) => k !== kw));
  }

  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = t("nameRequired");
    if (actions.length === 0) errs.actions = t("actionsRequired");
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    if (initialData) {
      await onSubmit({
        name,
        trigger_type: triggerType,
        match_type: matchType,
        keywords,
        actions,
        fire_mode: fireMode,
        is_active: isActive,
        schedule_config: null,
        version: initialData.version,
      } satisfies UpdateTriggerInput);
    } else {
      await onSubmit({
        name,
        trigger_type: triggerType,
        match_type: matchType,
        keywords,
        actions,
        fire_mode: fireMode,
        is_active: isActive,
        schedule_config: null,
      } satisfies CreateTriggerInput);
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
            <Label htmlFor="trigger-name">{t("name")}</Label>
            <Input
              id="trigger-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={255}
            />
            {errors.name && <p className="text-sm text-destructive">{errors.name}</p>}
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>{t("triggerType")}</Label>
              <Select
                value={triggerType}
                onChange={(e) => setTriggerType(e.target.value as TriggerType)}
              >
                {TRIGGER_TYPES.map((tt) => (
                  <option key={tt.value} value={tt.value}>{tt.label}</option>
                ))}
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t("matchType")}</Label>
              <Select
                value={matchType}
                onChange={(e) => setMatchType(e.target.value as MatchType)}
              >
                {MATCH_TYPES.map((mt) => (
                  <option key={mt.value} value={mt.value}>{mt.label}</option>
                ))}
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t("fireMode")}</Label>
              <Select
                value={fireMode}
                onChange={(e) => setFireMode(e.target.value as FireMode)}
              >
                {FIRE_MODES.map((fm) => (
                  <option key={fm.value} value={fm.value}>{fm.label}</option>
                ))}
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>{t("keywords")}</Label>
            <div className="flex space-x-2">
              <Input
                value={keywordInput}
                onChange={(e) => setKeywordInput(e.target.value)}
                placeholder={t("keywordPlaceholder")}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addKeyword();
                  }
                }}
              />
              <Button type="button" variant="outline" onClick={addKeyword}>
                {t("addKeyword")}
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {keywords.map((kw) => (
                <Badge key={kw} variant="secondary" className="cursor-pointer" onClick={() => removeKeyword(kw)}>
                  {kw} ×
                </Badge>
              ))}
            </div>
          </div>

          {initialData && (
            <div className="flex items-center space-x-3">
              <Switch id="trigger-active" checked={isActive} onCheckedChange={setIsActive} />
              <Label htmlFor="trigger-active">{t("active")}</Label>
            </div>
          )}
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
        <a href="../triggers">
          <Button type="button" variant="outline">{tCommon("cancel")}</Button>
        </a>
        <Button type="submit" disabled={loading}>
          {loading ? tCommon("loading") : tCommon("save")}
        </Button>
      </div>
    </form>
  );
}
