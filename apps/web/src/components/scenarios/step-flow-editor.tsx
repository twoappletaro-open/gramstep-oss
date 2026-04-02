"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { getApiUrl } from "../../lib/api-client";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select } from "../ui/select";
import { Textarea } from "../ui/textarea";
import { Card, CardContent } from "../ui/card";
import { Tooltip } from "../ui/tooltip";
import { VariablePalette } from "../shared/variable-palette";
import type { ConditionConfig } from "@gramstep/shared";

export type StepFormData = {
  step_order: number;
  delay_seconds: number;
  message_type: string;
  message_payload: string;
  condition_config: ConditionConfig | null;
};

type StepFlowEditorProps = {
  steps: StepFormData[];
  onChange: (steps: StepFormData[]) => void;
  errors: Record<string, string>;
};

const MESSAGE_TYPES = [
  { value: "text", label: "テキスト", hint: "プレーンテキストメッセージ（最大1,000文字）" },
  { value: "image", label: "画像", hint: "画像URL付きメッセージ（8MB以内）" },
  { value: "generic", label: "カルーセル", hint: "タイトル+画像+ボタン付きリッチカード。商品紹介等に最適" },
  { value: "rich_menu", label: "リッチメニュー", hint: "画像・タイトル・ボタンをまとめて送るカード一覧。最大10カード、各3ボタンまで" },
  { value: "quick_reply", label: "クイックリプライ", hint: "選択ボタン付きメッセージ（最大13個）。回答でフロー分岐可能" },
];

function defaultPayloadForType(type: string): string {
  switch (type) {
    case "text":
      return JSON.stringify({ type: "text", text: "" });
    case "image":
      return JSON.stringify({ type: "image", url: "" });
    case "quick_reply":
      return JSON.stringify({ type: "quick_reply", text: "", quick_replies: [] });
    case "generic":
    case "rich_menu":
      return JSON.stringify({
        type,
        elements: [{ title: "", subtitle: "", image_url: "", buttons: [] }],
      });
    default:
      return "";
  }
}

function formatDelay(seconds: number): string {
  if (seconds === 0) return "即時送信";
  if (seconds < 60) return `${seconds}秒後`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}分後`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}時間後`;
  return `${Math.floor(seconds / 86400)}日後`;
}

