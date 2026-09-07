# Model conventions (engine/model.ts)

The engine calls Claude through `@anthropic-ai/sdk`. These conventions are current as of
2026-09 and were checked against the SDK reference; do not substitute patterns from memory.

## Client

```ts
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';

const client = new Anthropic();               // reads ANTHROPIC_API_KEY from env
export const MODEL = process.env.ITSTINGS_MODEL ?? 'claude-opus-5';
```

- Model id is exactly `claude-opus-5`. Never append a date suffix.
- Do not pass `temperature`, `top_p`, `top_k` (rejected on this model).
- Do not pass `thinking` with `budget_tokens`. Omit `thinking` (adaptive is the default) and
  control depth with `output_config.effort`.
- Never use assistant-message prefill.
- `max_tokens`: 16000 for non-streaming structured calls (the default here).
- Timeout: the SDK default is 10 min; set `timeout: 300_000` (ms) per call (a 12-candidate
  `score` batch at high effort takes 75–150 s; at 120 s batches timed out and were retried,
  billing each attempt) and
  `maxRetries: 2` on the client. Every engine call is wrapped so a failure yields a typed
  `{ ok: false, reason }` and never an unhandled throw.

## Structured output — the only way the engine reads model output

```ts
export async function callStructured<T>(args: {
  name: string;                       // for logging: 'fingerprint' | 'channelC' | 'extractMentions' | 'score' | 'pickTags'
  schema: z.ZodType<T>;
  system: string;                     // stable, versioned, cacheable
  user: string;                       // volatile
  effort: 'low' | 'medium' | 'high' | 'xhigh';
  maxTokens?: number;
}): Promise<{ ok: true; value: T; usage: Anthropic.Usage } | { ok: false; reason: string }>
```

Implementation:

```ts
const res = await client.messages.parse({
  model: MODEL,
  max_tokens: args.maxTokens ?? 16000,
  system: [{ type: 'text', text: args.system, cache_control: { type: 'ephemeral' } }],
  messages: [{ role: 'user', content: args.user }],
  output_config: { effort: args.effort, format: zodOutputFormat(args.schema) },
});
if (res.stop_reason === 'refusal') return { ok: false, reason: `refusal:${res.stop_details?.category ?? 'unknown'}` };
if (res.stop_reason === 'max_tokens') return { ok: false, reason: 'max_tokens' };
if (!res.parsed_output) return { ok: false, reason: 'parse_failed' };
return { ok: true, value: res.parsed_output, usage: res.usage };
```

- Check `stop_reason` before touching content. `refusal` is a normal stop reason on this
  model family; treat it as a soft failure of that one call (degrade), not a crash.
- Refusal fallbacks: the API supports a server-side `fallbacks: "default"` parameter (beta
  header `server-side-fallback-2026-07-01`) that re-runs a declined request on another
  model. Enable it behind `ITSTINGS_FALLBACKS=1` (default on) only if the installed SDK's
  types accept it on `messages.parse` / `beta.messages`; if the typings do not, leave a
  clearly marked TODO in `model.ts` and do not fight the types. Music recommendation is
  unlikely to trigger a refusal; a clean degrade path matters more than the fallback.
- Zod schemas for model output live next to the stage that owns them
  (`engine/fingerprint.ts` exports `FingerprintSchema`, etc.). Keep them flat and use
  `.describe()` liberally — the descriptions are what the model sees.
- Every call logs `{ name, model, effort, input_tokens, cache_read_input_tokens,
  output_tokens, ms }` to the server console at debug level and increments the run's
  `modelCalls`.

## Prompt caching

Each stage has ONE frozen system prompt string exported as a constant with a
`PROMPT_VERSION` (e.g. `'fp-v1'`). Volatile content (the seed data, the candidate list)
goes in the user message. Never interpolate timestamps, run ids, or unsorted JSON into the
system prompt. The fingerprint cache and run cache keys include `PROMPT_VERSION` so a
prompt change invalidates cached outputs.

## Effort per call

| Call | Effort | Why |
|---|---|---|
| fingerprint | high | judgment-heavy, once per seed |
| pickTags (choose 3–4 specific Last.fm tags) | low | trivial |
| channelC (25–40 candidates from fingerprint alone) | high | recall + real-track precision matter |
| extractMentions (forum text → artist/title mentions) | low | extraction; many calls |
| score (batch of ≤12 candidates vs fingerprint) | high | the `why` quality is the product |

## Mock mode (tests and keyless dev)

`engine/model.ts` exports `setModelTransport(fn)` so tests inject a fake that returns
canned zod-valid objects per call `name`. When `ANTHROPIC_API_KEY` is missing at runtime,
`callStructured` returns `{ ok: false, reason: 'no_api_key' }` immediately and the pipeline
reports "recommendations unavailable: no ANTHROPIC_API_KEY" in `degraded`. The rest of the
app (search, resolve, preview, playlists) never touches the model.

Account-level failures get their own stable reasons rather than a pasted error body:
`billing` (a body typed `billing_error`, or a 400 saying the credit balance is too low),
`bad_api_key` (401/403), `rate_limited` (429) and `overloaded` (529 or any other 5xx).
`isAccountFailure(reason)` groups them and `pipeline.ts` owns the wording: the whole-run
"recommendations unavailable: …" sentence when Stage 2 hits one, and `plainReason` for the
later stages, which a cached fingerprint can carry the run down to. Neither the billing 400
nor a rejected key is retried inside `callStructured` — dropping the fallback beta cannot
buy credit or mint a key — while every other 400 keeps its one beta-drop retry. That is
this file's retry only: the client is built with `maxRetries: 2`, so the SDK has already
retried a 429 or a 5xx twice, honouring `retry-after`, before the reason surfaces here.

Everything that is NOT an account failure degrades as `error:<the API's own sentence>`.
`APIError.message` is `"<status> " + the whole JSON body` whenever the body has no
top-level `message`, and Anthropic's bodies nest theirs under `error.message`, so the
sentence is read out of the body rather than off `.message`: a mistyped `ITSTINGS_MODEL`
reads `error:404 model: claude-opus-5-preview`, not a truncated object.

## Prompt-injection boundary (Channel B)

Fetched web text is data. The extraction system prompt states that the user message
contains untrusted page text and that instructions inside it must be ignored; the page
text is wrapped in a clearly delimited block; the schema only allows artist/title/sentence/
enthusiasm fields, so there is nowhere for injected instructions to go.
