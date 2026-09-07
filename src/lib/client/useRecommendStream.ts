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

/** What each channel is, spelled out on the receipt line. */
export const CHANNEL_LABEL: Record<Channel, string> = {
  A: 'last.fm',
  B: 'web search',
  C: 'model prior',
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
  };
}

type Action =
  | { kind: 'reset' }
  | { kind: 'open' }
  | { kind: 'closed'; unexpected: boolean }
  | { kind: 'event'; event: PipelineEvent };

function reduce(state: RunState, action: Action): RunState {
  switch (action.kind) {
    case 'reset':
      return emptyRun();
    case 'open':
      return { ...state, streaming: true };
    case 'closed':
      if (!action.unexpected) return { ...state, streaming: false };
      return {
        ...state,
        streaming: false,
        error:
          state.error ??
          (state.final
            ? null
            : 'the stream closed before the run finished — nothing below is complete'),
      };
    case 'event':
      return apply(state, action.event);
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
  return `/api/recommend?${params.toString()}`;
}

export function useRecommendStream(args: StreamArgs): RunState {
  const [state, dispatch] = useReducer(reduce, undefined, emptyRun);
  const url = recommendUrl(args);

  useEffect(() => {
    dispatch({ kind: 'reset' });
    if (!url) return;

    const source = new EventSource(url);
    let finished = false;

    source.onopen = () => dispatch({ kind: 'open' });

    source.onmessage = (message: MessageEvent<string>) => {
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
      dispatch({ kind: 'event', event });
      // The server closes right after `stage done`; close from this side too so the
      // browser's automatic reconnect never re-runs the pipeline.
      if (event.type === 'stage' && event.stage === 'done' && event.status !== 'start') {
        finished = true;
        source.close();
        dispatch({ kind: 'closed', unexpected: false });
      }
    };

    source.onerror = () => {
      const closed = source.readyState === EventSource.CLOSED;
      source.close();
      if (!finished) dispatch({ kind: 'closed', unexpected: true });
      else if (closed) dispatch({ kind: 'closed', unexpected: false });
    };

    return () => {
      finished = true;
      source.close();
    };
  }, [url]);

  return state;
}
