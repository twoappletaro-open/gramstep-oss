"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select } from "../ui/select";
import { Switch } from "../ui/switch";
import { createApiClient, getApiUrl } from "../../lib/api-client";
import type {
  CreateSurveyInput,
  CreateSurveyStepInput,
  SurveyAnswerMode,
  SurveyFieldType,
  UpdateSurveyInput,
} from "@gramstep/shared";

type SurveyStepForm = CreateSurveyStepInput;

type PackageOption = { id: string; name: string };
type FieldOption = { value: string; label: string; source: "default" | "custom" };

type SurveyFormProps = {
  initialData?: {
    id: string;
    name: string;
    is_active: boolean;
    completion_template_id: string | null;
    steps: SurveyStepForm[];
  };
  onSubmit: (data: CreateSurveyInput | UpdateSurveyInput) => Promise<void>;
  loading: boolean;
};

function makeStep(stepOrder: number): SurveyStepForm {
  return {
    step_order: stepOrder,
    field_type: "free_input",
    field_key: null,
    answer_mode: "free_text",
    question_text: "",
    options: [],
  };
}

export function SurveyForm({ initialData, onSubmit, loading }: SurveyFormProps) {
  const pathname = usePathname();
  const locale = pathname.split("/")[1] ?? "ja";
  const accountId = typeof window !== "undefined" ? localStorage.getItem("gramstep_account_id") ?? "" : "";
  const apiUrl = typeof window !== "undefined" ? getApiUrl() : "";
  const client = createApiClient(apiUrl);

  const [name, setName] = useState(initialData?.name ?? "");
  const [isActive, setIsActive] = useState(initialData?.is_active ?? true);
  const [completionTemplateId, setCompletionTemplateId] = useState(initialData?.completion_template_id ?? "");
  const [steps, setSteps] = useState<SurveyStepForm[]>(
    initialData?.steps?.length ? initialData.steps : [makeStep(1)],
  );
  const [packages, setPackages] = useState<PackageOption[]>([]);
  const [fieldOptions, setFieldOptions] = useState<FieldOption[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!accountId || !apiUrl) return;
    client.packages.list(accountId).then((result) => {
      if (result.ok) {
        setPackages((result.value as Array<Record<string, unknown>>).map((pkg) => ({
          id: String(pkg.id ?? ""),
          name: String(pkg.name ?? ""),
        })));
      }
    }).catch(() => {});
    client.surveys.fieldOptions(accountId).then((result) => {
      if (result.ok) {
        setFieldOptions(result.value);
      }
    }).catch(() => {});
  }, [accountId, apiUrl]);

  function updateStep(index: number, patch: Partial<SurveyStepForm>) {
    setSteps((prev) => prev.map((step, currentIndex) => (
      currentIndex === index ? { ...step, ...patch } : step
    )).map((step, idx) => ({ ...step, step_order: idx + 1 })));
  }

  function addStep() {
    setSteps((prev) => [...prev, makeStep(prev.length + 1)]);
  }

  function removeStep(index: number) {
    setSteps((prev) => prev.filter((_, currentIndex) => currentIndex !== index).map((step, idx) => ({
      ...step,
      step_order: idx + 1,
    })));
  }

  function addOption(stepIndex: number) {
    updateStep(stepIndex, {
      options: [...steps[stepIndex]!.options, { label: "", value: "" }],
    });
  }

  function updateOption(stepIndex: number, optionIndex: number, patch: { label?: string; value?: string }) {
    const step = steps[stepIndex];
    if (!step) return;
    const nextOptions = step.options.map((option, currentIndex) => (
      currentIndex === optionIndex ? { ...option, ...patch } : option
    ));
    updateStep(stepIndex, { options: nextOptions });
  }

  function removeOption(stepIndex: number, optionIndex: number) {
    const step = steps[stepIndex];
    if (!step) return;
    updateStep(stepIndex, {
      options: step.options.filter((_, currentIndex) => currentIndex !== optionIndex),
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError("アンケート名を入力してください");
      return;
    }
    if (steps.length === 0) {
      setError("質問を1件以上追加してください");
      return;
    }
    if (steps.some((step) => !step.question_text.trim())) {
      setError("すべての質問文を入力してください");
      return;
    }
    if (steps.some((step) => step.answer_mode === "choice" && step.options.length === 0)) {
      setError("選択肢型の質問には少なくとも1つの選択肢が必要です");
      return;
    }

    const normalizedSteps = steps.map((step) => ({
      ...step,
      field_key: step.field_type === "free_input" ? null : step.field_key,
      options: step.answer_mode === "choice"
        ? step.options.filter((option) => option.label.trim() && option.value.trim())
        : [],
    }));

    if (initialData) {
      await onSubmit({
        name,
        is_active: isActive,
        completion_template_id: completionTemplateId || null,
        steps: normalizedSteps,
      } satisfies UpdateSurveyInput);
      return;
    }

    await onSubmit({
      name,
      is_active: isActive,
      completion_template_id: completionTemplateId || null,
      steps: normalizedSteps,
    } satisfies CreateSurveyInput);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>基本設定</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="survey-name">アンケート名</Label>
            <Input id="survey-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={255} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="completion-template">終了時に送るパッケージ</Label>
            <Select
              id="completion-template"
              value={completionTemplateId}
              onChange={(e) => setCompletionTemplateId(e.target.value)}
            >
              <option value="">送信しない</option>
              {packages.map((pkg) => (
                <option key={pkg.id} value={pkg.id}>{pkg.name}</option>
              ))}
            </Select>
          </div>

          <div className="flex items-center gap-3">
            <Switch id="survey-active" checked={isActive} onCheckedChange={setIsActive} />
            <Label htmlFor="survey-active">有効にする</Label>
          </div>
        </CardContent>
      </Card>

      {steps.map((step, index) => {
        const defaultFieldOptions = fieldOptions.filter((option) => option.source === "default");
        const customFieldOptions = fieldOptions.filter((option) => option.source === "custom");

        return (
          <Card key={index}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>質問 {index + 1}</CardTitle>
                <Button type="button" variant="ghost" className="text-destructive" onClick={() => removeStep(index)} disabled={steps.length <= 1}>
                  削除
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>種類</Label>
                  <Select
                    value={step.field_type}
                    onChange={(e) => updateStep(index, {
                      field_type: e.target.value as SurveyFieldType,
                      field_key: null,
                    })}
                  >
                    <option value="default_attribute">デフォルト属性</option>
                    <option value="custom_attribute">カスタム属性</option>
                    <option value="free_input">フリー入力</option>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>回答方式</Label>
                  <Select
                    value={step.answer_mode}
                    onChange={(e) => updateStep(index, {
                      answer_mode: e.target.value as SurveyAnswerMode,
                      options: e.target.value === "choice" ? step.options : [],
                    })}
                  >
                    <option value="free_text">自由記述型</option>
                    <option value="choice">選択肢型</option>
                  </Select>
                </div>
              </div>

              {step.field_type === "default_attribute" && (
                <div className="space-y-2">
                  <Label>保存先</Label>
                  <Select value={step.field_key ?? ""} onChange={(e) => updateStep(index, { field_key: e.target.value })}>
                    <option value="">選択してください</option>
                    {defaultFieldOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </Select>
                </div>
              )}

              {step.field_type === "custom_attribute" && (
                <div className="space-y-2">
                  <Label>カスタム属性キー</Label>
                  {customFieldOptions.length > 0 ? (
                    <Select value={step.field_key ?? ""} onChange={(e) => updateStep(index, { field_key: e.target.value })}>
                      <option value="">選択してください</option>
                      {customFieldOptions.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </Select>
                  ) : (
                    <Input
                      value={step.field_key ?? ""}
                      onChange={(e) => updateStep(index, { field_key: e.target.value })}
                      placeholder="metadata_key"
                    />
                  )}
                </div>
              )}

              <div className="space-y-2">
                <Label>質問文</Label>
                <Input
                  value={step.question_text}
                  onChange={(e) => updateStep(index, { question_text: e.target.value })}
                  placeholder="例: メールアドレスを教えてください"
                />
              </div>

              {step.answer_mode === "choice" && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label>選択肢</Label>
                    <Button type="button" variant="outline" onClick={() => addOption(index)} disabled={step.options.length >= 10}>
                      選択肢を追加
                    </Button>
                  </div>
                  <div className="space-y-2">
                    {step.options.map((option, optionIndex) => (
                      <div key={optionIndex} className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
                        <Input
                          value={option.label}
                          onChange={(e) => updateOption(index, optionIndex, { label: e.target.value })}
                          placeholder="表示ラベル"
                        />
                        <Input
                          value={option.value}
                          onChange={(e) => updateOption(index, optionIndex, { value: e.target.value })}
                          placeholder="送信値"
                        />
                        <Button type="button" variant="ghost" className="text-destructive" onClick={() => removeOption(index, optionIndex)}>
                          削除
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="rounded-md border border-dashed p-3 text-sm text-gray-600">
                <p className="font-medium mb-1">プレビュー</p>
                <p>{step.question_text || "質問文を入力するとここに表示されます"}</p>
                {step.answer_mode === "choice" && step.options.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {step.options.map((option, optionIndex) => (
                      <span key={optionIndex} className="rounded-full border px-3 py-1 text-xs">
                        {option.label || "選択肢"}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}

      {error && <div className="rounded-md bg-red-50 p-3 text-sm text-red-600">{error}</div>}

      <div className="flex items-center justify-between">
        <Button type="button" variant="outline" onClick={addStep}>
          質問を追加
        </Button>
        <div className="flex gap-2">
          <Link href={`/${locale}/surveys`}>
            <Button type="button" variant="outline">キャンセル</Button>
          </Link>
          <Button type="submit" disabled={loading}>
            {loading ? "保存中..." : "保存"}
          </Button>
        </div>
      </div>
    </form>
  );
}
