"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select } from "../ui/select";
import { Card, CardContent } from "../ui/card";
import { Tooltip } from "../ui/tooltip";
import { createApiClient, getApiUrl } from "../../lib/api-client";
import type { TriggerAction } from "@gramstep/shared";

export type ActionFormData = TriggerAction;

const ACTION_TYPES = [
  { value: "enroll_scenario", label: "シナリオ登録", hint: "ユーザーを指定シナリオのステップ配信に自動登録" },
  { value: "start_survey", label: "アンケート開始", hint: "ユーザーにアンケートの最初の質問を送信して回答を開始" },
  { value: "send_template", label: "パッケージ送信", hint: "作成済みパッケージを即時送信" },
  {
    value: "send_template_by_follower_status",
    label: "フォロワー条件パッケージ送信",
    hint: "フォロー状態に応じて送信するパッケージを切り替えます",
  },
  { value: "add_tag", label: "タグ追加", hint: "ユーザーにタグを付与（セグメント分けに利用）" },
  { value: "remove_tag", label: "タグ削除", hint: "ユーザーからタグを削除" },
  { value: "webhook", label: "Webhook通知", hint: "外部サービスにイベントを通知" },
  { value: "update_metadata", label: "メタデータ更新", hint: "ユーザーのカスタムフィールドを更新" },
  { value: "update_score", label: "スコア変更", hint: "ユーザーのスコアを加算/減算" },
  { value: "send_reaction", label: "リアクション送信", hint: "メッセージに絵文字リアクションを送信" },
  { value: "enter_campaign", label: "キャンペーン参加", hint: "ユーザーを指定キャンペーンにエントリー（即時抽選/後日抽選）" },
] as const;

function defaultAction(type: string): ActionFormData {
  switch (type) {
    case "send_template": return { type: "send_template", templateId: "" };
    case "send_template_by_follower_status":
      return {
        type: "send_template_by_follower_status",
        followerTemplateId: "",
        nonFollowerTemplateId: "",
      };
    case "start_survey": return { type: "start_survey", surveyId: "" };
    case "add_tag": return { type: "add_tag", tagId: "" };
    case "remove_tag": return { type: "remove_tag", tagId: "" };
    case "enroll_scenario": return { type: "enroll_scenario", scenarioId: "" };
    case "webhook": return { type: "webhook", url: "" };
    case "update_metadata": return { type: "update_metadata", key: "", value: "" };
    case "update_score": return { type: "update_score", delta: 0 };
    case "send_reaction": return { type: "send_reaction", emoji: "" };
    case "enter_campaign": return { type: "enter_campaign", campaignId: "" };
    default: return { type: "enroll_scenario", scenarioId: "" };
  }
}

type OptionItem = { id: string; name: string };

type ActionEditorProps = {
  actions: ActionFormData[];
  onChange: (actions: ActionFormData[]) => void;
};

