'use client';

/**
 * The bee bar: the one moving thing on the results page, and the page's mascot.
 *
 * The progress is the sting driving home. The rail is the gaster — the same acid / blood /
 * ink bands the drawing carries — laid flat; a bone fill sweeps along it and the drawn
 * stinger (`StingerMark`, the same glyph the hero strip ends on) rides the fill's leading
 * edge toward the target. A run that broke leaves the sting where it stuck and turns the
 * fill to blood. Nothing is a timer: the fill is the share of pipeline stages that actually
 * finished (`progress.ts`), so a bar that stalls is telling the truth about a stalled run.
 *
 * The bee itself is the empty state's drawing, reused verbatim (`<Wasp />`, never redrawn) and
 * knocked back into a small inked plate beside the bar, so the creature the user came for is
 * present on this page too rather than only on the landing. It is decorative — `aria-hidden`,
 * `pointer-events:none` — and the bar carries the `progressbar` role and the live caption.
 */

import { StingerMark } from '@/components/Icons';
import { Wasp } from '@/components/Wasp';

export interface BeeProgressProps {
  /** 0..1 fill. */
  fraction: number;
  /** The plain-word phase, shown under the bar and read as the bar's value text. */
  caption: string;
  failed: boolean;
  done: boolean;
  /** One sentence for the polite live region — the run's state in words. */
  announcement: string;
}

export function BeeProgress({ fraction, caption, failed, done, announcement }: BeeProgressProps) {
  const pct = Math.round(Math.max(0, Math.min(1, fraction)) * 100);
  const cls = failed ? 'beebar is-fail' : done ? 'beebar is-done' : 'beebar';

  return (
    <div className="beehead">
      <p className="sr" role="status">
        {announcement}
      </p>

      <div className="beebar-wrap">
        <div
          className={cls}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          aria-valuetext={caption || 'not started'}
          aria-label="run progress"
        >
          <div className="beebar-fill" style={{ width: `${pct}%` }} />
          <span className="beebar-sting" style={{ left: `${pct}%` }}>
            <StingerMark />
          </span>
        </div>
        <p className={failed ? 'beecap is-fail' : 'beecap'} aria-hidden="true">
          {caption}
        </p>
      </div>

      {/* The mascot: the drawing, reused whole and knocked back into an inked plate. */}
      <div className="bee-mascot" aria-hidden="true">
        <Wasp />
      </div>
    </div>
  );
}
