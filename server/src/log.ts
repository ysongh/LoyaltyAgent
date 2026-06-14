/**
 * Secret-redacting logger.
 *
 * Any object key that looks like key-share / secret material is replaced with
 * "[REDACTED]" before printing — so even an accidental `log.info("x", wallet)`
 * cannot leak `secretShare`/`shares`. The discipline is still to never pass
 * secrets in; this is the safety net.
 */
const SECRET_KEYS = new Set(
  [
    "secretshare",
    "secretshares",
    "shares",
    "externalserverkeyshares",
    "externalkeyshareswithbackupstatus",
    "rawpublickey",
    "secret",
    "privatekey",
    "private_key",
    "servicerolekey",
    "supabaseservicerolekey",
    "authtoken",
    "dynamicauthtoken",
    "telegrambottoken",
    "signature",
  ].map((k) => k.toLowerCase()),
);

const REDACTED = "[REDACTED]";

function redact(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value as object)) return "[Circular]";
  seen.add(value as object);

  if (Array.isArray(value)) return value.map((v) => redact(v, seen));

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SECRET_KEYS.has(k.toLowerCase()) ? REDACTED : redact(v, seen);
  }
  return out;
}

type Level = "INFO" | "WARN" | "ERROR";

function emit(level: Level, msg: string, meta?: unknown): void {
  const line = `[${new Date().toISOString()}] [${level}] ${msg}`;
  if (meta === undefined) {
    console.log(line);
    return;
  }
  console.log(line, JSON.stringify(redact(meta, new WeakSet())));
}

export const log = {
  info: (msg: string, meta?: unknown) => emit("INFO", msg, meta),
  warn: (msg: string, meta?: unknown) => emit("WARN", msg, meta),
  error: (msg: string, meta?: unknown) => emit("ERROR", msg, meta),
  /** Exposed for tests/inspection of the redaction logic. */
  _redact: (v: unknown) => redact(v, new WeakSet()),
};