export function ActionEditor({ actions, onChange }: ActionEditorProps) {
  const t = useTranslations("triggers");
  const [scenarios, setScenarios] = useState<OptionItem[]>([]);
  const [surveys, setSurveys] = useState<OptionItem[]>([]);
  const [tags, setTags] = useState<OptionItem[]>([]);
  const [campaigns, setCampaigns] = useState<OptionItem[]>([]);
  const [packages, setPackages] = useState<OptionItem[]>([]);

  useEffect(() => {
    const apiUrl = getApiUrl();
    const accountId = typeof window !== "undefined" ? localStorage.getItem("gramstep_account_id") ?? "" : "";
    if (!apiUrl || !accountId) return;
    const client = createApiClient(apiUrl);

    // シナリオ一覧取得
    client.scenarios.list(accountId).then((r) => {
      if (r.ok) {
        const items = (r.value as Array<Record<string, unknown>>).map((s) => ({
          id: (s.id ?? "") as string,
          name: (s.name ?? s.accountId ?? "") as string,
        }));
        setScenarios(items);
      }
    }).catch(() => {});

    client.surveys.list(accountId).then((r) => {
      if (r.ok) {
        const items = (r.value as Array<Record<string, unknown>>).map((survey) => ({
          id: (survey.id ?? "") as string,
          name: (survey.name ?? "") as string,
        }));
        setSurveys(items);
      }
    }).catch(() => {});

    client.packages.list(accountId).then((r) => {
      if (r.ok) {
        const items = (r.value as Array<Record<string, unknown>>).map((pkg) => ({
          id: (pkg.id ?? "") as string,
          name: (pkg.name ?? "") as string,
        }));
        setPackages(items);
      }
    }).catch(() => {});

    // キャンペーン一覧取得（instant_win / deferred_lottery）
    Promise.all([
      client.campaigns.list(accountId, { kind: "instant_win" }),
      client.campaigns.list(accountId, { kind: "deferred_lottery" }),
    ]).then(([r1, r2]) => {
      const items: OptionItem[] = [];
      for (const r of [r1, r2]) {
        if (r.ok) {
          const rows = Array.isArray(r.value)
            ? (r.value as Array<Record<string, unknown>>)
            : (((r.value as Record<string, unknown>).data ?? []) as Array<Record<string, unknown>>);
          for (const c of rows) {
            items.push({ id: (c.id ?? "") as string, name: (c.name ?? "") as string });
          }
        }
      }
      setCampaigns(items);
    }).catch(() => {});

    // タグ一覧は現状APIが無いのでスキップ（将来対応）
  }, []);

  function updateAction(index: number, action: ActionFormData) {
    onChange(actions.map((a, i) => (i === index ? action : a)));
  }

  function changeType(index: number, type: string) {
    updateAction(index, defaultAction(type));
  }

  function addAction() {
    onChange([...actions, defaultAction("enroll_scenario")]);
  }

  function removeAction(index: number) {
    onChange(actions.filter((_, i) => i !== index));
  }

  function renderTemplateSelect(
    value: string,
    onValueChange: (value: string) => void,
    placeholder = "package-id",
  ) {
    if (packages.length > 0) {
      return (
        <Select value={value} onChange={(e) => onValueChange(e.target.value)}>
          <option value="">-- パッケージを選択 --</option>
          {packages.map((pkg) => (
            <option key={pkg.id} value={pkg.id}>{pkg.name}</option>
          ))}
        </Select>
      );
    }

    return (
      <Input
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        placeholder={placeholder}
      />
    );
  }

  return (
    <div className="space-y-3">
      {actions.map((action, index) => (
        <Card key={index} className="border-l-4 border-l-secondary">
          <CardContent className="space-y-3 p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-muted-foreground">
                {t("actionNumber", { number: index + 1 })}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-destructive"
                onClick={() => removeAction(index)}
                disabled={actions.length <= 1}
              >
                ×
              </Button>
            </div>

            <div className="space-y-2">
              <Label className="flex items-center gap-1">
                {t("actionType")}
                <Tooltip content={ACTION_TYPES.find((at) => at.value === action.type)?.hint ?? ""} />
              </Label>
              <Select
                value={action.type}
                onChange={(e) => changeType(index, e.target.value)}
              >
                {ACTION_TYPES.map((at) => (
                  <option key={at.value} value={at.value}>{at.label}</option>
                ))}
              </Select>
            </div>

            {/* シナリオ登録 → ドロップダウン選択 */}
            {action.type === "enroll_scenario" && (
              <div className="space-y-2">
                <Label className="flex items-center gap-1">
                  シナリオ
                  <Tooltip content="ユーザーをこのシナリオのステップ配信に登録します" />
                </Label>
                {scenarios.length > 0 ? (
                  <Select
                    value={action.scenarioId}
                    onChange={(e) => updateAction(index, { ...action, scenarioId: e.target.value })}
                  >
                    <option value="">-- シナリオを選択 --</option>
                    {scenarios.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </Select>
                ) : (
                  <div>
                    <Input
                      value={action.scenarioId}
                      onChange={(e) => updateAction(index, { ...action, scenarioId: e.target.value })}
                      placeholder="シナリオID（先にシナリオを作成してください）"
                    />
                    <p className="text-xs text-gray-400 mt-1">シナリオがまだありません。先にシナリオを作成するとここで選択できます。</p>
                  </div>
                )}
              </div>
            )}

            {action.type === "start_survey" && (
              <div className="space-y-2">
                <Label className="flex items-center gap-1">
                  アンケート
                  <Tooltip content="このアクションで指定したアンケートの回答を開始します" />
                </Label>
                {surveys.length > 0 ? (
                  <Select
                    value={action.surveyId}
                    onChange={(e) => updateAction(index, { ...action, surveyId: e.target.value })}
                  >
                    <option value="">-- アンケートを選択 --</option>
                    {surveys.map((survey) => (
                      <option key={survey.id} value={survey.id}>{survey.name}</option>
                    ))}
                  </Select>
                ) : (
                  <div>
                    <Input
                      value={action.surveyId}
                      onChange={(e) => updateAction(index, { ...action, surveyId: e.target.value })}
                      placeholder="アンケートID"
                    />
                    <p className="text-xs text-gray-400 mt-1">アンケートがまだありません。先にアンケートを作成するとここで選択できます。</p>
                  </div>
                )}
              </div>
            )}

            {/* パッケージ送信 */}
            {action.type === "send_template" && (
              <div className="space-y-2">
                <Label className="flex items-center gap-1">
                  パッケージ
                  <Tooltip content="送信するパッケージを選択します" />
                </Label>
                {renderTemplateSelect(
                  action.templateId,
                  (templateId) => updateAction(index, { ...action, templateId }),
                )}
              </div>
            )}

            {action.type === "send_template_by_follower_status" && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label className="flex items-center gap-1">
                    フォロワー向けパッケージ
                    <Tooltip content="フォロー中ユーザーに送信するパッケージです" />
                  </Label>
                  {renderTemplateSelect(
                    action.followerTemplateId,
                    (followerTemplateId) => updateAction(index, { ...action, followerTemplateId }),
                    "follower-package-id",
                  )}
                </div>
                <div className="space-y-2">
                  <Label className="flex items-center gap-1">
                    未フォロー向けパッケージ
                    <Tooltip content="未フォローまたはフォロー状態を判定できないユーザーに送信するパッケージです" />
                  </Label>
                  {renderTemplateSelect(
                    action.nonFollowerTemplateId,
                    (nonFollowerTemplateId) => updateAction(index, { ...action, nonFollowerTemplateId }),
                    "non-follower-package-id",
                  )}
                </div>
              </div>
            )}

            {/* タグ追加/削除 */}
            {(action.type === "add_tag" || action.type === "remove_tag") && (
              <div className="space-y-2">
                <Label className="flex items-center gap-1">
                  タグ
                  <Tooltip content={action.type === "add_tag" ? "ユーザーにこのタグを付与します" : "ユーザーからこのタグを削除します"} />
                </Label>
                <Input
                  value={action.tagId}
                  onChange={(e) => updateAction(index, { ...action, tagId: e.target.value })}
                  placeholder="タグID"
                />
              </div>
            )}

            {/* Webhook */}
            {action.type === "webhook" && (
              <div className="space-y-2">
                <Label className="flex items-center gap-1">
                  {t("webhookUrl")}
                  <Tooltip content="トリガー発火時にこのURLにPOSTリクエストを送信します" />
                </Label>
                <Input
                  type="url"
                  value={action.url}
                  onChange={(e) => updateAction(index, { ...action, url: e.target.value })}
                  placeholder="https://example.com/webhook"
                />
              </div>
            )}

            {/* メタデータ更新 */}
            {action.type === "update_metadata" && (
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-2">
                  <Label>{t("metadataKey")}</Label>
                  <Input
                    value={action.key}
                    onChange={(e) => updateAction(index, { ...action, key: e.target.value })}
                    placeholder="例: interest"
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t("metadataValue")}</Label>
                  <Input
                    value={action.value}
                    onChange={(e) => updateAction(index, { ...action, value: e.target.value })}
                    placeholder="例: fashion"
                  />
                </div>
              </div>
            )}

            {/* スコア変更 */}
            {action.type === "update_score" && (
              <div className="space-y-2">
                <Label className="flex items-center gap-1">
                  {t("scoreDelta")}
                  <Tooltip content="正の値で加算、負の値で減算。ユーザーのエンゲージメント計測に利用" />
                </Label>
                <Input
                  type="number"
                  value={action.delta}
                  onChange={(e) => updateAction(index, { ...action, delta: Number(e.target.value) })}
                />
              </div>
            )}

            {/* リアクション送信 */}
            {action.type === "send_reaction" && (
              <div className="space-y-2">
                <Label className="flex items-center gap-1">
                  {t("emoji")}
                  <Tooltip content="受信メッセージに絵文字リアクションを送信します" />
                </Label>
                <Input
                  value={action.emoji}
                  onChange={(e) => updateAction(index, { ...action, emoji: e.target.value })}
                  placeholder="❤️"
                  maxLength={4}
                />
              </div>
            )}
            {/* キャンペーン参加 */}
            {action.type === "enter_campaign" && (
              <div className="space-y-2">
                <Label className="flex items-center gap-1">
                  キャンペーン
                  <Tooltip content="ユーザーをこのキャンペーンにエントリーします（即時抽選/後日抽選）" />
                </Label>
                {campaigns.length > 0 ? (
                  <Select
                    value={action.campaignId}
                    onChange={(e) => updateAction(index, { ...action, campaignId: e.target.value })}
                  >
                    <option value="">-- キャンペーンを選択 --</option>
                    {campaigns.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </Select>
                ) : (
                  <div>
                    <Input
                      value={action.campaignId}
                      onChange={(e) => updateAction(index, { ...action, campaignId: e.target.value })}
                      placeholder="キャンペーンID（先にキャンペーンを作成してください）"
                    />
                    <p className="text-xs text-gray-400 mt-1">抽選キャンペーンがまだありません。先にキャンペーンを作成するとここで選択できます。</p>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      ))}

      <div className="flex justify-center">
        <Button type="button" variant="outline" onClick={addAction}>
          + {t("addAction")}
        </Button>
      </div>
    </div>
  );
}
