'use client';

/**
 * The degraded notice. The BAND is rotated 0.9° and carries the blood spine; the sentence
 * sits at 0°, on its own opaque patch.
 *
 * It states the CONSEQUENCE, not just the failure, and it reconciles itself with whatever
 * the rest of the page shows. Every string in the run's `degraded[]` appears here — a
 * skipped channel the user cannot see is a lie by omission.
 */

/**
 * Extra sentences that turn a known failure line into its consequence.
 *
 * ORDER IS LOAD-BEARING: `consequenceFor` takes the FIRST match, so every specific entry
 * has to sit above the broad one it would otherwise be swallowed by. The degraded line
 * itself names only the failure (see `pipeline.ts`); the one thing to do about it is said
 * here, once, however many lines carry the same cause.
 */
export const CONSEQUENCE: { match: RegExp; say: string }[] = [
  {
    // The whole-run degrade: with no key there is no interpretation, no scoring and
    // therefore no list — and the page says which key, by name.
    match: /recommendations unavailable: no ANTHROPIC_API_KEY/i,
    say:
      'Every stage of this engine is a model call — the fingerprint, the three channels’ judgement, the per-dimension scoring — so with no key there is nothing to rank and the list below is empty. The seed card and whatever the hard sources measured are all this run produced. Set ANTHROPIC_API_KEY and run it again.',
  },
  {
    // The account behind the key has no credit. The failure is one HTTP 400 the listener
    // never sees; what they need is the consequence and the console page that fixes it.
    // The same line can arrive from a channel or from the scoring when the fingerprint
    // came from cache, so this says what was lost without claiming the whole run was.
    match: /account behind ANTHROPIC_API_KEY has no credit/i,
    say:
      'Every judgement this engine makes is a model call, and the account cannot pay for one, so whatever needed the model from that point on is missing rather than guessed at. Add credits at console.anthropic.com under Plans & Billing, then run this seed again.',
  },
  {
    match: /ANTHROPIC_API_KEY was rejected/i,
    say:
      'Anthropic refused the key itself, so nothing that needed the model could run and none of the gap was filled in. Check the ANTHROPIC_API_KEY this app is running with against the key in the Anthropic console, then run this seed again.',
  },
  {
    match: /hit the Anthropic rate limit/i,
    say:
      'The account was asked for more than it is allowed right now, so those judgements never happened; nothing here is broken and nothing was invented to cover the gap. Wait a minute and run this seed again.',
  },
  {
    match: /Anthropic did not answer/i,
    say:
      'This failed on Anthropic’s side rather than in the run. The seed is already resolved and cached, so running it again shortly costs only the model calls.',
  },
  {
    match: /Channel A \(Last\.fm\)/i,
    say: 'No crowd tags and no statistical neighbours were used to find these candidates.',
  },
  {
    match: /Channel B \(forum evidence\)/i,
    say:
      'No forum evidence was fetched, so no candidate can earn the +0.05 enthusiasm bonus and no evidence row below can carry a thread link.',
  },
  {
    match: /not in the track cache/i,
    say: 'Search for the track again and pick it from the list; that resolves it and caches it.',
  },
  {
    // MUST STAY BELOW every `recommendations unavailable: …` entry above: the first match
    // wins, and this one matches all of them.
    match: /recommendations unavailable/i,
    say:
      'No candidates could be produced for this seed, so the list below is empty — the seed card and its fingerprint are everything this run resolved. Nothing was invented to fill the gap.',
  },
  {
    match: /Spotify skipped/i,
    say:
      'The `spotify` deep link under the seed opens a SEARCH for the artist and title, not the track itself — there is no Spotify id on this record to link to.',
  },
  {
    match: /Last\.fm skipped/i,
    say:
      'The fingerprint is grounded on MusicBrainz tags and genres instead of Last.fm crowd tags, and the credits line omits Last.fm because nothing of theirs was used.',
  },
];

/**
 * An unrecognised failure is exactly when the user most needs the sentence, so there is
 * always one. §9.5: the notice states the consequence, not just the failure.
 */
export const FALLBACK_CONSEQUENCE =
  'Whatever this cost the run is missing from the page below rather than filled in: no number, candidate or evidence row was invented to cover it.';

/**
 * The sentence that goes after one degraded line. Exported so the wording contract can be
 * tested: the constants live in `pipeline.ts` and the matchers here, joined by nothing a
 * compiler checks, so `degradedNotice.test.ts` pins every one of them to its own entry.
 */
export function consequenceFor(line: string): string {
  return (CONSEQUENCE.find((c) => c.match.test(line)) ?? { say: FALLBACK_CONSEQUENCE }).say;
}

/** Renders `SCREAMING_SNAKE` env names and `/api/…` paths as mono code, as the mockup does. */
function withCode(text: string): React.ReactNode[] {
  return text.split(/(`[^`]+`|[A-Z][A-Z0-9_]{5,}|\/api\/[a-z/[\]]+)/g).map((part, index) => {
    if (/^`[^`]+`$/.test(part)) return <code key={index}>{part.slice(1, -1)}</code>;
    if (/^[A-Z][A-Z0-9_]{5,}$/.test(part) || part.startsWith('/api/')) {
      return <code key={index}>{part}</code>;
    }
    return <span key={index}>{part}</span>;
  });
}

export function DegradedNotice({ lines, error }: { lines: string[]; error: string | null }) {
  if (lines.length === 0 && !error) return null;

  return (
    <>
      {error ? (
        <div className="notice" role="status">
          <p>
            <span className="lbl">error</span>
            <b>{withCode(error)}</b> The page keeps whatever it already had; nothing below was
            invented to fill the gap.
          </p>
        </div>
      ) : null}

      {lines.length > 0 ? (
        <div className="notice" role="status">
          {lines.map((line, index) => {
            return (
              <p key={line}>
                {index === 0 ? <span className="lbl">degraded</span> : null}
                <b>{withCode(line)}</b> {withCode(consequenceFor(line))}
              </p>
            );
          })}
        </div>
      ) : null}
    </>
  );
}
