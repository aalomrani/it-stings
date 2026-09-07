'use client';

/**
 * `GET /api/recommend` reduced into one render-ready object.
 *
 * The documented order (docs/architecture.md, "Streaming protocol") is
 * `run → stage resolve → seed → stage fingerprint → fingerprint → channel start/done →
 * result… → verified → stage rank → final → stage done`, and provisional `result` events
 * arrive BEFORE that channel's `verified` tally, because kept/dropped is not knowable
 * until the last candidate lands. So: append results in arrival order, then re-sort to
 * `final.results` in one step when it lands. No eased reflow — this direction has exactly
 * one moving thing per page and it is the scoring blot.
 *
 * The stream is closed by us the moment `stage done` (or `final`) arrives: an EventSource
 * left open after the server closes reconnects on its own and would re-run the pipeline.
 */

import { useEffect, useReducer } from 'react';

import type {
  Channel,
  Fingerprint,
  FingerprintField,
  PipelineEvent,
  PipelineStage,
  Recommendation,
  RunRecord,
  ScoredDimension,
  TrackRecord,
} from '@/lib/types';

export type StageStatus = 'todo' | 'now' | 'done' | 'error';

export interface ChannelState {
  status: 'idle' | 'start' | 'done' | 'skipped' | 'error';
  found: number | null;
  reason: string | null;
  kept: number | null;
  dropped: number | null;
}

export interface RunState {
  runId: string | null;
  cached: boolean;
  stages: Record<PipelineStage, StageStatus>;
  seed: TrackRecord | null;
  fingerprint: Fingerprint | null;
  channels: Record<Channel, ChannelState>;
  /** Provisional results, in arrival order, deduped by track key. */
  provisional: Recommendation[];
  /** The ranked list. Once this lands it replaces `provisional` in the UI. */
  final: Recommendation[] | null;
  degraded: string[];
  stats: RunRecord['stats'] | null;
  error: string | null;
  streaming: boolean;
  /** True while the run is a new song still being worked on server-side and we are
   *  retrying to pick up its result — a soft "still finding matches", never a hard error. */
  pending: boolean;
}

export const STAGE_ORDER: PipelineStage[] = [
  'resolve',
  'fingerprint',
  'channels',
  'verify',
  'score',
  'rank',
  'done',
];

/** The receipt line's word for each stage. `score` prints as `scoring`, as in the mockup. */
export const STAGE_LABEL: Record<PipelineStage, string> = {
  resolve: 'resolve',
  fingerprint: 'fingerprint',
  channels: 'channels',
  verify: 'verify',
  score: 'scoring',
  rank: 'rank',
  done: 'done',
};

/** What each channel is, spelled out on the detail line. Keyless wording: Channel B is
 *  MusicBrainz tag cohorts and Channel C is Deezer related-artists — the old "web search"
 *  and "model prior" were the LLM era's names and both are gone from the engine. */
export const CHANNEL_LABEL: Record<Channel, string> = {
  A: 'last.fm',
  B: 'musicbrainz tags',
  C: 'deezer related',
};

function emptyChannel(): ChannelState {
  return { status: 'idle', found: null, reason: null, kept: null, dropped: null };
}

export function emptyRun(): RunState {
  return {
    runId: null,
    cached: false,
    stages: {
      resolve: 'todo',
      fingerprint: 'todo',
      channels: 'todo',
      verify: 'todo',
      score: 'todo',
      rank: 'todo',
      done: 'todo',
    },
    seed: null,
    fingerprint: null,
    channels: { A: emptyChannel(), B: emptyChannel(), C: emptyChannel() },
    provisional: [],
    final: null,
    degraded: [],
    stats: null,
    error: null,
    streaming: false,
    pending: false,
  };
}

type Action =
  | { kind: 'reset' }
  | { kind: 'open' }
  | { kind: 'pending' }
  | { kind: 'closed'; unexpected: boolean }
  | { kind: 'event'; event: PipelineEvent };

function reduce(state: RunState, action: Action): RunState {
  switch (action.kind) {
    case 'reset':
      return emptyRun();
    case 'open':
      return { ...state, streaming: true };
    case 'pending':
      // A new song is still being worked on server-side; we are waiting to retry. Soft
      // state, never the hard "stream closed" error.
      return { ...state, streaming: false, pending: true, error: null };
    case 'closed':
      if (!action.unexpected) return { ...state, streaming: false, pending: false };
      return {
        ...state,
        streaming: false,
        pending: false,
        error:
          state.error ??
          (state.final
            ? null
            : 'the stream closed before the run finished — nothing below is complete'),
      };
    case 'event':
      // Any real pipeline event means the run is streaming to us for real now, so the
      // "still working" state is over.
      return { ...apply(state, action.event), pending: false };
  }
}

