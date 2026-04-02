/** API response (camelCase) → フロント用 (snake_case互換) に正規化 */

export function normalizeScenario(s: Record<string, unknown>) {
  return {
    id: s.id as string,
    name: (s.name ?? "") as string,
    trigger_type: (s.triggerType ?? s.trigger_type ?? "dm") as string,
    is_active: (s.isActive ?? s.is_active ?? false) as boolean,
    bot_disclosure_enabled: (s.botDisclosureEnabled ?? s.bot_disclosure_enabled ?? false) as boolean,
    version: (s.version ?? 1) as number,
    steps: ((s.steps ?? []) as Array<Record<string, unknown>>).map(normalizeStep),
    createdAt: (s.createdAt ?? s.created_at ?? 0) as number,
  };
}

export function normalizeStep(s: Record<string, unknown>) {
  return {
    step_order: (s.stepOrder ?? s.step_order ?? 0) as number,
    delay_seconds: (s.delaySeconds ?? s.delay_seconds ?? 0) as number,
    message_type: (s.messageType ?? s.message_type ?? "text") as string,
    message_payload: (s.messagePayload ?? s.message_payload ?? "") as string,
    condition_config: (s.conditionConfig ?? s.condition_config ?? null) as unknown,
  };
}

export function normalizeTrigger(t: Record<string, unknown>) {
  return {
    id: t.id as string,
    name: (t.name ?? "") as string,
    trigger_type: (t.triggerType ?? t.trigger_type ?? "dm") as string,
    match_type: (t.matchType ?? t.match_type ?? "partial") as string,
    fire_mode: (t.fireMode ?? t.fire_mode ?? "unlimited") as string,
    is_active: (t.isActive ?? t.is_active ?? false) as boolean,
    version: (t.version ?? 1) as number,
    keywords: (t.keywords ?? []) as string[],
    actions: (t.actions ?? []) as Array<Record<string, unknown>>,
    createdAt: (t.createdAt ?? t.created_at ?? 0) as number,
  };
}

export function normalizeAutomation(a: Record<string, unknown>) {
  return {
    id: a.id as string,
    name: (a.name ?? "") as string,
    is_active: (a.isActive ?? a.is_active ?? false) as boolean,
    condition_group: {
      logic: (
        (a.condition_group as Record<string, unknown> | undefined)?.logic
        ?? (a.conditionGroup as Record<string, unknown> | undefined)?.logic
        ?? "and"
      ) as string,
      conditions: (
        (a.condition_group as Record<string, unknown> | undefined)?.conditions
        ?? (a.conditionGroup as Record<string, unknown> | undefined)?.conditions
        ?? []
      ) as unknown[],
    },
    actions: (a.actions ?? []) as unknown[],
    version: (a.version ?? 1) as number,
  };
}