export function StepFlowEditor({ steps, onChange, errors }: StepFlowEditorProps) {
  const t = useTranslations("scenarios");

  function updateStep(index: number, patch: Partial<StepFormData>) {
    const updated = steps.map((s, i) => {
      if (i !== index) return s;
      // タイプ変更時にペイロードをリセット
      if (patch.message_type && patch.message_type !== s.message_type) {
        return { ...s, ...patch, message_payload: defaultPayloadForType(patch.message_type) };
      }
      return { ...s, ...patch };
    });
    onChange(updated);
  }

  function addStep() {
    const nextOrder = steps.length > 0 ? Math.max(...steps.map((s) => s.step_order)) + 1 : 1;
    onChange([
      ...steps,
      {
        step_order: nextOrder,
        delay_seconds: 0,
        message_type: "text",
        message_payload: defaultPayloadForType("text"),
        condition_config: null,
      },
    ]);
  }

  function removeStep(index: number) {
    const updated = steps
      .filter((_, i) => i !== index)
      .map((s, i) => ({ ...s, step_order: i + 1 }));
    onChange(updated);
  }

  function moveStep(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= steps.length) return;
    const updated = [...steps];
    [updated[index], updated[target]] = [updated[target]!, updated[index]!];
    onChange(updated.map((s, i) => ({ ...s, step_order: i + 1 })));
  }

  return (
    <div className="space-y-4">
      {steps.map((step, index) => (
        <div key={step.step_order} className="relative">
          {/* Flow connector line */}
          {index > 0 && (
            <div className="absolute -top-4 left-6 h-4 w-0.5 bg-border" />
          )}

          <Card className="border-l-4 border-l-primary">
            <CardContent className="space-y-3 p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-muted-foreground">
                  {t("stepNumber", { number: step.step_order })}
                </span>
                <div className="flex space-x-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => moveStep(index, -1)}
                    disabled={index === 0}
                    aria-label={t("moveUp")}
                  >
                    ↑
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => moveStep(index, 1)}
                    disabled={index === steps.length - 1}
                    aria-label={t("moveDown")}
                  >
                    ↓
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-destructive"
                    onClick={() => removeStep(index)}
                    disabled={steps.length <= 1}
                    aria-label={t("removeStep")}
                  >
                    ×
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="flex items-center gap-1">
                    {t("messageType")}
                    <Tooltip content={MESSAGE_TYPES.find((m) => m.value === step.message_type)?.hint ?? ""} />
                  </Label>
                  <Select
                    value={step.message_type}
                    onChange={(e) => updateStep(index, { message_type: e.target.value })}
                  >
                    {MESSAGE_TYPES.map((mt) => (
                      <option key={mt.value} value={mt.value}>
                        {mt.label}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>{t("delay")}</Label>
                  <div className="flex items-center space-x-2">
                    <Input
                      type="number"
                      min={0}
                      value={step.delay_seconds}
                      onChange={(e) =>
                        updateStep(index, { delay_seconds: Math.max(0, Number(e.target.value)) })
                      }
                      className="w-24"
                    />
                    <span className="text-sm text-muted-foreground">
                      {formatDelay(step.delay_seconds)}
                    </span>
                  </div>
                </div>
              </div>

              {/* メッセージタイプ別入力フォーム */}
              <MessagePayloadEditor
                type={step.message_type}
                payload={step.message_payload}
                onChange={(payload) => updateStep(index, { message_payload: payload })}
                placeholder={t("messageContentPlaceholder")}
              />
              {errors[`step_${step.step_order}`] && (
                <p className="text-sm text-destructive">{errors[`step_${step.step_order}`]}</p>
              )}
            </CardContent>
          </Card>

          {/* Flow arrow to next step */}
          {index < steps.length - 1 && (
            <div className="flex justify-center py-1">
              <div className="h-4 w-0.5 bg-border" />
            </div>
          )}
        </div>
      ))}

      <div className="flex justify-center">
        <Button type="button" variant="outline" onClick={addStep}>
          + {t("addStep")}
        </Button>
      </div>
    </div>
  );
}

// ── メッセージタイプ別入力コンポーネント ──

type QuickReplyButton = { title: string; payload: string };
type PayloadJson = {
  type: string;
  text?: string;
  url?: string;
  quick_replies?: QuickReplyButton[];
};

function parsePayload(raw: string, type: string): PayloadJson {
  try {
    return JSON.parse(raw) as PayloadJson;
  } catch {
    if (type === "quick_reply") return { type, text: raw, quick_replies: [] };
    if (type === "image") return { type, url: raw };
    return { type, text: raw };
  }
}

function MessagePayloadEditor({
  type,
  payload,
  onChange,
  placeholder,
}: {
  type: string;
  payload: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  const parsed = parsePayload(payload, type);
  const textRef = useRef<HTMLTextAreaElement | null>(null);

  function update(patch: Partial<PayloadJson>) {
    onChange(JSON.stringify({ ...parsed, ...patch }));
  }

  if (type === "image") {
    return <ImageUploadEditor url={parsed.url ?? ""} onChange={(url) => update({ url })} />;
  }

  if (type === "quick_reply") {
    const replies = parsed.quick_replies ?? [];
    return (
      <div className="space-y-2">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Label>メッセージ本文</Label>
            <VariablePalette
              value={parsed.text ?? ""}
              onChange={(nextValue) => update({ text: nextValue })}
              inputRef={textRef}
              buttonLabel="変数"
              compact
            />
          </div>
          <Textarea
            ref={textRef}
            value={parsed.text ?? ""}
            onChange={(e) => update({ text: e.target.value })}
            rows={2}
            placeholder={placeholder}
          />
        </div>
        <div className="space-y-1">
          <Label className="flex items-center gap-1">
            選択ボタン
            <Tooltip content="ユーザーがタップで選択できるボタン。タップするとpayload値がトリガーに送られ、別のシナリオへ自動登録できます" />
          </Label>
          {replies.map((qr, qi) => (
            <div key={qi} className="flex items-center gap-2">
              <Input
                value={qr.title}
                onChange={(e) => {
                  const updated = [...replies];
                  updated[qi] = { ...qr, title: e.target.value };
                  update({ quick_replies: updated });
                }}
                placeholder="ボタン表示名（例: はい）"
                className="flex-1"
              />
              <div className="flex items-center gap-1 flex-1">
                <Input
                  value={qr.payload}
                  onChange={(e) => {
                    const updated = [...replies];
                    updated[qi] = { ...qr, payload: e.target.value };
                    update({ quick_replies: updated });
                  }}
                  placeholder="識別コード（例: YES_BUY）"
                  className="flex-1"
                />
                <Tooltip content="タップ時にトリガーへ送られるコード。トリガー管理でDMキーワードにこの値を設定すると、別シナリオへ自動登録できます（例: YES_BUY → 購入案内シナリオ）" />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-destructive"
                onClick={() => {
                  update({ quick_replies: replies.filter((_, i) => i !== qi) });
                }}
              >
                ×
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => update({ quick_replies: [...replies, { title: "", payload: "" }] })}
          >
            + ボタンを追加
          </Button>
        </div>
      </div>
    );
  }

  if (type === "generic" || type === "rich_menu") {
    return <GenericCardEditor mode={type} payload={payload} onChange={onChange} />;
  }

  // text (default) — 純粋なテキストのみ扱う
  const textValue = (() => {
    try {
      const p = JSON.parse(payload) as { text?: string };
      return p.text ?? "";
    } catch {
      return payload;
    }
  })();
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <Label>メッセージ内容</Label>
        <VariablePalette
          value={textValue}
          onChange={(nextValue) => onChange(JSON.stringify({ type: "text", text: nextValue }))}
          inputRef={textRef}
          buttonLabel="変数"
          compact
        />
      </div>
      <Textarea
        ref={textRef}
        value={textValue}
        onChange={(e) => onChange(JSON.stringify({ type: "text", text: e.target.value }))}
        rows={3}
        placeholder={placeholder}
      />
    </div>
  );
}

// ── 画像アップロードエディタ ──

function ImageUploadEditor({ url, onChange }: { url: string; onChange: (url: string) => void }) {
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState(url);
  const apiUrl = getApiUrl();

  useEffect(() => {
    setPreview(url);
  }, [url]);

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const token = typeof sessionStorage !== "undefined" ? sessionStorage.getItem("accessToken") ?? "" : "";
      const accountId = typeof sessionStorage !== "undefined" ? localStorage.getItem("gramstep_account_id") ?? "" : "";
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch(`${apiUrl}/api/media/upload`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "x-account-id": accountId,
        },
        body: formData,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        alert(`アップロード失敗: ${body.error ?? res.statusText}`);
        return;
      }

      const data = await res.json() as { url: string };
      onChange(data.url);
      setPreview(data.url);
    } catch (err: unknown) {
      alert(`アップロードエラー: ${err instanceof Error ? err.message : "Unknown"}`);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-2">
      <Label className="flex items-center gap-1">
        画像
        <Tooltip content="URLを直接入力するか、ファイルをアップロード（R2に保存）" />
      </Label>

      {/* ファイルアップロード */}
      <div className="flex items-center gap-2">
        <label className="inline-flex items-center gap-2 px-3 py-1.5 text-sm border rounded-md cursor-pointer hover:bg-gray-50 transition-colors">
          <span>{uploading ? "アップロード中..." : "ファイルを選択"}</span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            onChange={handleFileUpload}
            disabled={uploading}
            className="hidden"
          />
        </label>
        <span className="text-xs text-gray-400">JPG, PNG, GIF, WebP（8MB以内）</span>
      </div>

      {/* URL直接入力 */}
      <Input
        type="url"
        value={url}
        onChange={(e) => { onChange(e.target.value); setPreview(e.target.value); }}
        placeholder="または画像URLを直接入力"
      />

      {/* プレビュー */}
      {preview && (
        <div className="mt-1">
          <img
            src={preview}
            alt="プレビュー"
            className="block max-h-32 max-w-full rounded border object-contain"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
        </div>
      )}
    </div>
  );
}

// ── カルーセル（Generic Template）エディタ ──

type CardButton = { type: "web_url" | "postback"; title: string; url?: string; payload?: string };
type GenericCard = { title: string; subtitle: string; image_url: string; buttons: CardButton[] };

function parseCards(raw: string): GenericCard[] {
  try {
    const parsed = JSON.parse(raw) as { elements?: GenericCard[] } | GenericCard[];
    if (Array.isArray(parsed)) return parsed;
    if (parsed.elements) return parsed.elements;
    if ("title" in parsed) return [parsed as unknown as GenericCard];
    return [];
  } catch {
    return [];
  }
}

function GenericCardEditor({
  mode,
  payload,
  onChange,
}: {
  mode: "generic" | "rich_menu";
  payload: string;
  onChange: (v: string) => void;
}) {
  const cards = parseCards(payload);
  if (cards.length === 0) cards.push({ title: "", subtitle: "", image_url: "", buttons: [] });

  function updateCards(updated: GenericCard[]) {
    onChange(JSON.stringify({ type: mode, elements: updated }));
  }

  function updateCard(ci: number, patch: Partial<GenericCard>) {
    const updated = cards.map((c, i) => (i === ci ? { ...c, ...patch } : c));
    updateCards(updated);
  }

  function addCard() {
    updateCards([...cards, { title: "", subtitle: "", image_url: "", buttons: [] }]);
  }

  function removeCard(ci: number) {
    updateCards(cards.filter((_, i) => i !== ci));
  }

  function updateButton(ci: number, bi: number, patch: Partial<CardButton>) {
    const card = cards[ci];
    if (!card) return;
    const buttons = card.buttons.map((b, i) => (i === bi ? { ...b, ...patch } : b));
    updateCard(ci, { buttons });
  }

  function addButton(ci: number) {
    const card = cards[ci];
    if (!card) return;
    updateCard(ci, { buttons: [...card.buttons, { type: "web_url", title: "", url: "" }] });
  }

  function removeButton(ci: number, bi: number) {
    const card = cards[ci];
    if (!card) return;
    updateCard(ci, { buttons: card.buttons.filter((_, i) => i !== bi) });
  }

  return (
    <div className="space-y-3">
      <Label className="flex items-center gap-1">
        {mode === "rich_menu" ? "リッチメニューカード" : "カルーセルカード"}
        <Tooltip content={mode === "rich_menu"
          ? "カード型のリッチメニューを送信します。各カードに画像・タイトル・説明・ボタンを設定できます"
          : "横スクロールで表示されるカード。各カードにタイトル・説明・画像・ボタンを設定可能"} />
      </Label>
      <p className="text-xs text-muted-foreground">
        最大10カード、各カードにつきボタンは3個までを推奨します。
      </p>

      {cards.map((card, ci) => (
        <div key={ci} className="rounded-lg border bg-gray-50 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-gray-500">カード {ci + 1}</span>
            {cards.length > 1 && (
              <Button type="button" variant="ghost" size="sm" className="text-destructive h-6"
                onClick={() => removeCard(ci)}>×</Button>
            )}
          </div>

          <Input
            value={card.title}
            onChange={(e) => updateCard(ci, { title: e.target.value })}
            placeholder="タイトル（例: 商品名）"
          />
          <Input
            value={card.subtitle}
            onChange={(e) => updateCard(ci, { subtitle: e.target.value })}
            placeholder="説明文"
          />
          <ImageUploadEditor
            url={card.image_url}
            onChange={(url) => updateCard(ci, { image_url: url })}
          />

          {/* ボタン */}
          <div className="space-y-1 pl-2 border-l-2 border-gray-200">
            <span className="text-xs text-gray-500">ボタン</span>
            {card.buttons.map((btn, bi) => (
              <div key={bi} className="flex items-center gap-1">
                <Select value={btn.type} onChange={(e) => updateButton(ci, bi, { type: e.target.value as "web_url" | "postback" })} className="w-24">
                  <option value="web_url">URL</option>
                  <option value="postback">アクション</option>
                </Select>
                <Input
                  value={btn.title}
                  onChange={(e) => updateButton(ci, bi, { title: e.target.value })}
                  placeholder="ボタン名"
                  className="flex-1"
                />
                {btn.type === "web_url" ? (
                  <Input
                    type="url"
                    value={btn.url ?? ""}
                    onChange={(e) => updateButton(ci, bi, { url: e.target.value })}
                    placeholder="リンク先URL"
                    className="flex-1"
                  />
                ) : (
                  <Input
                    value={btn.payload ?? ""}
                    onChange={(e) => updateButton(ci, bi, { payload: e.target.value })}
                    placeholder="payload値"
                    className="flex-1"
                  />
                )}
                <Button type="button" variant="ghost" size="sm" className="text-destructive h-7"
                  onClick={() => removeButton(ci, bi)}>×</Button>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" onClick={() => addButton(ci)} disabled={card.buttons.length >= 3}>
              + ボタン追加
            </Button>
          </div>
        </div>
      ))}

      <Button type="button" variant="outline" size="sm" onClick={addCard} disabled={cards.length >= 10}>
        + カードを追加
      </Button>
    </div>
  );
}
