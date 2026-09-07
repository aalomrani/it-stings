/**
 * `GET /api/recommend?seed=<trackKey>&sameArtist=0|1` -> `text/event-stream`.
 *
 * One `data: <PipelineEvent JSON>\n\n` per event, a `: ping` comment every 15 s, closed
 * right after `stage done`. The client disconnecting aborts the pipeline rather than
 * leaving it to finish into a socket nobody is reading.
 *
 * `force-dynamic` because the whole point is a live stream; api-reality.md §(c) confirms
 * Next 16.3 flushes route-handler chunks incrementally in both `dev` and `start`, and the
 * `X-Accel-Buffering: no` header (in `SSE_HEADERS`) keeps a proxy from undoing that.
 *
 * Two things happen here and nowhere else, because this is the only route that spends
 * money:
 *   - THE COST CAPS. A run that will actually execute is charged against the instance's
 *     day budget and the caller's hourly one before the stream opens; a cache replay is
 *     charged nothing, because it makes no model call and no external request. A refusal
 *     is an `error` event on a normal stream, not an HTTP status: the UI has one place it
 *     shows what went wrong and this is a sentence for that place.
 *   - THE PREVIOUS FINGERPRINT. When the listener has struck a field, Stage 2 is handed
 *     the fingerprint of the last run for this seed, so the correction prompt quotes back
 *     the reading they actually rejected rather than an older uncorrected one.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';

import * as counters from '@/lib/db/repos/counters';
import * as runsRepo from '@/lib/db/repos/runs';
import { ENGINE_VERSION, runCacheHash, runPipeline } from '@/lib/engine/pipeline';
import { clientIp } from '@/lib/gate';
import { sseResponse } from '@/lib/sse';
import {
  RunOptionsSchema,
  type Fingerprint,
  type PipelineEvent,
  type RunOptions,
} from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * `corrections` is url-encoded JSON (docs/architecture.md's route table). It is parsed
 * against the shared `RunOptions` schema — an unknown fingerprint field or a non-string
 * value is a 400, not a silently discarded parameter. It is part of the run cache key, so
 * correcting the fingerprint always produces a fresh run.
 */
const CorrectionsSchema = RunOptionsSchema.shape.corrections;

const Query = z.object({
  seed: z.string().trim().min(1, 'seed is required'),
  sameArtist: z
    .string()
    .optional()
    .transform((v) => v === '1' || v?.toLowerCase() === 'true'),
  corrections: z
    .string()
    .optional()
    .transform((raw, ctx) => {
      if (raw === undefined || raw.trim().length === 0) return undefined;
      let json: unknown;
      try {
        json = JSON.parse(raw);
      } catch {
        ctx.addIssue({ code: 'custom', message: 'corrections must be url-encoded JSON' });
        return undefined;
      }
      const result = CorrectionsSchema.safeParse(json);
      if (!result.success) {
        ctx.addIssue({
          code: 'custom',
          message: `corrections: ${result.error.issues.map((i) => i.message).join('; ')}`,
        });
        return undefined;
      }
      return result.data;
    }),
});

/**
 * Would this request be answered out of the run cache? The pipeline asks `runs` the same
 * question with the same key a moment later; asking it here is what keeps a replay from
 * spending a run of the day's budget.
 *
 * A database that cannot answer is treated as "not cached": the run then charges for
 * itself, which is the safe direction — the alternative is a broken cache silently
 * removing the spending limit.
 */
function wouldReplay(seedKey: string, options: RunOptions): boolean {
  try {
    return runsRepo.find(seedKey, runCacheHash(options), ENGINE_VERSION) !== null;
  } catch {
    return false;
  }
}

/**
 * The fingerprint the listener was looking at when they struck a field: the most recent
 * run for this seed, whatever options produced it. Without it Stage 2 falls back to the
 * stored UNCORRECTED row, so on a second round of corrections the prompt would quote a
 * reading the listener never saw (docs/tasks/phase3-engine.md, F15).
 */
function previousFingerprint(seedKey: string): Fingerprint | null {
  try {
    return runsRepo.latestForSeed(seedKey)?.fingerprint ?? null;
  } catch {
    return null;
  }
}

/** A refusal is a normal stream carrying one `error` event, then end. */
function refusal(message: string): Response {
  return sseResponse((sink) => {
    sink.send({ type: 'error', message } satisfies PipelineEvent);
    sink.close();
  });
}

export function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const parsed = Query.safeParse({
    seed: params.get('seed') ?? undefined,
    sameArtist: params.get('sameArtist') ?? undefined,
    corrections: params.get('corrections') ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'invalid query',
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const seedKey = parsed.data.seed;
  const options: RunOptions = {
    includeSameArtist: parsed.data.sameArtist,
    ...(parsed.data.corrections ? { corrections: parsed.data.corrections } : {}),
  };

  // Cached replays cost nothing and count for nothing (docs/tasks/phase7-ship.md §5).
  if (!wouldReplay(seedKey, options)) {
    // A counters table that cannot be written is not a reason to refuse the listener a
    // run; the pipeline reports whatever is wrong with the database on its own.
    let verdict = { ok: true } as ReturnType<typeof counters.consumeRunBudget>;
    try {
      verdict = counters.consumeRunBudget(clientIp(request.headers));
    } catch {
      verdict = { ok: true };
    }
    if (!verdict.ok) return refusal(verdict.message);
  }

  const previous = options.corrections ? previousFingerprint(seedKey) : null;

  return sseResponse(
    async (sink, signal) => {
      await runPipeline({
        seedKey,
        options,
        signal,
        ...(previous ? { previous } : {}),
        onEvent: (event: PipelineEvent) => {
          sink.send(event);
        },
      });
    },
    {
      signal: request.signal,
      // A failed run still owes the client an explanation before the stream closes.
      errorEvent: (error): PipelineEvent => ({
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
      }),
    },
  );
}
