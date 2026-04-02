import type { Result } from "@gramstep/shared";
import { ok, err } from "@gramstep/shared";
import { executeFirst } from "@gramstep/db";
import type { Operator } from "@gramstep/db";

// ────────── Types ──────────

export type AdminAuthError = {
  code:
    | "INVALID_CREDENTIALS"
    | "INVALID_TOKEN"
    | "TOKEN_EXPIRED"
    | "OPERATOR_NOT_FOUND"
    | "AUTH_ERROR";
  message: string;
};

export interface AdminAuthDeps {
  db: D1Database;
  jwtSecret: string;
  refreshSecret: string;
}

export interface AccessTokenPayload {
  sub: string;
  role: string;
  accountId: string;
  totpVerified: boolean;
  iat: number;
  exp: number;
}

export interface RefreshTokenPayload {
  sub: string;
  jti: string;
  iat: number;
  exp: number;
}

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  operator: { id: string; email: string; role: string };
  totpRequired: boolean;
}

export interface RefreshResult {
  accessToken: string;
  refreshToken: string;
}

// ────────── Constants ──────────

const ACCESS_TOKEN_TTL = 1800; // 30分
const REFRESH_TOKEN_TTL = 604800; // 7日
const PBKDF2_ITERATIONS = 100000;
const SALT_LENGTH = 16;

// ────────── Password Validation ──────────

export function validatePassword(password: string): boolean {
  if (password.length < 8) return false;
  const hasLetter = /[a-zA-Z]/.test(password);
  const hasDigit = /[0-9]/.test(password);
  const hasSymbol = /[^a-zA-Z0-9]/.test(password);
  return hasLetter && hasDigit && hasSymbol;
}

// ────────── Password Hashing (PBKDF2) ──────────

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const derivedBits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    256,
  );
  const hash = bytesToHex(new Uint8Array(derivedBits));
  const saltHex = bytesToHex(salt);
  return `pbkdf2:${PBKDF2_ITERATIONS}:${saltHex}:${hash}`;
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split(":");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iterations = parseInt(parts[1]!, 10);
  const salt = hexToBytes(parts[2]!);
  const expectedHash = parts[3]!;

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const derivedBits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt.buffer as ArrayBuffer, iterations, hash: "SHA-256" },
    keyMaterial,
    256,
  );
  const hash = bytesToHex(new Uint8Array(derivedBits));
  return hash === expectedHash;
}

// ────────── JWT (HMAC-SHA256) ──────────

function base64UrlEncode(data: Uint8Array): string {
  let binary = "";
  for (const byte of data) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(str: string): Uint8Array {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/");
  const paddedFull = padded + "=".repeat((4 - (padded.length % 4)) % 4);
  const binary = atob(paddedFull);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function encodeJson(obj: Record<string, unknown>): string {
  return base64UrlEncode(new TextEncoder().encode(JSON.stringify(obj)));
}

async function hmacSign(data: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(data),
  );
  return base64UrlEncode(new Uint8Array(signature));
}

async function hmacVerify(
  data: string,
  signature: string,
  secret: string,
): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const sigBytes = base64UrlDecode(signature);
  return crypto.subtle.verify(
    "HMAC",
    key,
    sigBytes.buffer as ArrayBuffer,
    new TextEncoder().encode(data),
  );
}

export async function createAccessToken(
  payload: {
    sub: string;
    role: string;
    accountId: string;
    totpVerified: boolean;
  },
  secret: string,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = encodeJson({ alg: "HS256", typ: "JWT" });
  const body = encodeJson({
    sub: payload.sub,
    role: payload.role,
    account_id: payload.accountId,
    totp_verified: payload.totpVerified,
    iat: now,
    exp: now + ACCESS_TOKEN_TTL,
  });
  const signature = await hmacSign(`${header}.${body}`, secret);
  return `${header}.${body}.${signature}`;
}

export async function verifyAccessToken(
  token: string,
  secret: string,
): Promise<Result<AccessTokenPayload, AdminAuthError>> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) {
      return err({ code: "INVALID_TOKEN", message: "Invalid token format" });
    }

    const valid = await hmacVerify(`${parts[0]}.${parts[1]}`, parts[2]!, secret);
    if (!valid) {
      return err({ code: "INVALID_TOKEN", message: "Invalid signature" });
    }

    const payloadBytes = base64UrlDecode(parts[1]!);
    const payload = JSON.parse(new TextDecoder().decode(payloadBytes)) as {
      sub: string;
      role: string;
      account_id: string;
      totp_verified: boolean;
      iat: number;
      exp: number;
    };

    const now = Math.floor(Date.now() / 1000);
    if (payload.exp <= now) {
      return err({ code: "TOKEN_EXPIRED", message: "Token expired" });
    }

    return ok({
      sub: payload.sub,
      role: payload.role,
      accountId: payload.account_id,
      totpVerified: payload.totp_verified,
      iat: payload.iat,
      exp: payload.exp,
    });
  } catch {
    return err({ code: "INVALID_TOKEN", message: "Failed to verify token" });
  }
}

