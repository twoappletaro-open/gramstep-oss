export type AppErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "WINDOW_EXPIRED"
  | "TOKEN_EXPIRED"
  | "INSTAGRAM_API_ERROR"
  | "D1_ERROR"
  | "INTERNAL_ERROR"
  | "DUPLICATE"
  | "EXPIRED"
  | "EXTERNAL_ERROR"
  | "EXTERNAL_API_ERROR"
  | "BROADCAST_LIMIT_EXCEEDED"
  | "HEALTH_DANGER";

export interface AppError {
  readonly code: AppErrorCode;
  readonly message: string;
  readonly details?: Record<string, unknown>;
}

export function createAppError(
  code: AppErrorCode,
  message: string,
  details?: Record<string, unknown>,
): AppError {
  return { code, message, details };
}

export const IG_API_ERROR_CODES = {
  RATE_LIMIT: 613,
  SERVICE_UNAVAILABLE: 2,
  TOKEN_EXPIRED: 190,
  WINDOW_EXPIRED: 551,
  INVALID_PARAM: 100,
  PERMISSION_DENIED: 10,
} as const;

export type IgApiErrorCode = (typeof IG_API_ERROR_CODES)[keyof typeof IG_API_ERROR_CODES];

export function isRetryableIgError(code: number): boolean {
  return code === IG_API_ERROR_CODES.RATE_LIMIT || code === IG_API_ERROR_CODES.SERVICE_UNAVAILABLE;
}
