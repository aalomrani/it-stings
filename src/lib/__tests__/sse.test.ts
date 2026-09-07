/**
 * The SSE wire format and lifecycle. The recommend route is only as good as this file:
 * a frame that does not flush, or a producer that keeps running after the client leaves,
 * both look like "the app hung".
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  HEARTBEAT_FRAME,
  HEARTBEAT_INTERVAL_MS,
  SSE_HEADERS,
  parseSseFrames,
  sseComment,
  sseData,
  sseResponse,
  sseStream,
} from '@/lib/sse';

afterEach(() => {
  vi.useRealTimers();
});

const decoder = new TextDecoder();

/** Reads every chunk of a stream, in arrival order. */
async function drain(stream: ReadableStream<Uint8Array>): Promise<string[]> {
  const reader = stream.getReader();
  const chunks: string[] = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) chunks.push(decoder.decode(value));
  }
  return chunks;
}

describe('frame format', () => {
  it('sseData is one line of JSON followed by a blank line', () => {
    expect(sseData({ type: 'run', runId: 'run_1', cached: false })).toBe(
      'data: {"type":"run","runId":"run_1","cached":false}\n\n',
    );
  });

  it('a newline inside the payload cannot split the frame', () => {
    const frame = sseData({ message: 'line one\nline two' });
    expect(frame.split('\n\n')).toHaveLength(2);
    expect(frame.startsWith('data: ')).toBe(true);
    expect(JSON.parse(frame.slice(6).trim())).toEqual({ message: 'line one\nline two' });
  });

  it('sseComment produces a comment frame EventSource ignores', () => {
    expect(sseComment('ping')).toBe(': ping\n\n');
    expect(HEARTBEAT_FRAME).toBe(': ping\n\n');
  });

  it('parseSseFrames round-trips data and comments', () => {
    const body = sseData({ a: 1 }) + HEARTBEAT_FRAME + sseData({ b: 2 });
    expect(parseSseFrames(body)).toEqual({
      data: ['{"a":1}', '{"b":2}'],
      comments: ['ping'],
    });
  });
});

describe('headers', () => {
  it('are the no-buffering set the route needs', () => {
    expect(SSE_HEADERS['Content-Type']).toBe('text/event-stream; charset=utf-8');
    expect(SSE_HEADERS['Cache-Control']).toContain('no-store');
    expect(SSE_HEADERS['Cache-Control']).toContain('no-transform');
    expect(SSE_HEADERS['X-Accel-Buffering']).toBe('no');
  });

  it('sseResponse carries them', () => {
    const res = sseResponse((sink) => {
      sink.send({ ok: true });
    }, { heartbeatMs: 0 });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/event-stream; charset=utf-8');
    expect(res.headers.get('x-accel-buffering')).toBe('no');
  });
});

describe('streaming', () => {
  it('emits one chunk per event, in order, then closes', async () => {
    const stream = sseStream(
      async (sink) => {
        sink.send({ i: 1 });
        await Promise.resolve();
        sink.send({ i: 2 });
        sink.send({ i: 3 });
      },
      { heartbeatMs: 0 },
    );
    expect(await drain(stream)).toEqual([
      'data: {"i":1}\n\n',
      'data: {"i":2}\n\n',
      'data: {"i":3}\n\n',
    ]);
  });

  it('flushes each event as it is produced, not all at the end', async () => {
    let release = (): void => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const stream = sseStream(
      async (sink) => {
        sink.send({ i: 1 });
        await gate;
        sink.send({ i: 2 });
      },
      { heartbeatMs: 0 },
    );

    const reader = stream.getReader();
    const first = await reader.read();
    expect(decoder.decode(first.value)).toBe('data: {"i":1}\n\n');
    release();
    const second = await reader.read();
    expect(decoder.decode(second.value)).toBe('data: {"i":2}\n\n');
    expect((await reader.read()).done).toBe(true);
  });

  it('send() after close is a no-op that reports false', async () => {
    const seen: boolean[] = [];
    const stream = sseStream(
      (sink) => {
        seen.push(sink.send({ i: 1 }));
        sink.close();
        expect(sink.closed).toBe(true);
        seen.push(sink.send({ i: 2 }));
      },
      { heartbeatMs: 0 },
    );
    expect(await drain(stream)).toEqual(['data: {"i":1}\n\n']);
    expect(seen).toEqual([true, false]);
  });
});

