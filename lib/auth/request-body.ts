export const AUTH_BODY_MAX_BYTES = 16 * 1024;
export const AUTH_BODY_TIMEOUT_MS = 10_000;
export const AUTH_JSON_MAX_DEPTH = 8;
export const AUTH_JSON_MAX_NODES = 256;
export const AUTH_JSON_MAX_COLLECTION_ENTRIES = 64;
export const AUTH_JSON_MAX_COLLECTIONS = 64;

type AuthBodyFailure = { ok: false; status: 400 | 408 | 413 };
export type AuthBodyResult =
  | { ok: true; body: Uint8Array | null; json: unknown }
  | AuthBodyFailure;

function cancel(stream: ReadableStream<Uint8Array> | ReadableStreamDefaultReader<Uint8Array> | null) {
  // A hostile/stalled underlying stream must not delay the rejection itself.
  try { void stream?.cancel().catch(() => undefined); } catch { /* Already closed or locked. */ }
}

function boundedJsonComplexity(value: unknown) {
  const pending = [{ value, depth: 1 }];
  let nodes = 0;
  let collections = 0;
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (++nodes > AUTH_JSON_MAX_NODES || current.depth > AUTH_JSON_MAX_DEPTH) return false;
    if (current.value === null || typeof current.value !== "object") continue;
    if (++collections > AUTH_JSON_MAX_COLLECTIONS) return false;
    const values = Array.isArray(current.value)
      ? current.value
      : Object.values(current.value as Record<string, unknown>);
    if (values.length > AUTH_JSON_MAX_COLLECTION_ENTRIES
      || nodes + pending.length + values.length > AUTH_JSON_MAX_NODES) return false;
    for (const child of values) pending.push({ value: child, depth: current.depth + 1 });
  }
  return true;
}

/**
 * Read once before any auth parser or schema sees the body. The returned bytes
 * remain unchanged so callers can rebuild the original JSON/form request.
 * timeoutMs is an internal test seam: it may only shorten the ten-second cap.
 */
export async function readAuthBody(
  request: Request,
  options: Readonly<{ timeoutMs?: number }> = {},
): Promise<AuthBodyResult> {
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    if (!/^\d+$/.test(declared) || !Number.isSafeInteger(Number(declared))) {
      cancel(request.body);
      return { ok: false, status: 400 };
    }
    if (Number(declared) > AUTH_BODY_MAX_BYTES) {
      cancel(request.body);
      return { ok: false, status: 413 };
    }
  }
  if (request.signal.aborted) {
    cancel(request.body);
    return { ok: false, status: 408 };
  }
  if (!request.body) return { ok: true, body: null, json: null };

  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try { reader = request.body.getReader(); } catch { return { ok: false, status: 400 }; }
  const chunks: Uint8Array[] = [];
  let received = 0;
  let completed = false;
  let interrupted = false;
  let resolveInterruption!: (failure: AuthBodyFailure) => void;
  const interruption = new Promise<AuthBodyFailure>((resolve) => { resolveInterruption = resolve; });
  const interrupt = () => {
    if (interrupted) return;
    interrupted = true;
    resolveInterruption({ ok: false, status: 408 });
    cancel(reader);
  };
  const requestedTimeout = options.timeoutMs;
  const timeoutMs = typeof requestedTimeout === "number" && Number.isFinite(requestedTimeout)
    ? Math.max(1, Math.min(AUTH_BODY_TIMEOUT_MS, requestedTimeout))
    : AUTH_BODY_TIMEOUT_MS;
  const timer = setTimeout(interrupt, timeoutMs);
  request.signal.addEventListener("abort", interrupt, { once: true });
  if (request.signal.aborted) interrupt();

  try {
    while (true) {
      const next = await Promise.race([
        reader.read().then(
          (result) => ({ ok: true as const, result }),
          () => ({ ok: false as const, status: 400 as const }),
        ),
        interruption,
      ]);
      if (!next.ok) return next;
      if (next.result.done) { completed = true; break; }
      const chunk = next.result.value;
      if (!(chunk instanceof Uint8Array)) return { ok: false, status: 400 };
      if (chunk.byteLength === 0) continue;
      received += chunk.byteLength;
      if (received > AUTH_BODY_MAX_BYTES) return { ok: false, status: 413 };
      chunks.push(chunk);
    }

    const body = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    let json: unknown = null;
    try { json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)) as unknown; }
    catch { /* Form bodies and malformed JSON remain available to the existing parser. */ }
    if (!boundedJsonComplexity(json)) return { ok: false, status: 400 };
    return { ok: true, body, json };
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener("abort", interrupt);
    if (!completed) cancel(reader);
    try { reader.releaseLock(); } catch { /* A pending read can retain the lock during cancellation. */ }
  }
}