function apply(state: RunState, event: PipelineEvent): RunState {
  switch (event.type) {
    case 'run':
      return { ...state, runId: event.runId, cached: event.cached };

    case 'stage': {
      const status: StageStatus =
        event.status === 'start' ? 'now' : event.status === 'done' ? 'done' : 'error';
      const stages = { ...state.stages, [event.stage]: status };
      // A stage that starts implies every earlier one finished, even if its `done` was
      // swallowed: the receipt must never show a later stage running behind an idle one.
      if (event.status === 'start') {
        for (const stage of STAGE_ORDER) {
          if (stage === event.stage) break;
          if (stages[stage] === 'todo' || stages[stage] === 'now') stages[stage] = 'done';
        }
      }
      return { ...state, stages };
    }

    case 'seed':
      return { ...state, seed: event.track };

    case 'fingerprint':
      return { ...state, fingerprint: event.fingerprint };

    case 'channel': {
      const prev = state.channels[event.channel];
      return {
        ...state,
        channels: {
          ...state.channels,
          [event.channel]: {
            ...prev,
            status: event.status,
            found: event.found ?? prev.found,
            reason: event.reason ?? prev.reason,
          },
        },
      };
    }

    case 'verified': {
      const prev = state.channels[event.channel];
      return {
        ...state,
        channels: {
          ...state.channels,
          [event.channel]: { ...prev, kept: event.kept, dropped: event.dropped },
        },
      };
    }

    case 'result': {
      if (state.provisional.some((r) => r.track.key === event.item.track.key)) return state;
      return { ...state, provisional: [...state.provisional, event.item] };
    }

    case 'final':
      return {
        ...state,
        final: event.results,
        degraded: mergeDegraded(state.degraded, event.degraded),
        stats: event.stats,
      };

    case 'error':
      return { ...state, error: event.message };

    case 'pending':
      // Handled by the stream loop (triggers a retry), never fed through here; a no-op keeps
      // the switch exhaustive.
      return state;
  }
}

export function mergeDegraded(a: string[], b: string[]): string[] {
  const out = [...a];
  for (const line of b) if (!out.includes(line)) out.push(line);
  return out;
}

export interface StreamArgs {
  seedKey: string | null;
  sameArtist: boolean;
  corrections: Partial<Record<FingerprintField, string>>;
  /** Diff-from-default scored weights; empty means "score with the engine defaults". */
  weights: Partial<Record<ScoredDimension, number>>;
}

/** The url the stream is opened on — also what the provenance foot quotes. */
export function recommendUrl(args: StreamArgs): string | null {
  if (!args.seedKey) return null;
  const params = new URLSearchParams({
    seed: args.seedKey,
    sameArtist: args.sameArtist ? '1' : '0',
  });
  if (Object.keys(args.corrections).length > 0) {
    params.set('corrections', JSON.stringify(args.corrections));
  }
  // A weight change is a free cache replay: it re-ranks the same scored pool, off the run
  // budget, so the results page may re-open the stream on it freely. Omitted when empty —
  // an empty object is not the "use defaults" signal, an absent param is.
  if (Object.keys(args.weights).length > 0) {
    params.set('weights', JSON.stringify(args.weights));
  }
  return `/api/recommend?${params.toString()}`;
}

/** How many times to retry a new song whose run is still finishing, and how long to wait. */
export const MAX_RETRIES = 18;
export const RETRY_DELAY_MS = 12_000;

export function useRecommendStream(args: StreamArgs): RunState {
  const [state, dispatch] = useReducer(reduce, undefined, emptyRun);
  const url = recommendUrl(args);

  useEffect(() => {
    dispatch({ kind: 'reset' });
    if (!url) return;

    let attempt = 0;
    let source: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let finished = false; // a real `final`/`done` landed — stop for good
    let cancelled = false; // unmounted or the url changed

    const clearTimer = (): void => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    };

    // The run for a NEW song keeps going server-side even when the host cuts our stream, so
    // a drop or an explicit `pending` is not a failure — wait, then re-open. Once the run
    // caches, a retry returns the full result instantly.
    const scheduleRetry = (): void => {
      if (cancelled || finished) return;
      if (attempt >= MAX_RETRIES) {
        dispatch({ kind: 'closed', unexpected: true });
        return;
      }
      attempt += 1;
      dispatch({ kind: 'pending' });
      timer = setTimeout(connect, RETRY_DELAY_MS);
    };

    function connect(): void {
      if (cancelled || finished) return;
      const es = new EventSource(url as string);
      source = es;

      es.onopen = () => dispatch({ kind: 'open' });

      es.onmessage = (message: MessageEvent<string>) => {
        let event: PipelineEvent;
        try {
          const parsed: unknown = JSON.parse(message.data);
          if (!parsed || typeof parsed !== 'object' || typeof (parsed as PipelineEvent).type !== 'string') {
            return;
          }
          event = parsed as PipelineEvent;
        } catch {
          return;
        }

        // A run for this seed is already executing: close and retry shortly, do not render
        // it as an event or an error.
        if (event.type === 'pending') {
          es.close();
          scheduleRetry();
          return;
        }

        dispatch({ kind: 'event', event });
        // The server closes right after `stage done`; close from this side too so the
        // browser's automatic reconnect never re-runs the pipeline.
        if (event.type === 'stage' && event.stage === 'done' && event.status !== 'start') {
          finished = true;
          es.close();
          dispatch({ kind: 'closed', unexpected: false });
        }
      };

      es.onerror = () => {
        es.close();
        if (finished || cancelled) return;
        // The stream dropped before the run finished — on a free host, the platform cutting
        // a long run. The run continues server-side, so retry until it caches (or we give up).
        scheduleRetry();
      };
    }

    connect();

    return () => {
      cancelled = true;
      finished = true;
      clearTimer();
      source?.close();
    };
  }, [url]);

  return state;
}
