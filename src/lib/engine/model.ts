/**
 * THE model seam. Every call to Claude in It Stings goes through `callStructured` —
 * nothing else in the engine constructs an Anthropic client, and tests replace the
 * transport here with `setModelTransport` instead of hitting the API.
 *
 * The contract is `docs/model.md`:
 *   - one frozen, cacheable system prompt per stage (a `cache_control` text block);
 *     everything volatile goes in the user message
 *   - structured output only: `output_config.format` from a zod schema, never free text
 *   - depth is `output_config.effort`; no `temperature`/`top_p`/`top_k`, no `thinking`
 *     budget, no assistant prefill
 *   - it never throws. A refusal, a truncation, a bad parse, a network error and a
 *     missing key all come back as `{ ok: false, reason }` so the pipeline can degrade
 *     with an honest message instead of erroring the run.
 *
 * Keyless runtime is a first-class path, not an accident: with no `ANTHROPIC_API_KEY`
 * and no injected transport, every call answers `no_api_key` immediately and the
 * pipeline reports "recommendations unavailable: no ANTHROPIC_API_KEY".
 */

import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { z } from 'zod';

import { env } from '@/lib/env';

/* ------------------------------------------------------------------------------------ *
 * Constants
 * ------------------------------------------------------------------------------------ */

/**
 * Exactly `claude-opus-5` unless `ITSTINGS_MODEL` overrides it. Never a date suffix —
 * this is also part of the fingerprint cache key, so it must be stable across a run.
 */
export const MODEL: string = env.model;

/** docs/model.md: 16000 for non-streaming structured calls. */
export const DEFAULT_MAX_TOKENS = 16_000;

/**
 * Per-call timeout. The SDK default (10 min) is too patient for a live UI, but a `score`
 * batch of 12 at high effort routinely needs 75–150 s on claude-opus-5 and Channel C
 * ~120 s: at 120 s two of four score batches timed out (and were retried, and billed,
 * three times each) on the first live Lovecats run. Five minutes clears a slow batch
 * with margin and still bounds a hung call.
 */
export const CALL_TIMEOUT_MS = 300_000;

/** Client-level retries for transport-level failures (429/5xx/connection). */
export const MAX_RETRIES = 2;

/**
 * Server-side refusal fallback. The SDK types this on the beta Messages API only:
 * `fallbacks?: BetaFallbacksParam | null` and `betas?: Array<AnthropicBeta>` exist on
 * `client.beta.messages.parse` params, and `'server-side-fallback-2026-07-01'` is a
 * member of the `AnthropicBeta` union — so it can be enabled without fighting the types.
 * The non-beta `client.messages.parse` types neither field, which is why a fallback-on
 * call is routed through `beta.messages.parse` instead.
 *
 * Defaults ON (`ITSTINGS_FALLBACKS`, parsed in `env.ts`). Music recommendation is
 * unlikely to be refused; the clean degrade path below is what actually matters.
 */
export const FALLBACKS_ENABLED: boolean = env.fallbacks;
export const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

/** The five stages that call the model. Free strings are allowed for one-off tools. */
export type ModelCallName =
  | 'fingerprint'
  | 'pickTags'
  | 'channelC'
  | 'extractMentions'
  | 'score'
  | (string & {});

/** `output_config.effort`. The SDK also accepts `'max'`; no stage here needs it. */
export type Effort = 'low' | 'medium' | 'high' | 'xhigh';

/**
 * Failure reasons, all stable strings — the pipeline matches on them and the UI shows
 * them in `degraded[]`. `refusal:` and `error:` carry a suffix.
 */
export const REASON = {
  noApiKey: 'no_api_key',
  /** The account behind the key has no credit (a plain 400 saying so). */
  billing: 'billing',
  /** Anthropic rejected the key itself: 401, or a 403 the same fix applies to. */
  badApiKey: 'bad_api_key',
  rateLimited: 'rate_limited',
  /** Anthropic-side: 529 `overloaded_error`, or any other 5xx. */
  overloaded: 'overloaded',
  maxTokens: 'max_tokens',
  contextWindow: 'context_window_exceeded',
  parseFailed: 'parse_failed',
  aborted: 'aborted',
} as const;

