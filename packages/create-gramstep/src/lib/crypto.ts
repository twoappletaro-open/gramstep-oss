import { randomBytes } from "node:crypto";

/** Generate a random hex string of given byte length */
export function generateHex(byteLength: number): string {
  return randomBytes(byteLength).toString("hex");
}

/** Generate a secure API key (32 bytes = 64 hex chars) */
export function generateApiKey(): string {
  return `idp_${generateHex(32)}`;
}

/** Generate a random password (16 chars, alphanumeric + symbols) */
export function generatePassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%";
  const bytes = randomBytes(16);
  return Array.from(bytes)
    .map((b) => chars[b % chars.length] ?? "A")
    .join("");
}
