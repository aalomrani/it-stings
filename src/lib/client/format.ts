/**
 * Small pure formatters shared by the cards, the receipt line and the provenance foot.
 * Everything that turns a number into a string on screen lives here so the provenance
 * list and the thing it describes can never drift.
 */

import type { Channel, Evidence, SourceRef, TrackRecord } from '@/lib/types';

/** The clip we play, and the denominator of the ring. */
export const PREVIEW_SECONDS = 30;

/** `0:07`, `1:04`. Never negative, never NaN. */
export function mss(seconds: number): string {
  const s = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * The progress ring's dash pair. `pathLength="100"` on the drawn path means elapsed is
 * literally `"{pct} {100-pct}"` — no circumference maths, and the ring is allowed to be
 * hand-drawn and wonky (docs/design.md §9.13).
 */
export function dash(elapsed: number, duration: number): string {
  const dur = duration > 0 ? duration : PREVIEW_SECONDS;
  const pct = Math.max(0, Math.min(100, (100 * elapsed) / dur));
  return `${pct.toFixed(1)} ${(100 - pct).toFixed(1)}`;
}

/** `0.94`. Scores are always two decimals, on the card and in the provenance foot. */
export function score2(n: number): string {
  return n.toFixed(2);
}

/** `01`, `02`, … the rank block. */
export function rank2(n: number): string {
  return String(n).padStart(2, '0');
}

/** `14.7%` — a drop rate. */
export function pct1(part: number, whole: number): string {
  if (whole <= 0) return '0.0%';
  return `${((100 * part) / whole).toFixed(1)}%`;
}

/**
 * `2026-08-14` — the day an evidence row was fetched, in UTC, from `Evidence.fetchedAt`.
 * UTC rather than the viewer's zone so the date on the card is the date the server (and
 * the `evidence` row's own `fetched_at`) means. Returns null for anything unusable, and
 * the caller then says "cached" without claiming a day it does not know.
 */
export function day(epochMs: number | undefined | null): string | null {
  if (typeof epochMs !== 'number' || !Number.isFinite(epochMs) || epochMs <= 0) return null;
  return new Date(epochMs).toISOString().slice(0, 10);
}

/**
 * The stamp on one evidence row, from the row's OWN record of where it came from:
 * `Evidence.live` says it was fetched during this run and `Evidence.fetchedAt` says when
 * the answer behind it was retrieved.
 *
 * Before those two fields existed the card derived this from the channel's status, and a
 * channel that ran live stamped `live` on a page it had actually replayed out of the
 * 30-day evidence cache — the one place the page could overstate itself.
 *
 * `liveChannels` stays as the run-level gate: a replayed run fetched nothing at all, and
 * the App passes an empty list for one, so no row on it can claim to be live. A row with
 * no `live` field of its own (Channel C's model priors, and runs stored before this
 * change) falls back to that gate, and to a date parsed out of `detail` if it has one.
 */
export function evidenceStamp(
  evidence: Evidence,
  liveChannels: Channel[],
): { cls: 'live' | 'cached'; text: string } {
  const channelRan = liveChannels.includes(evidence.channel);
  if ((evidence.live ?? channelRan) && channelRan) return { cls: 'live', text: 'live' };
  const date = day(evidence.fetchedAt) ?? /\b(\d{4}-\d{2}-\d{2})\b/.exec(evidence.detail ?? '')?.[1];
  return {
    cls: 'cached',
    text: date ? `cached ${date} · not refreshed this run` : 'cached · not refreshed this run',
  };
}

/* ------------------------------------------------------------------------------------ *
 * The measured seed values: tempo and key.
 *
 * These read `TrackRecord.tempoBpm` / `TrackRecord.keySignature` — the RECORD, which is
 * what the resolver measured — and never the fingerprint. `Fingerprint.tempo_bpm` is a
 * copy of `tempoBpm.value` made by the model stage, and the model stage does not run at
 * all without an `ANTHROPIC_API_KEY`. A UI that read the copy therefore printed "no source
 * returned a BPM" on a keyless run for a track whose BPM Deezer had measured and stored —
 * a fabricated *absence*, which docs/spec.md "Never fabricate" forbids exactly as much as
 * a fabricated number. If the record has the number, the page says who measured it.
 * ------------------------------------------------------------------------------------ */

/** `deezer bpm`, `acousticbrainz tonal.key_key+key_scale` — source plus the field it names. */
export function sourceStamp(ref: SourceRef): string {
  return ref.field ? `${ref.source} ${ref.field}` : ref.source;
}

/** ` (id 1143631)`, or nothing when the ref carries no id. */
function idNote(ref: SourceRef): string {
  return ref.id ? ` (id ${ref.id})` : '';
}

/** `tempo: 91.9 bpm · deezer` for the seed card's mono stamp line. Null when unmeasured. */
export function tempoLine(seed: TrackRecord): string | null {
  const tempo = seed.tempoBpm;
  return tempo ? `tempo: ${tempo.value} bpm · ${tempo.source.source}` : null;
}

/** `key: F major · acousticbrainz`. Null when no source gave a key. */
export function keyLine(seed: TrackRecord): string | null {
  const key = seed.keySignature;
  return key ? `key: ${key.value} · ${key.source.source}` : null;
}

/**
 * Why there is no BPM — only ever called when `seed.tempoBpm` is null.
 *
 * The reasons are the record's own `degraded` lines wherever it has them (the resolver
 * writes `tempo unknown: Deezer reports 0 and no fallback source had it`, `GetSongBPM: no
 * tempo (…)`, `AcousticBrainz: nothing for <mbid> …`). When it has none, they are derived
 * from what the record *shows* about each of the three tempo sources — never invented.
 *
 * `getsongbpmKey` is `health.keys.getsongbpm` where the caller has it; `undefined` means
 * the caller does not know, and then nothing is claimed about that source.
 */
export function tempoUnknownReasons(
  seed: TrackRecord,
  getsongbpmKey?: boolean | null,
): string {
  const said = seed.degraded.filter((line) => /bpm|tempo|getsongbpm|acousticbrainz/i.test(line));
  if (said.length > 0) return said.join(' · ');

  const derived = [
    seed.ids.deezer
      ? 'Deezer has the track but reports bpm 0'
      : 'no Deezer match, so no Deezer bpm',
  ];
  if (getsongbpmKey === false) {
    derived.push('no GETSONGBPM_API_KEY, so the GetSongBPM fallback never ran');
  } else if (getsongbpmKey === true) {
    derived.push('GetSongBPM returned no tempo');
  }
  derived.push(
    seed.features
      ? 'AcousticBrainz has this recording but no rhythm.bpm'
      : 'no AcousticBrainz match for this recording',
  );
  return derived.join(' · ');
}

/**
 * The provenance foot's `tempo_bpm` sentence. Measured → who measured it; unmeasured →
 * the actual reasons. It is never allowed to say nothing returned a BPM when something did.
 */
export function tempoProvenance(
  seed: TrackRecord | null,
  getsongbpmKey?: boolean | null,
): string {
  if (!seed) return 'no seed record on this run yet, so there is no tempo to account for.';
  const tempo = seed.tempoBpm;
  if (tempo) {
    return `${tempo.value} bpm, measured by ${sourceStamp(tempo.source)}${idNote(tempo.source)} and copied onto the record, not inferred. The fingerprint's tempo_bpm is a copy of this same number, so it is here whether or not a fingerprint ran.`;
  }
  return `unknown. ${tempoUnknownReasons(seed, getsongbpmKey)}. No BPM is shown because none of the three tempo sources measured one.`;
}

/** The provenance foot's `key_signature` sentence. Null when the record has no key. */
export function keyProvenance(seed: TrackRecord | null): string | null {
  const key = seed?.keySignature;
  if (!key) return null;
  return `${key.value}, measured by ${sourceStamp(key.source)}${idNote(key.source)} and copied onto the record, not inferred.`;
}
