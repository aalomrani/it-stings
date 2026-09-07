'use client';

/**
 * "What it thinks this is" — the fingerprint, laid out as the JSON it is.
 *
 * Row labels are the schema keys **verbatim** (`tempo_bpm`, `signature_hook`, …): the
 * panel ties the UI to `Fingerprint` and is honest about being a data structure without
 * ever becoming an all-caps eyebrow. `tempo_bpm` and `tempo_feel` sit side by side so the
 * honesty policy — a measurement next to an interpretation — is readable in one glance.
 *
 * **No number is ever invented, and the row says why there is no number.** An unknown
 * tempo prints `unknown` plus the reasons out of `TrackRecord.degraded`; it never prints a
 * guess and never prints a bare dash.
 *
 * `tempo_bpm` reads `seed.tempoBpm` — the record — not `fingerprint.tempo_bpm`, which is a
 * copy of it. Same number, same source stamp as the seed card's stamp line and the
 * provenance foot, which read the record too because they must work with no model at all.
 *
 * Every interpreted row carries `✕ wrong`. Striking a row adds the field to a `corrections`
 * map and raises "re-run with my corrections", which re-opens the stream with them. A
 * second click un-strikes. The engine re-interprets a struck field from scratch: the
 * correction is part of the run cache key, so a corrected run is always a fresh one, and
 * the fingerprint prompt is told which reading the listener rejected.
 */

import { useState } from 'react';

import { sourceStamp, tempoUnknownReasons } from '@/lib/client/format';
import type { Confidence, Fingerprint, FingerprintField, TrackRecord } from '@/lib/types';

/** The nine fields `RunOptions.corrections` can carry — the ones the model interprets. */
const CORRECTABLE: FingerprintField[] = [
  'tempo_feel',
  'rhythmic_character',
  'instrumentation',
  'vocal_delivery',
  'harmonic_language',
  'emotional_register',
  'production_texture',
  'scene_context',
  'signature_hook',
];

/** The prose rows, in the order the mockup sets them. */
const TEXT_ROWS: FingerprintField[] = [
  'rhythmic_character',
  'instrumentation',
  'vocal_delivery',
  'harmonic_language',
  'emotional_register',
  'production_texture',
  'scene_context',
  'signature_hook',
];

const CHIP: Record<Confidence, string> = { high: 'hi', medium: 'md', low: 'lo' };

/**
 * The graded confidence the model returned for one interpreted field.
 *
 * There is no "no model" variant here on purpose: a panel only exists when a fingerprint
 * exists, and a fingerprint only exists when the model produced one. A keyless run emits
 * no `fingerprint` event at all (`pipeline.ts` stops at Stage 2), so the honest keyless
 * state is the receipt line's `fingerprint ✕` plus the degraded notice, not a panel of
 * empty chips. §9.7's hollow `no data` chip belongs to the rows that carry a *measurement*
 * — `tempo_bpm` and `era` — where it is used below.
 */
function ConfidenceChip({ level }: { level: Confidence }) {
  return <span className={`chip ${CHIP[level]}`}>{level}</span>;
}

/** The disagreement affordance. `aria-pressed` carries the struck state to a screen reader. */
function Strike({
  field,
  pressed,
  onToggle,
}: {
  field: FingerprintField;
  pressed: boolean;
  onToggle: (field: FingerprintField) => void;
}) {
  return (
    <button
      className="strike"
      type="button"
      aria-pressed={pressed}
      aria-label={`Mark ${field} as wrong`}
      onClick={() => onToggle(field)}
    >
      ✕ wrong
    </button>
  );
}

/** `musicbrainz first-release-date 1983 — copied, not inferred`. */
function yearProvenance(seed: TrackRecord): string | null {
  const year = seed.year;
  if (!year) return null;
  const field = year.source.field ? ` ${year.source.field}` : '';
  return `${year.source.source}${field} ${year.value} — copied, not inferred`;
}

export interface FingerprintPanelProps {
  seed: TrackRecord;
  fingerprint: Fingerprint;
  /** The corrections currently live on the stream, so a re-run can be offered exactly once. */
  applied: Partial<Record<FingerprintField, string>>;
  onRerun: (corrections: Partial<Record<FingerprintField, string>>) => void;
}

