type CheckStatus = "ok" | "error";

export interface HealthCheckResult {
  status: "ok" | "degraded";
  timestamp: number;
  checks: {
    worker: CheckStatus;
    d1: CheckStatus;
    kv: CheckStatus;
    queues: CheckStatus;
  };
  errors?: string[];
}

async function checkD1(db: D1Database): Promise<CheckStatus> {
  const stmt = db.prepare("SELECT 1 AS result");
  await stmt.bind().first();
  return "ok";
}

async function checkKV(kv: KVNamespace): Promise<CheckStatus> {
  // KV疎通はget-onlyで確認（put不要: 無料枠のwrite上限 1,000/日を消費しない）
  const value = await kv.get("_health_check");
  // KV は get が成功すれば（null含む）正常とみなす
  void value;
  return "ok";
}

export async function checkHealth(
  db: D1Database,
  kv: KVNamespace,
  _sendQueue: Queue,
): Promise<HealthCheckResult> {
  const errors: string[] = [];

  let d1Status: CheckStatus = "ok";
  try {
    d1Status = await checkD1(db);
  } catch {
    d1Status = "error";
    errors.push("d1: connection failed");
  }

  let kvStatus: CheckStatus = "ok";
  try {
    kvStatus = await checkKV(kv);
  } catch {
    kvStatus = "error";
    errors.push("kv: connection failed");
  }

  // Queues don't have a direct ping API in Workers runtime;
  // binding existence confirms availability
  const queuesStatus: CheckStatus = "ok";

  const hasErrors = errors.length > 0;

  return {
    status: hasErrors ? "degraded" : "ok",
    timestamp: Math.floor(Date.now() / 1000),
    checks: {
      worker: "ok",
      d1: d1Status,
      kv: kvStatus,
      queues: queuesStatus,
    },
    ...(hasErrors ? { errors } : {}),
  };
}
