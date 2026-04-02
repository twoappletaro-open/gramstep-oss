export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  readonly level: LogLevel;
  readonly message: string;
  readonly timestamp: string;
  readonly service: string;
  readonly correlationId?: string;
  readonly requestId?: string;
  readonly [key: string]: unknown;
}

export interface StructuredLogger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
  child(fields: Record<string, unknown>): StructuredLogger;
}

export interface LoggerOptions {
  readonly service: string;
  readonly correlationId?: string;
  readonly requestId?: string;
  readonly minLevel?: LogLevel;
}

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function serializeError(error: Error): Record<string, unknown> {
  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
  };
}

/** PIIを含む可能性のあるフィールド名 */
const PII_FIELD_NAMES = new Set([
  "username", "ig_username", "igUsername", "display_name", "displayName",
  "ig_scoped_id", "igScopedId", "sender_id", "senderId", "recipient_id", "recipientId",
  "message", "text", "message_text", "messageText",
]);

function processFields(fields: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value instanceof Error) {
      result[key] = serializeError(value);
    } else if (PII_FIELD_NAMES.has(key) && typeof value === "string") {
      result[key] = maskPii(value, inferPiiType(key));
    } else {
      result[key] = value;
    }
  }
  return result;
}

function inferPiiType(key: string): "message" | "username" | "id" {
  if (key === "message" || key === "text" || key === "message_text" || key === "messageText") return "message";
  if (key.includes("id") || key.includes("Id")) return "id";
  return "username";
}

function createLoggerImpl(
  options: LoggerOptions,
  extraFields: Record<string, unknown>,
): StructuredLogger {
  const minPriority = LOG_LEVEL_PRIORITY[options.minLevel ?? "info"];

  function emit(level: LogLevel, message: string, fields?: Record<string, unknown>): void {
    if (LOG_LEVEL_PRIORITY[level] < minPriority) return;

    const entry: Record<string, unknown> = {
      level,
      message,
      timestamp: new Date().toISOString(),
      service: options.service,
    };

    if (options.correlationId !== undefined) {
      entry.correlationId = options.correlationId;
    }
    if (options.requestId !== undefined) {
      entry.requestId = options.requestId;
    }

    Object.assign(entry, extraFields);

    if (fields !== undefined) {
      Object.assign(entry, processFields(fields));
    }

    console.log(JSON.stringify(entry));
  }

  return {
    debug: (message, fields) => emit("debug", message, fields),
    info: (message, fields) => emit("info", message, fields),
    warn: (message, fields) => emit("warn", message, fields),
    error: (message, fields) => emit("error", message, fields),
    child: (fields) => createLoggerImpl(options, { ...extraFields, ...fields }),
  };
}

export function createLogger(options: LoggerOptions): StructuredLogger {
  return createLoggerImpl(options, {});
}

/**
 * PIIマスキング: ユーザー名・IGスコープID・メッセージ内容をマスクする
 */
export function maskPii(value: string, type?: "message" | "username" | "id"): string {
  if (value === "") return "";

  if (type === "message") {
    return `[REDACTED:${value.length}chars]`;
  }

  if (type === "id") {
    // 数字のみ（IGスコープID等）: 先頭3文字 + *** + 末尾4文字
    if (/^\d+$/.test(value) && value.length > 7) {
      return `${value.slice(0, 3)}***${value.slice(-4)}`;
    }
    // 短いIDまたは非数字ID: 先頭2文字 + ***
    if (value.length > 4) {
      return `${value.slice(0, 2)}***`;
    }
    return "***";
  }

  if (type === "username") {
    // user_プレフィックス保持
    if (value.startsWith("user_")) {
      return "user_***";
    }
    // 一般ユーザー名: 先頭2文字 + ***
    if (value.length > 2) {
      return `${value.slice(0, 2)}***`;
    }
    return "***";
  }

  // type未指定: ヒューリスティック判定
  if (/^\d+$/.test(value) && value.length > 7) {
    return `${value.slice(0, 3)}***${value.slice(-4)}`;
  }
  if (value.startsWith("user_")) {
    return "user_***";
  }

  return value;
}