export function FingerprintPanel({ seed, fingerprint, applied, onRerun }: FingerprintPanelProps) {
  const [struck, setStruck] = useState<FingerprintField[]>(() =>
    CORRECTABLE.filter((field) => applied[field]),
  );

  function toggle(field: FingerprintField) {
    setStruck((prev) => (prev.includes(field) ? prev.filter((f) => f !== field) : [...prev, field]));
  }

  const corrections: Partial<Record<FingerprintField, string>> = Object.fromEntries(
    struck.map((field) => [field, 'wrong']),
  );
  const same =
    struck.length === Object.keys(applied).length && struck.every((field) => applied[field]);

  function rowClass(field: FingerprintField) {
    return struck.includes(field) ? 'fprow struck' : 'fprow';
  }

  const value = (field: FingerprintField): string => {
    const raw = fingerprint[field as keyof Fingerprint];
    return Array.isArray(raw) ? raw.join(' · ') : String(raw);
  };

  const tagList = seed.tags?.value ?? [];
  const yearNote = yearProvenance(seed);
  // The measurement is the RECORD's. `fingerprint.tempo_bpm` is a copy of exactly this
  // field, so reading the record here keeps this row, the seed card's stamp line and the
  // provenance foot on one number with one source — they cannot drift apart.
  const tempo = seed.tempoBpm;

  return (
    <section className="fp" aria-label="Seed fingerprint">
      <div className="fp-h">
        <h3>What it thinks this is</h3>
        <span>
          model {fingerprint.model} · grounded on {fingerprint.grounded_on.length} hard values ·
          strike anything that is wrong
        </span>
      </div>

      <dl className="fp-list">
        {/* tempo_bpm and tempo_feel side by side: measurement beside interpretation. */}
        <div className="fprow fprow--pair">
          <dt>tempo_bpm</dt>
          <dd>
            {tempo === null ? (
              <>
                <span className="v none">unknown</span>
                <span className="chip no">no data</span>
                <span className="src">{tempoUnknownReasons(seed)}</span>
              </>
            ) : (
              <>
                <span className="v">{tempo.value}</span>
                <span className="chip meas">measured</span>
                <span className="src">{sourceStamp(tempo.source)} — copied, not inferred</span>
              </>
            )}
          </dd>
          <dt className={struck.includes('tempo_feel') ? 'struck' : undefined}>tempo_feel</dt>
          {/* only the interpreted half of the pair can be struck; the measurement beside
              it is not the model's to be wrong about */}
          <dd className={struck.includes('tempo_feel') ? 'struck' : undefined}>
            <span className="v">{fingerprint.tempo_feel}</span>
            <ConfidenceChip level={fingerprint.confidence.tempo_feel} />
            <Strike field="tempo_feel" pressed={struck.includes('tempo_feel')} onToggle={toggle} />
            <span className="src">
              {tempo === null
                ? 'model interpretation · no measurement behind it'
                : `model interpretation over the measured ${tempo.value} BPM`}
            </span>
          </dd>
        </div>

        {TEXT_ROWS.map((field) => (
          <div className={rowClass(field)} key={field}>
            <dt>{field}</dt>
            <dd>
              <span className="v">{value(field)}</span>
              <ConfidenceChip level={fingerprint.confidence[field]} />
              <Strike field={field} pressed={struck.includes(field)} onToggle={toggle} />
            </dd>
          </div>
        ))}

        {/* era is a copied measurement, not an interpretation: no strike, a source line. */}
        <div className="fprow">
          <dt>era</dt>
          <dd>
            {fingerprint.era === null ? (
              <>
                <span className="v none">year unknown</span>
                <span className="chip no">no data</span>
                <span className="src">
                  no source gave a first-release year for this recording — not guessed
                </span>
              </>
            ) : (
              <>
                <span className="v">{fingerprint.era}</span>
                <span className="chip meas">measured</span>
                {yearNote ? <span className="src">{yearNote}</span> : null}
              </>
            )}
          </dd>
        </div>

        <div className="fprow">
          <dt>grounded_on</dt>
          <dd>
            {tagList.length > 0 ? (
              <ul className="tags">
                {tagList.slice(0, 8).map((tag) => (
                  <li key={tag.name}>
                    {tag.name} <em>{tag.count}</em>
                  </li>
                ))}
              </ul>
            ) : (
              <span className="v none">no crowd tags on the record</span>
            )}
            <span className="src">
              {tagList.length > 0 && seed.tags
                ? `${seed.tags.source.source} ${seed.tags.source.field ?? 'tags'}, raw counts · `
                : ''}
              {fingerprint.grounded_on.join(' · ')}
            </span>
          </dd>
        </div>
      </dl>

      {struck.length > 0 && !same ? (
        <p className="controls">
          <button className="btn" type="button" onClick={() => onRerun(corrections)}>
            re-run with my corrections
          </button>
          <span className="rule-note">
            {struck.length} field{struck.length === 1 ? '' : 's'} marked wrong:{' '}
            {struck.join(', ')}. Re-running interprets {struck.length === 1 ? 'it' : 'them'} again
            from the recording&rsquo;s hard data, with the reading you rejected quoted back as
            rejected — a different set of corrections is a different run, never a replay of this
            one.
          </span>
        </p>
      ) : null}
    </section>
  );
}
