'use client';

/**
 * The weights filter: one slider per scored dimension, behind the same native
 * `<details>` disclosure the result cards use (summary → `lbl-shut`/`lbl-open`/`caret`,
 * so it reads identically). It appears BOTH on the empty state — set the mix before the
 * first search — and on the results page, where a change re-ranks the same scored pool
 * (a free cache replay, no network).
 *
 * The sliders seed from `DEFAULT_SCORED_WEIGHTS`, which is projected from the one engine
 * copy of the defaults, so the panel can never disagree with what a defaultless run
 * scores with. `vocal_delivery` and `signature_hook` are marked "not measured (keyless)":
 * in the keyless engine they are always a neutral 0.5, so weighting them only flattens
 * the spread — the value stays adjustable, but the panel says so.
 */

import { Caret } from '@/components/Icons';
import { DEFAULT_SCORED_WEIGHTS, isDefaultWeights, type ScoredWeights } from '@/lib/client/weights';
import { SCORED_DIMENSION_KEYS, type ScoredDimension } from '@/lib/types';

/** The largest weight the engine accepts (0..10 integers). */
export const WEIGHT_MAX = 10;

/** Plain-word labels for the nine scored dimensions, in display order. */
export const DIMENSION_LABEL: Record<ScoredDimension, string> = {
  rhythmic_character: 'rhythm & groove',
  vocal_delivery: 'vocals',
  emotional_register: 'mood',
  scene_context: 'scene / setting',
  signature_hook: 'signature hook',
  instrumentation: 'instruments',
  harmonic_language: 'harmony',
  production_texture: 'production',
  era: 'era',
};

/** Carries no keyless signal — weighting it only flattens the spread. */
const NOT_MEASURED: ReadonlySet<ScoredDimension> = new Set<ScoredDimension>([
  'vocal_delivery',
  'signature_hook',
]);

export interface WeightsPanelProps {
  weights: ScoredWeights;
  onChange: (next: ScoredWeights) => void;
  /** Open by default on the empty state, shut on the results page. */
  defaultOpen?: boolean;
  /** Placement, for the two anchoring rules in the stylesheet. */
  variant?: 'hero' | 'sheet';
}

export function WeightsPanel({
  weights,
  onChange,
  defaultOpen = false,
  variant = 'sheet',
}: WeightsPanelProps) {
  const atDefault = isDefaultWeights(weights);
  const set = (dim: ScoredDimension, value: number) => onChange({ ...weights, [dim]: value });

  return (
    <details className={`weights weights--${variant}`} open={defaultOpen}>
      <summary aria-label="weights — tune how much each trait counts">
        <Caret />
        <span className="lbl-shut">weights — tune the engine</span>
        <span className="lbl-open">weights — hide</span>
      </summary>

      <div className="wpanel">
        <p className="wintro">
          how much each trait counts when a candidate is ranked against the seed. drag to 0 to turn
          a trait off. a change re-ranks instantly.
        </p>

        <ul className="wlist">
          {SCORED_DIMENSION_KEYS.map((dim) => {
            const noted = NOT_MEASURED.has(dim);
            const noteId = noted ? `w-note-${dim}` : undefined;
            return (
              <li key={dim} className={noted ? 'wrow wrow--off' : 'wrow'}>
                <label className="wname" htmlFor={`w-${dim}`}>
                  {DIMENSION_LABEL[dim]}
                  {noted ? <span className="wtag"> · not measured (keyless)</span> : null}
                </label>
                <input
                  id={`w-${dim}`}
                  className="wslider"
                  type="range"
                  min={0}
                  max={WEIGHT_MAX}
                  step={1}
                  value={weights[dim]}
                  aria-describedby={noteId}
                  aria-valuetext={`${weights[dim]} of ${WEIGHT_MAX}`}
                  onChange={(event) => set(dim, Number(event.currentTarget.value))}
                />
                <output className="wval" htmlFor={`w-${dim}`}>
                  {weights[dim]}
                </output>
                {noted ? (
                  <span id={noteId} className="sr">
                    always neutral in the keyless engine — weighting it only flattens the spread
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>

        <button
          type="button"
          className="btn bare wreset"
          onClick={() => onChange({ ...DEFAULT_SCORED_WEIGHTS })}
          disabled={atDefault}
        >
          reset to defaults
        </button>
      </div>
    </details>
  );
}
