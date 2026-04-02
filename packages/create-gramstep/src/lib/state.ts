import { readFileSync, writeFileSync, existsSync, unlinkSync, renameSync, chmodSync } from "node:fs";
import { join } from "node:path";

const STATE_FILE = ".gramstep-setup.json";

export interface SetupState {
  metaAppId: string;
  metaAppSecret: string;
  webhookVerifyToken: string;
  encryptionKey: string;
  jwtSecret: string;
  refreshSecret: string;
  dashboardUrl: string;
  apiKey: string;
  d1DatabaseId: string;
  d1DatabaseName: string;
  kvNamespaceId: string;
  sendQueueName: string;
  dlqName: string;
  r2BucketName: string;
  workerName: string;
  workerUrl: string;
  adminUrl: string;
  accountId: string;
  operatorEmail: string;
  operatorPassword: string;
  completedSteps: string[];
}

function defaultState(): SetupState {
  return {
    metaAppId: "",
    metaAppSecret: "",
    webhookVerifyToken: "",
    encryptionKey: "",
    jwtSecret: "",
    refreshSecret: "",
    dashboardUrl: "",
    apiKey: "",
    d1DatabaseId: "",
    d1DatabaseName: "gramstep",
    kvNamespaceId: "",
    sendQueueName: "gramstep-send",
    dlqName: "gramstep-dlq",
    r2BucketName: "gramstep-storage",
    workerName: "",
    workerUrl: "",
    adminUrl: "",
    accountId: "",
    operatorEmail: "",
    operatorPassword: "",
    completedSteps: [],
  };
}

export function loadState(projectDir: string): SetupState {
  const path = join(projectDir, STATE_FILE);
  if (!existsSync(path)) return defaultState();
  try {
    const raw = readFileSync(path, "utf-8");
    return { ...defaultState(), ...(JSON.parse(raw) as Partial<SetupState>) };
  } catch {
    // Corrupted state: backup and warn
    const bakPath = `${path}.bak`;
    try { renameSync(path, bakPath); } catch { /* ignore */ }
    console.warn(`[WARN] セットアップ状態ファイルが破損していたため ${bakPath} に退避しました`);
    return defaultState();
  }
}

export function saveState(projectDir: string, state: SetupState): void {
  const path = join(projectDir, STATE_FILE);
  writeFileSync(path, JSON.stringify(state, null, 2), "utf-8");
  try { chmodSync(path, 0o600); } catch { /* Windows等で失敗しても続行 */ }
}

export function deleteState(projectDir: string): void {
  const path = join(projectDir, STATE_FILE);
  if (existsSync(path)) {
    unlinkSync(path);
  }
}

export function isDone(state: SetupState, step: string): boolean {
  return state.completedSteps.includes(step);
}

export function markDone(state: SetupState, step: string): void {
  if (!state.completedSteps.includes(step)) {
    state.completedSteps.push(step);
  }
}
