import type { TemplateType, PackageBody, PackageButton } from "@gramstep/shared";
import { PackageBodySchema } from "@gramstep/shared";

export const PACKAGE_BUTTON_PAYLOAD_PREFIX = "pkgbtn";

export type PackageButtonPayload = {
  packageId: string;
  buttonId: string;
};

export function serializePackageBody(text: string, buttons: PackageButton[]): string {
  return JSON.stringify({
    version: 1,
    kind: "package",
    text,
    buttons,
  } satisfies PackageBody);
}

export function parsePackageBody(body: string): PackageBody | null {
  try {
    const parsed = JSON.parse(body) as unknown;
    const result = PackageBodySchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export function isPackageBody(body: string): boolean {
  return parsePackageBody(body) !== null;
}

export function packageTemplateType(buttons: PackageButton[]): TemplateType {
  return buttons.length > 0 ? "quick_reply" : "text";
}

export function buildPackageButtonPayload(packageId: string, buttonId: string): string {
  return `${PACKAGE_BUTTON_PAYLOAD_PREFIX}:${packageId}:${buttonId}`;
}

export function parsePackageButtonPayload(payload: string | null | undefined): PackageButtonPayload | null {
  if (!payload) return null;
  const [prefix, packageId, buttonId] = payload.split(":");
  if (prefix !== PACKAGE_BUTTON_PAYLOAD_PREFIX || !packageId || !buttonId) {
    return null;
  }
  return { packageId, buttonId };
}

