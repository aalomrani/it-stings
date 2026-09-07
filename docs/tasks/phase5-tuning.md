# Phase 5 — ranking quality (the phase where the product gets good)

Needs `ANTHROPIC_API_KEY` in `.env.local` (and ideally `LASTFM_API_KEY` + `TAVILY_API_KEY`).
Everything below is manual review plus small, measured changes. Budget real time.

## The loop

1. `npm run eval` (all six seeds, forced fresh runs) → `eval/out/<id>.md` per seed.
2. Read each `.md` against its `passing` / `failing` notes in `eval/seeds.json`. Score each
   seed 0–3 by hand: 0 = fails a hard rule (same-artist leak, invented track, generic why),
   1 = real tracks but genre-engine list, 2 = mostly right with a few "how did it know",
   3 = the list the spec describes. Write the scores into `eval/out/SCORES.md` with the date
   and the prompt/engine versions, one row per run, so regressions are visible.
3. Pick the single worst failure mode across seeds. Change ONE lever. Bump the affected
   `PROMPT_VERSION` / `ENGINE_VERSION`. Re-run only the seeds that exercise it, then all six
   before declaring a win. Never tune on The Lovecats alone; it is seed one, not the only seed.
4. Stop when every seed scores ≥ 2 and The Lovecats scores 3, or when two consecutive
   rounds do not move the scores.

## Levers, in the order they usually pay off

1. **Fingerprint** (`engine/fingerprint.ts`): is `signature_hook` the weird memorable thing
   or a genre label? Is `scene_context` naming what the artist is doing? If the fingerprint
   is generic, everything after it is generic. Check the `grounded_on` lines: if Last.fm tags
   are missing (no key) the model has less to push against.
2. **Channel C recall and precision** (`engine/channels/c.ts`): drop rate > 20 % → the
   `tight` prompt; too few cross-decade picks → the spread instruction; too many obvious
   picks → ask for "the record a genre engine would never surface" explicitly.
3. **Scoring** (`engine/score.ts`): read twenty `why` sentences in a row. If any would fit
   two other songs in the genre, the `why_discriminates` self-test is not biting — tighten
   the example, not the rules. Check per-dimension notes for invented measurements (the
   eval flags them).
4. **Weights** (`engine/rank.ts` `DIMENSION_WEIGHTS`): the defaults favour rhythm and vocal
   delivery 3:3:2:2:2:1:1:1:0. For "Golden Brown" harmonic language and instrumentation
   matter more than vocal delivery; for "Fever" instrumentation (the emptiness) is the
   point. Consider letting the fingerprint's per-field confidence scale the weights
   (low confidence → weight ×0.5) before adding per-seed weights.
5. **Channel bonuses** (`CHANNEL_BONUS`, `ENTHUSIASM_BONUS`): if forum-backed picks are
   drowning under model-prior picks, raise the bonus; if a Reddit list of "80s alternative"
   is dragging in decade-mates, the genre-only cut is too lenient — fix that first.
6. **Spread** (rule 5 caps): 40 % per decade/genre. Loosen only if the seed's true
   neighbourhood is narrow (a 1950s jump-blues seed legitimately lives in one decade).
7. **Channel A tag pivot** (`pickTags`): if the pivot tags are generic ("jazz"), the
   blocklist needs the seed's own broad genre added dynamically.

## What "3" looks like for The Lovecats (from the spec)

Swing revival, jump blues, lounge-influenced pop, arch British art-pop, electro-swing;
at least three decades and three scenes in the top 15; every `why` names the walking
upright bass, the brushed shuffle, the vocal that slides into nonsense syllables, or the
wink; no Cure; nothing that doesn't exist; at least a few picks a genre engine would never
surface.

## Guardrails that must never be relaxed while tuning

Rules 0 (same song), 1 (same artist), 2 (one per artist), 4b (generic why), and Stage 4
verification. If a tuning change makes a seed look better by weakening one of these, it is
not a win.
