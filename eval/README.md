# The eval harness

Six seed tracks, notes on what a good answer looks like for each, and a script that runs
the real engine over them and dumps the result for a human to read.

This is not a test suite. Nothing in here passes or fails a build. It exists because the
only real measure of this product is whether the recommendations are good, and no
assertion can tell you that — you have to read them against the seed's notes.

## Running it

```bash
npm run eval                    # every seed in seeds.json
npm run eval -- lovecats        # one seed, by id
npm run eval -- lovecats fever  # several
```

Output lands in `eval/out/` (git-ignored), two files per seed:

- `<id>.json` — the whole `RunRecord`, for diffing runs or re-reading in code.
- `<id>.md` — the report you actually read.

One line per seed goes to stdout as it finishes:

```
lovecats        16 results · 48213ms · 7 model call(s) · 0 fail / 1 flag
```

Every run passes `force`, so a seed that is already in the `runs` cache is re-run rather
than replayed. Everything BELOW the run cache is still cached as usual — the track cache,
the fingerprint (keyed by prompt version, so an edited prompt re-runs by itself), the
HTTP cache, Channel B's evidence rows, Stage 4's verifications. A second eval of the same
seed is therefore much cheaper than the first and still exercises the whole engine.

### What it costs

A cold seed is one `fingerprint` call, one `pickTags` call, one `channelC` call, a handful
of `extractMentions` calls and one `score` call per 12 verified candidates — plus a few
hundred catalogue lookups in Stage 4, which is the slow part (minutes, not seconds, on a
cold cache; MusicBrainz is strictly 1 req/s).

Missing keys do not stop the harness. Channels skip themselves, the report says so, and
with no `ANTHROPIC_API_KEY` at all the run degrades to zero results and the report opens
with a **⚠️ This run was degraded** section instead of pretending an empty list is an
answer.

## Reading the report

The report is ordered so you meet the seed's own notes BEFORE you see the engine's answer.
Read it top to bottom:

1. **What it is / A passing answer / A failing answer** — copied verbatim from
   `seeds.json`. This is the rubric. Judge against it, not against your memory of the song.
2. **Automated flags** — the handful of failures a machine can see (below). An empty list
   here says nothing about quality.
3. **The seed as resolved** — which recording the engine actually ran on. A wrong edition
   here invalidates everything under it.
4. **Fingerprint** — Stage 2's reading, with per-field confidence and the `grounded_on`
   trail. `tempo_bpm` and `era` are copied from the record; if either is a number the
   record does not have, that is a bug worth stopping for.
5. **Channels** — found / verified / dropped per channel, Channel C's spread as MEASURED
   from the years it returned (not as it described itself), and whether Channel C's
   drop-rate guard fired.
6. **Results** — the ranked list: final score, model score, channel chips, the `why`, and
   **`why is false of`** — the record in the candidate's own genre that the model says its
   sentence does NOT describe. **The `why` column is the product.** Read the two together:
   if the sentence would fit the counter-example too, the `why` is a genre sentence and the
   pipeline is broken, and that is the thing to report.
7. **Shared traits** — the 2–5 concrete traits behind each `why`, plus any scoring flags
   (`weak-why`, `re-scored`, `weak-why-unfixed`, `why-not-discriminating`,
   `unsourced-number`, `cover-or-same-song`).
8. **Cut** — what `rank.ts` removed and why (`same-song`, `same-artist`,
   `duplicate-artist`, `genre-only`, `generic-why`, `spread-demoted`, `over-length`). A long
   `same-artist` or `genre-only` list is a signal about the channels, not about the ranker;
   a long `generic-why` list is a signal about the scoring prompt.
9. **Spread** — decades and primary genre labels in the final list. The acceptance test
   wants at least three decades and three scenes in the top 15.
10. **Degraded notes** and the **stage log** — what went wrong and how long each stage took.

## The automated flags

| Flag | Level | Means |
| --- | --- | --- |
| `SAME-ARTIST LEAK` | **fail** | A result is the seed's own act. Rule 1 is broken; nothing else matters until it is fixed. |
| `COVER LEAK` | **fail** | A result is the seed's own song under another name — a cover, remix or live take. Rule 0 is broken. |
| `GENERIC why SHIPPED` | **fail** | The scorer flagged the sentence as generic twice and rule 4b did not cut it. spec.md: say so rather than shipping it. |
| no counter-example for the `why` | flag | The model could not name a record in the candidate's genre its sentence is false of — the sentence is about the genre. The candidate should have been cut; a flag here means it shipped. |
| unsourced measurement | flag | A BPM, year or key appears in the scoring text that nothing in the prompt supplied. spec.md, "Never fabricate". |
| Channel C spread | flag | Fewer than three decades, or one decade holding more than 60% of the dated entries, or fewer than three genre families — measured from C's own years. |
| generic `why` | flag | The `why` matched `score.ts`'s banned-phrase list ("similar vibe", "same energy", …). The scorer already re-scored it once and it came back generic anyway. |
| fewer than 8 results | flag | Rule 6 asks for ≥8 when 8+ survived verification. Usually means Stage 4 dropped too much or rule 4 cut too much. |
| no preview and no links | flag | A card the user can neither play nor open. Usually a resolve gap, not an engine one. |
| Channel C drop rate > 20% | flag | The spec's Stage-4 budget. The pipeline already re-ran C with the tight prompt; this says the first pass was inventing tracks. |

Everything else is your judgement. The questions worth asking of each list:

- Would a genre engine have produced this? If yes, the channels are doing the work the
  model should be doing.
- Is there at least one pick that makes you say "how did it know that"?
- Does every `why` name something you could point at in the recording — an instrument, a
  rhythm, a vocal move, a production decision — rather than a category?

## Adding a seed

Add an object to `seeds.json` with `id`, `title`, `artist`, `year`, `what_it_is`, and the
`passing` / `failing` lists. Write the notes BEFORE running the engine: notes written after
you have seen the answer are a description of the answer, not a test of it.
