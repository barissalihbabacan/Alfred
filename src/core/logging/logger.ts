/**
 * Minimal structured logger.
 *
 * Writes one JSON object per line, using the field names Cloud Logging treats
 * specially (`severity`, `message`), so that on Cloud Run / Cloud Functions each
 * line is parsed into `jsonPayload`. WARNING and above go to stderr, the rest to
 * stdout, mirroring `firebase-functions/logger`.
 *
 * The event vocabulary matches the production backend (`functions/index.js`),
 * so a query such as `jsonPayload.event="llm_request"` means the same thing
 * wherever the log came from.
 *
 * Never pass API keys, ID tokens, full user messages or memory contents as fields.
 */

export type LogSeverity = "DEBUG" | "INFO" | "WARNING" | "ERROR";

export const LOG_EVENTS = [
  "llm_request",
  "tool_call",
  "memory_retrieval",
  "memory_extraction"
] as const;

export type LogEventName = (typeof LOG_EVENTS)[number];

export type LogFields = Record<string, unknown>;

export interface LogEntry extends LogFields {
  severity: LogSeverity;
  message: string;
  event?: string;
  timestamp: string;
}

export type LogSink = (line: string, severity: LogSeverity) => void;

const SEVERITY_RANK: Record<LogSeverity, number> = {
  DEBUG: 0,
  INFO: 1,
  WARNING: 2,
  ERROR: 3
};

/** Fields whose names suggest a secret; their values are replaced before writing. */
const SECRET_FIELD_PATTERN = /(api[_-]?key|token|secret|password|authorization)/i;

/** Token-count fields are metrics, not secrets. */
const SAFE_TOKEN_FIELD_PATTERN = /_tokens$/i;

export const defaultSink: LogSink = (line, severity) => {
  const stream = SEVERITY_RANK[severity] >= SEVERITY_RANK.WARNING ? process.stderr : process.stdout;
  stream.write(line + "\n");
};

export interface StructuredLoggerOptions {
  /** Entries below this severity are dropped. Defaults to INFO. */
  minSeverity?: LogSeverity;
  sink?: LogSink;
  /** Fields merged into every entry (e.g. `{ service: "alfred-core" }`). */
  baseFields?: LogFields;
  now?: () => Date;
}

function sanitize(fields: LogFields): LogFields {
  const out: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    if (SECRET_FIELD_PATTERN.test(key) && !SAFE_TOKEN_FIELD_PATTERN.test(key)) {
      out[key] = "[REDACTED]";
    } else if (value instanceof Error) {
      out[key] = value.message;
    } else {
      out[key] = value;
    }
  }
  return out;
}

export class StructuredLogger {
  private readonly minRank: number;
  private readonly sink: LogSink;
  private readonly baseFields: LogFields;
  private readonly now: () => Date;

  constructor(options: StructuredLoggerOptions = {}) {
    this.minRank = SEVERITY_RANK[options.minSeverity ?? "INFO"];
    this.sink = options.sink ?? defaultSink;
    this.baseFields = options.baseFields ?? {};
    this.now = options.now ?? (() => new Date());
  }

  log(severity: LogSeverity, message: string, fields: LogFields = {}): void {
    if (SEVERITY_RANK[severity] < this.minRank) return;
    const entry: LogEntry = {
      ...sanitize({ ...this.baseFields, ...fields }),
      severity,
      message,
      timestamp: this.now().toISOString()
    };
    let line: string;
    try {
      line = JSON.stringify(entry);
    } catch {
      // Circular or otherwise unserialisable fields: keep the message, drop the rest.
      line = JSON.stringify({ severity, message, event: entry.event, timestamp: entry.timestamp });
    }
    this.sink(line, severity);
  }

  debug(message: string, fields?: LogFields): void {
    this.log("DEBUG", message, fields);
  }

  info(message: string, fields?: LogFields): void {
    this.log("INFO", message, fields);
  }

  warn(message: string, fields?: LogFields): void {
    this.log("WARNING", message, fields);
  }

  error(message: string, fields?: LogFields): void {
    this.log("ERROR", message, fields);
  }

  /** Logs an operational event with a stable `event` field. */
  event(event: LogEventName, message: string, fields: LogFields = {}, severity: LogSeverity = "INFO"): void {
    this.log(severity, message, { ...fields, event });
  }

  /** Returns a logger that adds `fields` to every entry. */
  child(fields: LogFields): StructuredLogger {
    return new StructuredLogger({
      minSeverity: (Object.keys(SEVERITY_RANK) as LogSeverity[])[this.minRank],
      sink: this.sink,
      baseFields: { ...this.baseFields, ...fields },
      now: this.now
    });
  }
}

let defaultLogger: StructuredLogger | null = null;

export function getLogger(): StructuredLogger {
  if (!defaultLogger) defaultLogger = new StructuredLogger();
  return defaultLogger;
}
