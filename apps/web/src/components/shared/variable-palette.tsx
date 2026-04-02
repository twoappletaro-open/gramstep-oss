"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { createApiClient, getApiUrl } from "../../lib/api-client";

const BASE_VARIABLE_ITEMS = [
  { label: "お名前", token: "{{display_name}}", sample: "田中 太郎" },
  { label: "ユーザー名", token: "{{username}}", sample: "tanaka_taro" },
  { label: "スコア", token: "{{score}}", sample: "42" },
  { label: "IGユーザーID", token: "{{ig_user_id}}", sample: "1784..." },
] as const;

type VariableItem = {
  label: string;
  token: string;
  sample: string;
};

type VariableOptionsResponse = {
  base?: VariableItem[];
  metadata?: VariableItem[];
  tags?: VariableItem[];
  custom?: VariableItem[];
};

function mergeVariableItems(groups: VariableOptionsResponse): VariableItem[] {
  const seen = new Set<string>();
  const merged = [
    ...(groups.base ?? BASE_VARIABLE_ITEMS),
    ...(groups.metadata ?? []),
    ...(groups.tags ?? []),
    ...(groups.custom ?? []),
  ];

  return merged.filter((item) => {
    if (seen.has(item.token)) return false;
    seen.add(item.token);
    return true;
  });
}

function insertAtCursor(
  value: string,
  token: string,
  inputRef?: RefObject<HTMLInputElement | HTMLTextAreaElement | null>,
): { nextValue: string; nextCursor: number } {
  const node = inputRef?.current;
  if (!node) {
    const nextValue = `${value}${token}`;
    return { nextValue, nextCursor: nextValue.length };
  }

  const start = node.selectionStart ?? value.length;
  const end = node.selectionEnd ?? value.length;
  const nextValue = `${value.slice(0, start)}${token}${value.slice(end)}`;
  return { nextValue, nextCursor: start + token.length };
}

export function VariablePalette({
  value,
  onChange,
  inputRef,
  buttonLabel = "変数挿入",
  compact = false,
}: {
  value: string;
  onChange: (nextValue: string) => void;
  inputRef?: RefObject<HTMLInputElement | HTMLTextAreaElement | null>;
  buttonLabel?: string;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<VariableItem[]>([...BASE_VARIABLE_ITEMS]);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  useEffect(() => {
    const apiUrl = getApiUrl();
    const accountId = typeof window !== "undefined" ? localStorage.getItem("gramstep_account_id") ?? "" : "";
    if (!apiUrl || !accountId) return;

    const client = createApiClient(apiUrl);
    let cancelled = false;

    client.variables.options(accountId).then((result) => {
      if (!result.ok || cancelled) return;
      setItems(mergeVariableItems(result.value as VariableOptionsResponse));
    }).catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        className={`inline-flex items-center gap-2 rounded-md border border-gray-200 bg-white font-medium text-cobalt-700 transition-colors hover:bg-gray-50 ${
          compact ? "px-2.5 py-1.5 text-xs" : "px-3 py-2 text-sm"
        }`}
        onClick={() => setOpen((current) => !current)}
      >
        {buttonLabel}
        <span className={`text-xs text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}>
          ▼
        </span>
      </button>

      {open && (
        <div className="absolute left-0 top-full z-20 mt-2 w-full min-w-[340px] overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl">
          <div className="divide-y divide-gray-100">
            {items.map((item) => (
              <button
                key={item.token}
                type="button"
                className="grid w-full grid-cols-[1.1fr_1.4fr_1fr] items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-50"
                onClick={() => {
                  const { nextValue, nextCursor } = insertAtCursor(value, item.token, inputRef);
                  onChange(nextValue);
                  setOpen(false);
                  requestAnimationFrame(() => {
                    inputRef?.current?.focus();
                    inputRef?.current?.setSelectionRange(nextCursor, nextCursor);
                  });
                }}
              >
                <span className="text-sm font-semibold text-gray-900">{item.label}</span>
                <span className="font-mono text-sm text-slate-400">{item.token}</span>
                <span className="text-right text-sm text-slate-400">{item.sample}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
