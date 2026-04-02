import type { Result } from "@gramstep/shared";
import { ok, err } from "@gramstep/shared";

export type CryptoError = {
  code: "CRYPTO_ERROR";
  message: string;
};

const IV_LENGTH = 12;

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function importAesKey(keyHex: string): Promise<CryptoKey> {
  const keyBytes = hexToBytes(keyHex);
  return crypto.subtle.importKey(
    "raw",
    keyBytes.buffer as ArrayBuffer,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptToken(
  plaintext: string,
  encryptionKeyHex: string,
): Promise<Result<string, CryptoError>> {
  try {
    const key = await importAesKey(encryptionKeyHex);
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const encoded = new TextEncoder().encode(plaintext);
    const encrypted = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      encoded,
    );
    const combined = new Uint8Array(IV_LENGTH + encrypted.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(encrypted), IV_LENGTH);
    return ok(bytesToBase64(combined));
  } catch (e) {
    return err({
      code: "CRYPTO_ERROR",
      message: e instanceof Error ? e.message : String(e),
    });
  }
}

export async function decryptToken(
  ciphertext: string,
  encryptionKeyHex: string,
): Promise<Result<string, CryptoError>> {
  try {
    const key = await importAesKey(encryptionKeyHex);
    const combined = base64ToBytes(ciphertext);
    const iv = combined.slice(0, IV_LENGTH);
    const data = combined.slice(IV_LENGTH);
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      data,
    );
    return ok(new TextDecoder().decode(decrypted));
  } catch (e) {
    return err({
      code: "CRYPTO_ERROR",
      message: e instanceof Error ? e.message : String(e),
    });
  }
}

export async function generateAppSecretProof(
  accessToken: string,
  appSecret: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(accessToken),
  );
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
