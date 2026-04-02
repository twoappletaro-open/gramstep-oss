"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select } from "../ui/select";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { VariablePalette } from "../shared/variable-palette";
import { createApiClient, getApiUrl } from "../../lib/api-client";
import type {
  CreatePackageInput,
  PackageButton,
  PackageButtonAction,
  UpdatePackageInput,
} from "@gramstep/shared";

type PackageOption = {
  id: string;
  name: string;
};

type PackageFormProps = {
  initialData?: {
    id: string;
    name: string;
    text: string;
    buttons: PackageButton[];
    is_active: boolean;
    version: number;
  };
  onSubmit: (data: CreatePackageInput | UpdatePackageInput) => Promise<void>;
  loading: boolean;
};

function makeButton(index: number): PackageButton {
  return {
    id: `btn_${Date.now()}_${index}`,
    label: "",
    action: {
      type: "send_message",
      selectionMode: "specific",
      packageId: "",
      useFollowerCondition: false,
      packageIds: [],
    },
  };
}

function getSelectionMode(action: PackageButtonAction): "specific" | "random" | "follower_condition" {
  return action.selectionMode ?? (action.useFollowerCondition ? "follower_condition" : "specific");
}

export function PackageForm({ initialData, onSubmit, loading }: PackageFormProps) {
  const accountId = typeof window !== "undefined" ? localStorage.getItem("gramstep_account_id") ?? "" : "";
  const apiUrl = typeof window !== "undefined" ? getApiUrl() : "";

  const [name, setName] = useState(initialData?.name ?? "");
  const [text, setText] = useState(initialData?.text ?? "");
  const [buttons, setButtons] = useState<PackageButton[]>(initialData?.buttons ?? []);
  const [isActive, setIsActive] = useState(initialData?.is_active ?? true);
  const [packageOptions, setPackageOptions] = useState<PackageOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const textRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!accountId || !apiUrl) return;
    const client = createApiClient(apiUrl);
    client.packages.list(accountId).then((result) => {
      if (result.ok) {
        const currentId = initialData?.id ?? "";
        setPackageOptions(
          (result.value as Array<Record<string, unknown>>)
            .map((pkg) => ({
              id: String(pkg.id ?? ""),
              name: String(pkg.name ?? ""),
            }))
            .filter((pkg) => pkg.id !== currentId),
        );
      }
    }).catch(() => {});
  }, [accountId, apiUrl, initialData?.id]);

  function updateButton(index: number, next: PackageButton) {
    setButtons((prev) => prev.map((button, currentIndex) => currentIndex === index ? next : button));
  }

  function addButton() {
    setButtons((prev) => [...prev, makeButton(prev.length + 1)]);
  }

  function removeButton(index: number) {
    setButtons((prev) => prev.filter((_, currentIndex) => currentIndex !== index));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError("パッケージ名を入力してください");
      return;
    }
    if (!text.trim()) {
      setError("本文を入力してください");
      return;
    }
    if (buttons.some((button) => !button.label.trim())) {
      setError("すべてのボタンテキストを入力してください");
      return;
    }
    if (buttons.some((button) => {
      const mode = getSelectionMode(button.action);
      if (mode === "follower_condition") {
        return !button.action.followerPackageId || !button.action.nonFollowerPackageId;
      }
      if (mode === "random") {
        return !button.action.packageIds || button.action.packageIds.filter(Boolean).length === 0;
      }
      return !button.action.packageId;
    })) {
      setError("各ボタンの送信先パッケージを設定してください");
      return;
    }

    if (initialData) {
      await onSubmit({
        name,
        text,
        buttons,
        is_active: isActive,
        version: initialData.version,
      } satisfies UpdatePackageInput);
      return;
    }

    await onSubmit({
      name,
      text,
      buttons,
    } satisfies CreatePackageInput);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>基本設定</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="package-name">パッケージ名</Label>
            <Input
              id="package-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={255}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label htmlFor="package-text">本文</Label>
              <VariablePalette
                value={text}
                onChange={setText}
                inputRef={textRef}
                buttonLabel="変数"
                compact
              />
            </div>
            <Textarea
              id="package-text"
              ref={textRef}
              value={text}
              onChange={(event) => setText(event.target.value)}
              maxLength={1000}
              className="min-h-[140px]"
            />
          </div>

          <div className="flex items-center gap-3">
            <Switch id="package-active" checked={isActive} onCheckedChange={setIsActive} />
            <Label htmlFor="package-active">有効にする</Label>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <CardTitle>ボタン設定</CardTitle>
            <Button type="button" variant="outline" onClick={addButton} disabled={buttons.length >= 13}>
              ボタン追加
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {buttons.length === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-300 p-6 text-sm text-muted-foreground">
              ボタンなしでも保存できます。記事どおりの分岐を見せる場合は、ここでボタンを追加してください。
            </div>
          ) : buttons.map((button, index) => (
            <div key={button.id} className="space-y-4 rounded-xl border border-gray-200 p-4">
              <div className="flex items-center justify-between gap-4">
                <h3 className="font-medium text-cobalt-700">ボタン {index + 1}</h3>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-destructive"
                  onClick={() => removeButton(index)}
                >
                  削除
                </Button>
              </div>

              <div className="space-y-2">
                <Label>ボタンテキスト</Label>
                <Input
                  value={button.label}
                  onChange={(event) => updateButton(index, { ...button, label: event.target.value })}
                  maxLength={20}
                />
              </div>

              <div className="space-y-2">
                <Label>ボタンアクション</Label>
                <Select value="send_message" disabled>
                  <option value="send_message">メッセージ送信</option>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>送信先の選び方</Label>
                <Select
                  value={getSelectionMode(button.action)}
                  onChange={(event) => {
                    const mode = event.target.value as "specific" | "random" | "follower_condition";
                    if (mode === "follower_condition") {
                      updateButton(index, {
                        ...button,
                        action: {
                          type: "send_message",
                          selectionMode: "follower_condition",
                          useFollowerCondition: true,
                          followerPackageId: button.action.followerPackageId ?? "",
                          nonFollowerPackageId: button.action.nonFollowerPackageId ?? "",
                          packageIds: [],
                        },
                      });
                      return;
                    }
                    if (mode === "random") {
                      updateButton(index, {
                        ...button,
                        action: {
                          type: "send_message",
                          selectionMode: "random",
                          useFollowerCondition: false,
                          packageIds: button.action.packageIds?.length ? button.action.packageIds : [""],
                        },
                      });
                      return;
                    }
                    updateButton(index, {
                      ...button,
                      action: {
                        type: "send_message",
                        selectionMode: "specific",
                        useFollowerCondition: false,
                        packageId: button.action.packageId ?? "",
                        packageIds: [],
                      },
                    });
                  }}
                >
                  <option value="specific">指定</option>
                  <option value="random">ランダム</option>
                  <option value="follower_condition">フォロワー条件</option>
                </Select>
              </div>

              {getSelectionMode(button.action) === "follower_condition" ? (
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>フォロワーに送るパッケージ</Label>
                    <Select
                      value={button.action.followerPackageId ?? ""}
                      onChange={(event) => updateButton(index, {
                        ...button,
                        action: {
                          type: "send_message",
                          selectionMode: "follower_condition",
                          useFollowerCondition: true,
                          followerPackageId: event.target.value,
                          nonFollowerPackageId: button.action.nonFollowerPackageId ?? "",
                          packageIds: [],
                        },
                      })}
                    >
                      <option value="">選択してください</option>
                      {packageOptions.map((pkg) => (
                        <option key={pkg.id} value={pkg.id}>{pkg.name}</option>
                      ))}
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>未フォローに送るパッケージ</Label>
                    <Select
                      value={button.action.nonFollowerPackageId ?? ""}
                      onChange={(event) => updateButton(index, {
                        ...button,
                        action: {
                          type: "send_message",
                          selectionMode: "follower_condition",
                          useFollowerCondition: true,
                          followerPackageId: button.action.followerPackageId ?? "",
                          nonFollowerPackageId: event.target.value,
                          packageIds: [],
                        },
                      })}
                    >
                      <option value="">選択してください</option>
                      {packageOptions.map((pkg) => (
                        <option key={pkg.id} value={pkg.id}>{pkg.name}</option>
                      ))}
                    </Select>
                  </div>
                </div>
              ) : getSelectionMode(button.action) === "random" ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-4">
                    <Label>ランダム候補パッケージ</Label>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => updateButton(index, {
                        ...button,
                        action: {
                          ...button.action,
                          selectionMode: "random",
                          useFollowerCondition: false,
                          packageIds: [...(button.action.packageIds ?? []), ""],
                        },
                      })}
                    >
                      候補追加
                    </Button>
                  </div>
                  {(button.action.packageIds ?? [""]).map((packageId, candidateIndex) => (
                    <div key={`${button.id}_random_${candidateIndex}`} className="flex gap-2">
                      <Select
                        value={packageId}
                        onChange={(event) => {
                          const nextPackageIds = [...(button.action.packageIds ?? [])];
                          nextPackageIds[candidateIndex] = event.target.value;
                          updateButton(index, {
                            ...button,
                            action: {
                              type: "send_message",
                              selectionMode: "random",
                              useFollowerCondition: false,
                              packageIds: nextPackageIds,
                            },
                          });
                        }}
                      >
                        <option value="">選択してください</option>
                        {packageOptions.map((pkg) => (
                          <option key={pkg.id} value={pkg.id}>{pkg.name}</option>
                        ))}
                      </Select>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-destructive"
                        onClick={() => {
                          const nextPackageIds = (button.action.packageIds ?? []).filter((_, currentIndex) => currentIndex !== candidateIndex);
                          updateButton(index, {
                            ...button,
                            action: {
                              type: "send_message",
                              selectionMode: "random",
                              useFollowerCondition: false,
                              packageIds: nextPackageIds.length > 0 ? nextPackageIds : [""],
                            },
                          });
                        }}
                      >
                        削除
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="space-y-2">
                  <Label>送信するパッケージ</Label>
                  <Select
                      value={button.action.packageId ?? ""}
                    onChange={(event) => updateButton(index, {
                      ...button,
                      action: {
                        type: "send_message",
                        selectionMode: "specific",
                        useFollowerCondition: false,
                        packageId: event.target.value,
                        packageIds: [],
                      },
                    })}
                  >
                    <option value="">選択してください</option>
                    {packageOptions.map((pkg) => (
                      <option key={pkg.id} value={pkg.id}>{pkg.name}</option>
                    ))}
                  </Select>
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button type="submit" disabled={loading}>
          {loading ? "保存中..." : "保存"}
        </Button>
      </div>
    </form>
  );
}
