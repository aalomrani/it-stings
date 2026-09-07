/**
 * Server-sent events: the one place that knows the wire format.
 *
 * `GET /api/recommend` is the only consumer today, but nothing here knows about the
 * pipeline — it takes a producer function, hands it a sink, and turns whatever it sends
 * into `data: <json>\n\n` frames on a `ReadableStream`.
 *
 * Three things this file exists to get right:
 *   - flush per event (verified in api-reality.md §(c): Next dev and start both stream
 *     route-handler chunks incrementally; `X-Accel-Buffering: no` keeps a proxy from
 *     re-buffering them),
 *   - a heartbeat comment so an idle connection is not reaped mid-pipeline,
 *   - abort: when the client disconnects the producer is told, so a long pipeline stops
 *     doing work nobody is waiting for.
 */

/** Headers every SSE response must carry. `no-transform` stops compression re-buffering. */
export const SSE_HEADERS: Record<string, string> = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-store, no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
};

/** docs/tasks/phase1-playlists-placeholder.md: `: ping` every 15 s while running. */
export const HEARTBEAT_INTERVAL_MS = 15_000;
export const HEARTBEAT_FRAME = ': ping\n\n';

/** One event frame. JSON on a single line — a newline inside would split the frame. */
export function sseData(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

/** An SSE comment line; ignored by `EventSource`, keeps the socket warm. */
export function sseComment(text: string): string {
  return `: ${text.replace(/\r?\n/g, ' ')}\n\n`;
}

export interface SseSink {
  /** Sends one `data:` frame. Returns false if the stream is already closed. */
  send(payload: unknown): boolean;
  /** Sends a comment frame. Returns false if the stream is already closed. */
  comment(text: string): boolean;
  /** Ends the stream. Idempotent. */
  close(): void;
  readonly closed: boolean;
}

export type SseProducer = (sink: SseSink, signal: AbortSignal) => void | Promise<void>;

export interface SseOptions {
  /** 0 disables the heartbeat. */
  heartbeatMs?: number;
  /** The request's signal — the producer is aborted when the client goes away. */
  signal?: AbortSignal;
  /**
   * Last frame sent when the producer throws. Return `undefined` to send nothing.
   * The stream always closes afterwards.
   */
  errorEvent?: (error: unknown) => unknown;
}

/**
 * Builds the stream. The producer starts as soon as the stream is CONSTRUCTED — the
 * `ReadableStream` constructor calls `start()` immediately, before any `read()` — and the
 * stream closes when the producer resolves, when it throws, or when the client cancels.
 *
 * Eager start is the right behaviour for SSE (the run should begin the moment the request
 * arrives), but it is also why a disconnected client costs real work unless the producer
 * honours the signal: by the time the first `read()` returns, the pipeline is already
 * verifying.
 */
export function sseStream(producer: SseProducer, opts: SseOptions = {}): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const heartbeatMs = opts.heartbeatMs ?? HEARTBEAT_INTERVAL_MS;
  const controllerAbort = new AbortController();

  let closed = false;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let onUpstreamAbort: (() => void) | null = null;

  const cleanup = (): void => {
    if (heartbeat !== null) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
    if (onUpstreamAbort && opts.signal) {
      opts.signal.removeEventListener('abort', onUpstreamAbort);
      onUpstreamAbort = null;
    }
  };

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (frame: string): boolean => {
        if (closed) return false;
        try {
          controller.enqueue(encoder.encode(frame));
          return true;
        } catch {
          // The consumer went away between our check and the enqueue.
          closed = true;
          cleanup();
          return false;
        }
      };

      const finish = (): void => {
        if (closed) return;
        closed = true;
        cleanup();
        try {
          controller.close();
        } catch {
          /* already closed by a cancel() racing us */
        }
      };

      const sink: SseSink = {
        send: (payload) => write(sseData(payload)),
        comment: (text) => write(sseComment(text)),
        close: finish,
        get closed() {
          return closed;
        },
      };

      if (opts.signal) {
        if (opts.signal.aborted) controllerAbort.abort();
        else {
          onUpstreamAbort = () => controllerAbort.abort();
          opts.signal.addEventListener('abort', onUpstreamAbort, { once: true });
        }
      }

      if (heartbeatMs > 0) {
        heartbeat = setInterval(() => {
          if (!write(HEARTBEAT_FRAME)) cleanup();
        }, heartbeatMs);
        (heartbeat as { unref?: () => void }).unref?.();
      }

      void (async () => {
        try {
          await producer(sink, controllerAbort.signal);
        } catch (error) {
          if (!closed && !controllerAbort.signal.aborted && opts.errorEvent) {
            const payload = opts.errorEvent(error);
            if (payload !== undefined) write(sseData(payload));
          }
        } finally {
          finish();
        }
      })();
    },
    cancel() {
      // The client disconnected: stop the producer, stop the heartbeat.
      closed = true;
      cleanup();
      controllerAbort.abort();
    },
  });
}

/** The stream, wrapped in a `Response` with the right headers. */
export function sseResponse(producer: SseProducer, opts: SseOptions = {}): Response {
  return new Response(sseStream(producer, opts), { status: 200, headers: SSE_HEADERS });
}

/** Reads a whole SSE body into its frames. Test/CLI helper; not used by the app. */
export function parseSseFrames(body: string): { data: string[]; comments: string[] } {
  const data: string[] = [];
  const comments: string[] = [];
  for (const frame of body.split('\n\n')) {
    const line = frame.trim();
    if (line.length === 0) continue;
    if (line.startsWith('data:')) data.push(line.slice('data:'.length).trim());
    else if (line.startsWith(':')) comments.push(line.slice(1).trim());
  }
  return { data, comments };
}
