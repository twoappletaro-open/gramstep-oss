import type { Result } from "@gramstep/shared";
import { ok, err } from "@gramstep/shared";

export type D1Error = {
  code: "D1_ERROR";
  message: string;
};

export async function executeQuery<T>(
  db: D1Database,
  query: string,
  ...bindings: unknown[]
): Promise<Result<D1Result<T>, D1Error>> {
  try {
    const stmt = db.prepare(query).bind(...bindings);
    const result = await stmt.all<T>();
    return ok(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return err({ code: "D1_ERROR", message });
  }
}

export async function executeRun(
  db: D1Database,
  query: string,
  ...bindings: unknown[]
): Promise<Result<D1Result, D1Error>> {
  try {
    const stmt = db.prepare(query).bind(...bindings);
    const result = await stmt.run();
    return ok(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return err({ code: "D1_ERROR", message });
  }
}

export async function executeFirst<T>(
  db: D1Database,
  query: string,
  ...bindings: unknown[]
): Promise<Result<T | null, D1Error>> {
  try {
    const stmt = db.prepare(query).bind(...bindings);
    const result = await stmt.first<T>();
    return ok(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return err({ code: "D1_ERROR", message });
  }
}

export function generateId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