/** True for the one failure the whole run degrades on rather than one stage. */
export function isNoApiKey(reason: string): boolean {
  return reason === REASON.noApiKey;
}

/**
 * The reasons that are about the ACCOUNT rather than about this one call: no credit, a
 * rejected key, a rate limit, an Anthropic-side outage. Every other stage would fail the
 * same way a second later, so the pipeline says so in plain words wherever one of these
 * surfaces — the whole run when Stage 2 hits it, the stage's own line when a cached
 * fingerprint carries the run past Stage 2. This file names them, `pipeline.ts` owns the
 * wording.
 */
export const ACCOUNT_FAILURE_REASONS: readonly string[] = [
  REASON.billing,
  REASON.badApiKey,
  REASON.rateLimited,
  REASON.overloaded,
];

/** True when the run failed because of the account or the key, not because of this call. */
export function isAccountFailure(reason: string): boolean {
  return ACCOUNT_FAILURE_REASONS.includes(reason);
}

/* ------------------------------------------------------------------------------------ *
 * Usage accounting
 * ------------------------------------------------------------------------------------ */

/**
 * The subset of `Anthropic.Usage` the run cares about. `Anthropic.Usage` (and its beta
 * twin) are assignable to this, so a real response can be recorded verbatim.
 */
export interface UsageLike {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

export interface UsageSnapshot {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

/**
 * A per-run accumulator. Created once by the pipeline, threaded into every stage, read
 * at the end for `stats.modelCalls` and the token counts.
 */
export interface ModelUsage extends UsageSnapshot {
  /** Counts one model call and adds its tokens. A call that never reached the API
   *  (no key, aborted before dispatch) is not recorded. */
  record(usage?: UsageLike | null): void;
  snapshot(): UsageSnapshot;
}

const num = (v: number | null | undefined): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : 0;

export function createUsageCounter(): ModelUsage {
  const counter: ModelUsage = {
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    record(usage) {
      counter.calls += 1;
      counter.inputTokens += num(usage?.input_tokens);
      counter.outputTokens += num(usage?.output_tokens);
      counter.cacheReadTokens += num(usage?.cache_read_input_tokens);
      counter.cacheCreationTokens += num(usage?.cache_creation_input_tokens);
    },
    snapshot() {
      return {
        calls: counter.calls,
        inputTokens: counter.inputTokens,
        outputTokens: counter.outputTokens,
        cacheReadTokens: counter.cacheReadTokens,
        cacheCreationTokens: counter.cacheCreationTokens,
      };
    },
  };
  return counter;
}

/* ------------------------------------------------------------------------------------ *
 * The transport seam
 * ------------------------------------------------------------------------------------ */

/** A `system` entry: one frozen prompt, marked cacheable. */
export interface SystemBlock {
  type: 'text';
  text: string;
  cache_control: { type: 'ephemeral' };
}

/**
 * The JSON-schema output format, as produced by `zodOutputFormat` — but as plain data.
 *
 * `zodOutputFormat` also hangs a `parse()` method off the object, and the SDK's
 * `messages.parse` THROWS `AnthropicError: Failed to parse structured output` when that
 * method rejects the model's text (see `lib/parser.js`). Throwing loses the response and
 * with it the usage we owe the run's token counts, so the method is dropped here: the SDK
 * only `JSON.parse`s, and this file validates the result against the zod schema itself.
 * A shape the schema rejects is then an ordinary `parse_failed` with its usage recorded.
 */
export interface OutputFormat {
  type: 'json_schema';
  schema: Record<string, unknown>;
}

/**
 * The assembled request, exactly as it goes to the API — this is what an injected
 * transport receives, so a test asserts on the real thing rather than on a summary.
 */
export interface ModelRequest {
  model: string;
  max_tokens: number;
  system: SystemBlock[];
  messages: Array<{ role: 'user'; content: string }>;
  output_config: { effort: Effort; format: OutputFormat };
  /** Present only on the fallback-enabled path (routed via `beta.messages.parse`). */
  betas?: string[];
  fallbacks?: 'default';
}

/**
 * What a transport hands back. Every field is optional so a fake can be one line:
 * `{ parsed_output: { ... } }`. The real path fills all of them.
 */
export interface ModelResponse {
  stop_reason?: string | null;
  stop_details?: { type?: string; category?: string | null; explanation?: string | null } | null;
  parsed_output?: unknown;
  content?: Array<{ type: string; text?: string }>;
  usage?: UsageLike | null;
}

export interface ModelCallMeta {
  name: ModelCallName;
  effort: Effort;
  signal?: AbortSignal;
}

export type ModelTransport = (
  request: ModelRequest,
  meta: ModelCallMeta,
) => Promise<ModelResponse>;

let transport: ModelTransport | null = null;

/**
 * Tests (and any keyless dry run) inject a fake here; `null` restores the real client.
 * When a transport is set it is used even without an `ANTHROPIC_API_KEY` — that is the
 * whole point, since this environment has no key.
 */
export function setModelTransport(fn: ModelTransport | null): void {
  transport = fn;
}

export function getModelTransport(): ModelTransport | null {
  return transport;
}

/* ------------------------------------------------------------------------------------ *
 * Logging
 * ------------------------------------------------------------------------------------ */

export interface ModelCallLog {
  name: ModelCallName;
  model: string;
  effort: Effort;
  ok: boolean;
  reason?: string;
  ms: number;
  input_tokens: number;
  cache_read_input_tokens: number;
  output_tokens: number;
}

export type ModelLogger = (entry: ModelCallLog) => void;

let logger: ModelLogger | null = null;

/** Tests assert on the log line instead of scraping stdout. `null` restores the default. */
export function setModelLogger(fn: ModelLogger | null): void {
  logger = fn;
}

function logCall(entry: ModelCallLog): void {
  if (logger) {
    logger(entry);
    return;
  }
  // Debug level, and silent under vitest so a 300-test run stays readable.
  if (process.env.NODE_ENV !== 'test') console.debug('[model]', JSON.stringify(entry));
}

/* ------------------------------------------------------------------------------------ *
 * The real client
 * ------------------------------------------------------------------------------------ */

let client: Anthropic | null = null;

function getClient(apiKey: string): Anthropic {
  client ??= new Anthropic({ apiKey, maxRetries: MAX_RETRIES });
  return client;
}

async function callLive(
  request: ModelRequest,
  apiKey: string,
  signal?: AbortSignal,
): Promise<ModelResponse> {
  const anthropic = getClient(apiKey);
  const options = { timeout: CALL_TIMEOUT_MS, signal };

  const body = {
    model: request.model,
    max_tokens: request.max_tokens,
    system: request.system,
    messages: request.messages,
    output_config: request.output_config,
  };

  // `fallbacks` and `betas` are typed on the beta Messages API only; the body is
  // otherwise identical, and `betas` travels as a header rather than in the body.
  if (request.betas && request.fallbacks) {
    return anthropic.beta.messages.parse(
      { ...body, betas: request.betas, fallbacks: request.fallbacks },
      options,
    );
  }
  return anthropic.messages.parse(body, options);
}

/* ------------------------------------------------------------------------------------ *
 * callStructured
 * ------------------------------------------------------------------------------------ */

export interface CallStructuredArgs<T> {
  /** Stage name, for the log line and for a fake transport to switch on. */
  name: ModelCallName;
  /** The output contract. Also re-validated in code, so a bad shape is `parse_failed`. */
  schema: z.ZodType<T>;
  /** Frozen, versioned, cacheable. Never interpolate volatile data into this. */
  system: string;
  /** Everything volatile. */
  user: string;
  effort: Effort;
  maxTokens?: number;
  /** The run's accumulator; the call records itself into it. */
  usage?: ModelUsage;
  signal?: AbortSignal;
}

export type CallResult<T> =
  | { ok: true; value: T; usage: UsageLike; ms: number }
  | { ok: false; reason: string };

/**
 * One structured model call. Returns typed output or a reason — never throws, never
 * returns half-parsed content.
 */
export async function callStructured<T>(args: CallStructuredArgs<T>): Promise<CallResult<T>> {
  const started = Date.now();
  const fail = (reason: string, usage?: UsageLike | null): CallResult<T> => {
    logCall({
      name: args.name,
      model: MODEL,
      effort: args.effort,
      ok: false,
      reason,
      ms: Date.now() - started,
      input_tokens: num(usage?.input_tokens),
      cache_read_input_tokens: num(usage?.cache_read_input_tokens),
      output_tokens: num(usage?.output_tokens),
    });
    return { ok: false, reason };
  };

  if (args.signal?.aborted) return fail(REASON.aborted);

  const injected = transport;
  const apiKey = env.anthropicApiKey;
  if (!injected && !apiKey) return fail(REASON.noApiKey);

  const format = zodOutputFormat(args.schema);
  const base: ModelRequest = {
    model: MODEL,
    max_tokens: args.maxTokens ?? DEFAULT_MAX_TOKENS,
    system: [{ type: 'text', text: args.system, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: args.user }],
    output_config: {
      effort: args.effort,
      format: { type: format.type, schema: format.schema },
    },
  };
  const meta: ModelCallMeta = { name: args.name, effort: args.effort, signal: args.signal };
  const send = (request: ModelRequest): Promise<ModelResponse> =>
    injected
      ? injected(request, meta)
      // Guarded above: with no transport there is a key.
      : callLive(request, apiKey as string, args.signal);

  let request: ModelRequest = FALLBACKS_ENABLED
    ? { ...base, betas: [FALLBACK_BETA], fallbacks: 'default' }
    : base;

  let res: ModelResponse;
  try {
    try {
      res = await send(request);
    } catch (err) {
      // A workspace without the refusal-fallback beta rejects the request outright.
      // Losing every recommendation over an optional nicety is not a degrade — retry
      // once on the plain endpoint and carry on without it. An account-level 400 (no
      // credit) is not about the beta: dropping it changes nothing, so retrying only
      // spends a second round trip to be told the same thing.
      if (!request.betas || !isBadRequest(err) || accountFailure(err)) throw err;
      request = base;
      res = await send(request);
    }
  } catch (err) {
    if (args.signal?.aborted || isAbortError(err)) return fail(REASON.aborted);
    if (isOutputParseError(err)) {
      // The response arrived and was billed; only its text was unusable. Tokens are
      // unrecoverable from the thrown error, so the call is counted with none.
      args.usage?.record();
      return fail(REASON.parseFailed);
    }
    // The account, the key or Anthropic itself — a stable token the pipeline can turn
    // into one sentence a listener can act on, rather than a truncated error body.
    const account = accountFailure(err);
    if (account) return fail(account);
    return fail(`error:${errorMessage(err)}`);
  }

  // The call happened: it is billable and counts toward `stats.modelCalls`, whatever
  // it answered.
  args.usage?.record(res.usage);

  if (args.signal?.aborted) return fail(REASON.aborted, res.usage);

  // Check why the model stopped before touching content. `refusal` is a normal stop
  // reason on this model family — a soft failure of one call, not a crash.
  if (res.stop_reason === 'refusal') {
    return fail(`refusal:${res.stop_details?.category ?? 'unknown'}`, res.usage);
  }
  if (res.stop_reason === 'max_tokens') return fail(REASON.maxTokens, res.usage);
  if (res.stop_reason === 'model_context_window_exceeded') {
    return fail(REASON.contextWindow, res.usage);
  }

  const candidate = extractOutput(res);
  if (candidate === undefined) return fail(REASON.parseFailed, res.usage);

  // Re-validate in code even though the SDK already parsed: it types the value, and it
  // holds an injected transport to the same contract as the model.
  const parsed = args.schema.safeParse(candidate);
  if (!parsed.success) return fail(REASON.parseFailed, res.usage);

  const ms = Date.now() - started;
  logCall({
    name: args.name,
    model: MODEL,
    effort: args.effort,
    ok: true,
    ms,
    input_tokens: num(res.usage?.input_tokens),
    cache_read_input_tokens: num(res.usage?.cache_read_input_tokens),
    output_tokens: num(res.usage?.output_tokens),
  });
  return { ok: true, value: parsed.data, usage: res.usage ?? {}, ms };
}

/**
 * `parsed_output` when the SDK (or the fake) supplied it, otherwise the first text
 * block read as JSON. `undefined` means there was nothing usable.
 */
function extractOutput(res: ModelResponse): unknown {
  if (res.parsed_output !== undefined && res.parsed_output !== null) return res.parsed_output;
  const text = (res.content ?? [])
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('')
    .trim();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function isAbortError(err: unknown): boolean {
  if (err instanceof Anthropic.APIUserAbortError) return true;
  return err instanceof Error && err.name === 'AbortError';
}

/**
 * The API rejected the request outright rather than failing transiently: a 400 (the
 * workspace cannot use `server-side-fallback-2026-07-01`, or the beta name is unknown to
 * this deployment) or a 404 on the beta endpoint. Only ever consulted to decide whether
 * to drop the optional fallback and retry once on the plain endpoint.
 */
function isBadRequest(err: unknown): boolean {
  if (err instanceof Anthropic.BadRequestError) return true;
  if (err instanceof Anthropic.NotFoundError) return true;
  return err instanceof Anthropic.APIError && (err.status === 400 || err.status === 404);
}

/**
 * The observed no-credit failure has no dedicated SDK class: it is a plain 400 typed
 * `invalid_request_error`, and only its sentence identifies it. `APIError.message` is
 * `"<status> " + the JSON body` whenever the body has no top-level `message` — and
 * Anthropic nests its own under `error.message` — so the API's words are inside it either
 * way. Anchored on the whole phrase so an unrelated 400 that merely mentions a balance
 * (and would still be worth the beta-drop retry) is not misfiled as billing.
 */
const CREDIT_BALANCE = /credit balance is too low/i;

/**
 * Classifies a thrown SDK error as an account-level failure, or `null` for everything
 * else (which stays `error:<message>`, exactly as before). Statuses rather than the error
 * subclasses: one switch covers 400/401/403/429/5xx and keeps classifying correctly if
 * Stainless ever stops minting a class for a status (a 529 is an `InternalServerError`
 * today only because `APIError.generate` maps every `>= 500` to it).
 *
 * 403 is folded into `bad_api_key`: a key the API will not let through is the same thing
 * to check as a key it does not recognise, and one sentence beats two.
 */
function accountFailure(err: unknown): string | null {
  if (!(err instanceof Anthropic.APIError)) return null;
  // The API's own classification, when it supplies one. A spend cap, a disabled
  // organisation or a dead card is a `billing_error` whose sentence looks nothing like
  // the no-credit one, so the phrase below would miss it.
  if (err.type === 'billing_error') return REASON.billing;
  const status = err.status;
  // `undefined` is a connection/abort error: the transport, not the account.
  if (typeof status !== 'number') return null;
  if (status === 400) return CREDIT_BALANCE.test(err.message) ? REASON.billing : null;
  if (status === 401 || status === 403) return REASON.badApiKey;
  if (status === 429) return REASON.rateLimited;
  if (status >= 500) return REASON.overloaded;
  return null;
}

/**
 * A client-side SDK error rather than an HTTP one — in practice only
 * "Failed to parse structured output", thrown when the response text is not JSON.
 * Everything that went wrong on the wire is an `APIError` subclass.
 */
function isOutputParseError(err: unknown): boolean {
  return err instanceof Anthropic.AnthropicError && !(err instanceof Anthropic.APIError);
}

/**
 * The API's own sentence, dug out of the response body.
 *
 * `APIError.message` is `"<status> " + JSON.stringify(body)` whenever the body has no
 * TOP-LEVEL `message`, and every Anthropic body nests its sentence under `error.message`
 * instead. Without this, EVERY http failure that is not an account failure reaches
 * `degraded[]` as raw JSON cut mid-object at 200 chars — a bad `ITSTINGS_MODEL` reads
 * `error:404 {"type":"error","error":{"type":"not_found_error","message":"model: …` rather
 * than `error:404 model: claude-opus-5-preview`. The status stays on the front: it is what
 * the SDK itself prefixes when a body does have a top-level message.
 */
function apiErrorSentence(err: unknown): string | null {
  if (!(err instanceof Anthropic.APIError)) return null;
  const body = err.error as { error?: { message?: unknown } } | undefined;
  const message = body?.error?.message;
  if (typeof message !== 'string' || message.trim() === '') return null;
  return typeof err.status === 'number' ? `${err.status} ${message}` : message;
}

function errorMessage(err: unknown): string {
  const raw = apiErrorSentence(err) ?? (err instanceof Error ? err.message : String(err));
  return raw.replace(/\s+/g, ' ').trim().slice(0, 200) || 'unknown';
}

/* ------------------------------------------------------------------------------------ *
 * Prompt helpers
 * ------------------------------------------------------------------------------------ */

export const TRUNCATION_MARKER = ' …[truncated]';

/**
 * Shortens untrusted or bulky text before it goes into a user message (Channel B caps
 * page text at 6000 chars). Cuts on a word boundary when one is near the end and always
 * says that it cut, so the model never treats a fragment as a complete document.
 * The result never exceeds `maxChars`.
 */
export function truncateForPrompt(text: string, maxChars: number): string {
  const normalized = (text ?? '').replace(/\r\n/g, '\n').trim();
  if (maxChars <= 0) return '';
  if (normalized.length <= maxChars) return normalized;
  if (maxChars <= TRUNCATION_MARKER.length) return normalized.slice(0, maxChars);

  const budget = maxChars - TRUNCATION_MARKER.length;
  let cut = normalized.slice(0, budget);
  const lastSpace = cut.lastIndexOf(' ');
  if (lastSpace > budget * 0.6) cut = cut.slice(0, lastSpace);
  return `${cut.trimEnd()}${TRUNCATION_MARKER}`;
}

/**
 * A fenced JSON block for a user message. Keys are sorted and `undefined` dropped, so
 * the same data always produces the same string — prompt caching and the run cache both
 * depend on that.
 */
export function jsonBlock(obj: unknown): string {
  return `\`\`\`json\n${stableJson(obj)}\n\`\`\``;
}

/** Pretty-printed JSON with sorted object keys. */
export function stableJson(value: unknown, indent = 2): string {
  return render(value, indent, 0);
}

function render(value: unknown, indent: number, depth: number): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  const pad = ' '.repeat(indent * (depth + 1));
  const closePad = ' '.repeat(indent * depth);

  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const items = value.map((v) => `${pad}${render(v, indent, depth + 1)}`);
    return `[\n${items.join(',\n')}\n${closePad}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  if (entries.length === 0) return '{}';
  const lines = entries.map(
    ([k, v]) => `${pad}${JSON.stringify(k)}: ${render(v, indent, depth + 1)}`,
  );
  return `{\n${lines.join(',\n')}\n${closePad}}`;
}
