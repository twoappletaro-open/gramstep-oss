import { z } from "zod";
import type { OperatorRole } from "@gramstep/shared";

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export type LoginInput = z.infer<typeof loginSchema>;

export type LoginResponse = {
  accessToken: string;
  operator: {
    id: string;
    email: string;
    role: string;
  };
  totpRequired: boolean;
};

export type AuthError = {
  error: string;
};

export function validatePassword(password: string): boolean {
  if (password.length < 8) return false;
  const hasLetter = /[a-zA-Z]/.test(password);
  const hasDigit = /[0-9]/.test(password);
  const hasSymbol = /[^a-zA-Z0-9]/.test(password);
  return hasLetter && hasDigit && hasSymbol;
}

// ────────── RBAC Utilities ──────────

const PERMISSION_MATRIX: Record<OperatorRole, ReadonlySet<string>> = {
  admin: new Set([
    "read",
    "write",
    "delete",
    "manage_operators",
    "manage_accounts",
    "view_audit_logs",
    "manage_settings",
    "manage_api_keys",
  ]),
  operator: new Set([
    "read",
    "write",
    "delete",
  ]),
  viewer: new Set([
    "read",
  ]),
};

export function hasPermission(
  role: OperatorRole,
  permission: string,
): boolean {
  return PERMISSION_MATRIX[role]?.has(permission) ?? false;
}

export function canAccess(
  role: OperatorRole,
  allowedRoles: OperatorRole[],
): boolean {
  return allowedRoles.includes(role);
}

export function isAdmin(role: string): boolean {
  return role === "admin";
}

export function isAdminOrOperator(role: string): boolean {
  return role === "admin" || role === "operator";
}