describe('heartbeat', () => {
  it('sends ": ping" every 15 s while the producer runs', async () => {
    vi.useFakeTimers();
    let release = (): void => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const stream = sseStream(async () => {
      await gate;
    });
    const reader = stream.getReader();

    expect(HEARTBEAT_INTERVAL_MS).toBe(15_000);
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
    expect(decoder.decode((await reader.read()).value)).toBe(': ping\n\n');
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
    expect(decoder.decode((await reader.read()).value)).toBe(': ping\n\n');

    release();
    await vi.waitFor(async () => {
      expect((await reader.read()).done).toBe(true);
    });
  });

  it('stops when the stream closes', async () => {
    vi.useFakeTimers();
    const stream = sseStream((sink) => {
      sink.send({ done: true });
    }, { heartbeatMs: 1000 });
    const chunks = await drain(stream);
    vi.advanceTimersByTime(10_000);
    expect(chunks).toEqual(['data: {"done":true}\n\n']);
  });
});

describe('abort', () => {
  it('cancelling the reader aborts the producer signal', async () => {
    let aborted = false;
    let release = (): void => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const stream = sseStream(
      async (sink, signal) => {
        signal.addEventListener('abort', () => {
          aborted = true;
          release();
        });
        sink.send({ i: 1 });
        await gate;
      },
      { heartbeatMs: 0 },
    );

    const reader = stream.getReader();
    await reader.read();
    await reader.cancel();
    await vi.waitFor(() => expect(aborted).toBe(true));
  });

  it('an already-aborted upstream signal aborts the producer immediately', async () => {
    const upstream = AbortSignal.abort();
    let sawAbort = false;
    const stream = sseStream(
      (_sink, signal) => {
        sawAbort = signal.aborted;
      },
      { heartbeatMs: 0, signal: upstream },
    );
    await drain(stream);
    expect(sawAbort).toBe(true);
  });

  it('an upstream abort mid-run reaches the producer', async () => {
    const upstream = new AbortController();
    let aborted = false;
    let release = (): void => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const stream = sseStream(
      async (sink, signal) => {
        signal.addEventListener('abort', () => {
          aborted = true;
          release();
        });
        sink.send({ i: 1 });
        await gate;
      },
      { heartbeatMs: 0, signal: upstream.signal },
    );
    const reader = stream.getReader();
    await reader.read();
    upstream.abort();
    await vi.waitFor(() => expect(aborted).toBe(true));
    await reader.cancel();
  });
});

describe('producer failure', () => {
  it('sends the error event, then closes', async () => {
    const stream = sseStream(
      () => {
        throw new Error('boom');
      },
      {
        heartbeatMs: 0,
        errorEvent: (err) => ({ type: 'error', message: (err as Error).message }),
      },
    );
    expect(await drain(stream)).toEqual(['data: {"type":"error","message":"boom"}\n\n']);
  });

  it('closes cleanly with no error event when none is configured', async () => {
    const stream = sseStream(
      () => {
        throw new Error('boom');
      },
      { heartbeatMs: 0 },
    );
    expect(await drain(stream)).toEqual([]);
  });

  it('does not send an error event for an abort', async () => {
    const upstream = new AbortController();
    const stream = sseStream(
      async (sink, signal) => {
        sink.send({ i: 1 });
        upstream.abort();
        await Promise.resolve();
        if (signal.aborted) throw new Error('aborted');
      },
      {
        heartbeatMs: 0,
        signal: upstream.signal,
        errorEvent: () => ({ type: 'error', message: 'should not appear' }),
      },
    );
    expect(await drain(stream)).toEqual(['data: {"i":1}\n\n']);
  });
});
