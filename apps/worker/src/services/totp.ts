import type { Result } from "@gramstep/shared";
import { ok, err } from "@gramstep/shared";
import { executeFirst, executeRun } from "@gramstep/db";
import type { Operator } from "@gramstep/db";

// ────────── Types ──────────

export type TotpError = {
  code:
    | "INVALID_CODE"
    | "TOTP_ALREADY_ENABLED"
    | "TOTP_NOT_SETUP"
    | "OPERATOR_NOT_FOUND"
    | "D1_ERROR";
  message: string;
};

export interface TotpSetupResult {
  secret: string; // Base32 encoded
  uri: string; // otpauth:// URI
}

export interface TotpServiceDeps {
  db: D1Database;
  jwtSecret: string;
}

// ────────── Constants ──────────

const TOTP_PERIOD = 30; // seconds
const TOTP_DIGITS = 6;
const TOTP_WINDOW = 1; // ±1 step tolerance
const SECRET_LENGTH = 20; // bytes (160 bits, standard for SHA-1 TOTP)
const ISSUER = "GramStep";

// ────────── Base32 Encoding/Decoding (RFC 4648) ──────────

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(data: Uint8Array): string {
  if (data.length === 0) return "";

  let bits = 0;
  let value = 0;
  let result = "";

  for (const byte of data) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      result += BASE32_ALPHABET[(value >>> bits) & 0x1f];
    }
  }

  if (bits > 0) {
    result += BASE32_ALPHABET[(value << (5 - bits)) & 0x1f];
  }

  return result;
}

export function base32Decode(encoded: string): Uint8Array {
  const clean = encoded.replace(/=+$/, "").toUpperCase();
  if (clean.length === 0) return new Uint8Array(0);

  let bits = 0;
  let value = 0;
  const output: number[] = [];

  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      output.push((value >>> bits) & 0xff);
    }
  }

  return new Uint8Array(output);
}

// ────────── TOTP Core (RFC 6238 / RFC 4226) ──────────

export function generateTotpSecret(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(SECRET_LENGTH));
}

export async function generateTotpCode(
  secret: Uint8Array,
  timeSeconds: number,
): Promise<string> {
  const counter = Math.floor(timeSeconds / TOTP_PERIOD);

  // Counter to 8-byte big-endian buffer
  const counterBuffer = new ArrayBuffer(8);
  const view = new DataView(counterBuffer);
  view.setUint32(0, Math.floor(counter / 0x100000000));
  view.setUint32(4, counter & 0xffffffff);

  // HMAC-SHA1
  const key = await crypto.subtle.importKey(
    "raw",
    secret.buffer as ArrayBuffer,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const hmac = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, counterBuffer),
  );

  // Dynamic truncation (RFC 4226 Section 5.4)
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const binary =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);

  const otp = binary % 10 ** TOTP_DIGITS;
  return otp.toString().padStart(TOTP_DIGITS, "0");
}

export async function verifyTotpCode(
  secret: Uint8Array,
  code: string,
  timeSeconds: number,
): Promise<boolean> {
  if (!/^\d{6}$/.test(code)) return false;

  for (let i = -TOTP_WINDOW; i <= TOTP_WINDOW; i++) {
    const checkTime = timeSeconds + i * TOTP_PERIOD;
    const expected = await generateTotpCode(secret, checkTime);
    if (timingSafeEqual(code, expected)) {
      return true;
    }
  }
  return false;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

// ────────── TOTP URI (for QR code) ──────────

export function buildTotpUri(
  secret: Uint8Array,
  email: string,
  issuer: string = ISSUER,
): string {
  const encodedSecret = base32Encode(secret);
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(email)}`;
  const params = new URLSearchParams({
    secret: encodedSecret,
    issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

// ────────── TOTP Service Functions ──────────

export async function setupTotp(
  operatorId: string,
  deps: TotpServiceDeps,
): Promise<Result<TotpSetupResult, TotpError>> {
  const opResult = await executeFirst<Operator>(
    deps.db,
    "SELECT * FROM operators WHERE id = ?",
    operatorId,
  );

  if (!opResult.ok) {
    return err({ code: "D1_ERROR", message: opResult.error.message });
  }
  if (opResult.value === null) {
    return err({ code: "OPERATOR_NOT_FOUND", message: "Operator not found" });
  }

  if (opResult.value.totp_enabled === 1) {
    return err({
      code: "TOTP_ALREADY_ENABLED",
      message: "TOTP is already enabled",
    });
  }

  const secret = generateTotpSecret();
  const secretBase32 = base32Encode(secret);

  // Store secret (not yet enabled)
  const updateResult = await executeRun(
    deps.db,
    "UPDATE operators SET totp_secret = ? WHERE id = ?",
    secretBase32,
    operatorId,
  );

  if (!updateResult.ok) {
    return err({ code: "D1_ERROR", message: updateResult.error.message });
  }

  const uri = buildTotpUri(secret, opResult.value.email);

  return ok({ secret: secretBase32, uri });
}

export async function enableTotp(
  operatorId: string,
  code: string,
  deps: TotpServiceDeps,
): Promise<Result<true, TotpError>> {
  const opResult = await executeFirst<Operator>(
    deps.db,
    "SELECT * FROM operators WHERE id = ?",
    operatorId,
  );

  if (!opResult.ok) {
    return err({ code: "D1_ERROR", message: opResult.error.message });
  }
  if (opResult.value === null) {
    return err({ code: "OPERATOR_NOT_FOUND", message: "Operator not found" });
  }
  if (opResult.value.totp_enabled === 1) {
    return err({
      code: "TOTP_ALREADY_ENABLED",
      message: "TOTP is already enabled",
    });
  }
  if (!opResult.value.totp_secret) {
    return err({
      code: "TOTP_NOT_SETUP",
      message: "TOTP secret not set up. Call setup first.",
    });
  }

  const secret = base32Decode(opResult.value.totp_secret);
  const now = Math.floor(Date.now() / 1000);
  const valid = await verifyTotpCode(secret, code, now);

  if (!valid) {
    return err({ code: "INVALID_CODE", message: "Invalid TOTP code" });
  }

  const updateResult = await executeRun(
    deps.db,
    "UPDATE operators SET totp_enabled = 1 WHERE id = ?",
    operatorId,
  );

  if (!updateResult.ok) {
    return err({ code: "D1_ERROR", message: updateResult.error.message });
  }

  return ok(true);
}

export async function verifyTotpForLogin(
  operatorId: string,
  code: string,
  deps: TotpServiceDeps,
): Promise<Result<true, TotpError>> {
  const opResult = await executeFirst<Operator>(
    deps.db,
    "SELECT * FROM operators WHERE id = ?",
    operatorId,
  );

  if (!opResult.ok) {
    return err({ code: "D1_ERROR", message: opResult.error.message });
  }
  if (opResult.value === null) {
    return err({ code: "OPERATOR_NOT_FOUND", message: "Operator not found" });
  }
  if (opResult.value.totp_enabled !== 1 || !opResult.value.totp_secret) {
    return err({
      code: "TOTP_NOT_SETUP",
      message: "TOTP is not enabled for this operator",
    });
  }

  const secret = base32Decode(opResult.value.totp_secret);
  const now = Math.floor(Date.now() / 1000);
  const valid = await verifyTotpCode(secret, code, now);

  if (!valid) {
    return err({ code: "INVALID_CODE", message: "Invalid TOTP code" });
  }

  return ok(true);
}