export async function createRefreshToken(
  operatorId: string,
  secret: string,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const jti = crypto.randomUUID();
  const header = encodeJson({ alg: "HS256", typ: "JWT" });
  const body = encodeJson({
    sub: operatorId,
    jti,
    iat: now,
    exp: now + REFRESH_TOKEN_TTL,
  });
  const signature = await hmacSign(`${header}.${body}`, secret);
  return `${header}.${body}.${signature}`;
}

export async function verifyRefreshToken(
  token: string,
  secret: string,
): Promise<Result<RefreshTokenPayload, AdminAuthError>> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) {
      return err({ code: "INVALID_TOKEN", message: "Invalid token format" });
    }

    const valid = await hmacVerify(`${parts[0]}.${parts[1]}`, parts[2]!, secret);
    if (!valid) {
      return err({ code: "INVALID_TOKEN", message: "Invalid signature" });
    }

    const payloadBytes = base64UrlDecode(parts[1]!);
    const payload = JSON.parse(new TextDecoder().decode(payloadBytes)) as {
      sub: string;
      jti: string;
      iat: number;
      exp: number;
    };

    const now = Math.floor(Date.now() / 1000);
    if (payload.exp <= now) {
      return err({ code: "TOKEN_EXPIRED", message: "Refresh token expired" });
    }

    return ok(payload);
  } catch {
    return err({ code: "INVALID_TOKEN", message: "Failed to verify refresh token" });
  }
}

// ────────── Login ──────────

export async function loginOperator(
  email: string,
  password: string,
  deps: AdminAuthDeps,
): Promise<Result<LoginResult, AdminAuthError>> {
  const operatorResult = await executeFirst<Operator>(
    deps.db,
    "SELECT * FROM operators WHERE email = ?",
    email,
  );

  if (!operatorResult.ok) {
    return err({ code: "AUTH_ERROR", message: operatorResult.error.message });
  }

  const operator = operatorResult.value;
  if (operator === null) {
    return err({
      code: "INVALID_CREDENTIALS",
      message: "Invalid email or password",
    });
  }

  const passwordValid = await verifyPassword(password, operator.password_hash);
  if (!passwordValid) {
    return err({
      code: "INVALID_CREDENTIALS",
      message: "Invalid email or password",
    });
  }

  const totpRequired = operator.totp_enabled === 1;

  // デフォルトアカウントIDを取得
  const accountRow = await deps.db
    .prepare("SELECT id FROM accounts LIMIT 1")
    .first<{ id: string }>();
  const accountId = accountRow?.id ?? "";

  const accessToken = await createAccessToken(
    {
      sub: operator.id,
      role: operator.role,
      accountId,
      totpVerified: false,
    },
    deps.jwtSecret,
  );

  const refreshToken = await createRefreshToken(operator.id, deps.refreshSecret);

  return ok({
    accessToken,
    refreshToken,
    operator: { id: operator.id, email: operator.email, role: operator.role, accountId },
    totpRequired,
  });
}

// ────────── Refresh ──────────

export async function refreshAccessToken(
  token: string,
  deps: AdminAuthDeps,
  totpVerified: boolean = false,
): Promise<Result<RefreshResult, AdminAuthError>> {
  const verifyResult = await verifyRefreshToken(token, deps.refreshSecret);
  if (!verifyResult.ok) {
    return err(verifyResult.error);
  }

  const payload = verifyResult.value;
  const operatorResult = await executeFirst<Operator>(
    deps.db,
    "SELECT * FROM operators WHERE id = ?",
    payload.sub,
  );

  if (!operatorResult.ok) {
    return err({ code: "AUTH_ERROR", message: operatorResult.error.message });
  }

  if (operatorResult.value === null) {
    return err({
      code: "OPERATOR_NOT_FOUND",
      message: "Operator not found",
    });
  }

  const operator = operatorResult.value;
  const accessToken = await createAccessToken(
    {
      sub: operator.id,
      role: operator.role,
      accountId: "",
      totpVerified,
    },
    deps.jwtSecret,
  );

  const newRefreshToken = await createRefreshToken(
    operator.id,
    deps.refreshSecret,
  );

  return ok({
    accessToken,
    refreshToken: newRefreshToken,
  });
}
