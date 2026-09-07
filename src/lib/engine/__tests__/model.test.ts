/**
 * `engine/model.ts` — the model seam.
 *
 * There is no `ANTHROPIC_API_KEY` in this environment and no test may make a live call,
 * so every branch is exercised through an injected transport. The one branch that needs
 * NO transport is the keyless fast path, which is exactly the runtime behaviour the
 * pipeline degrades on.
 */

import Anthropic from '@anthropic-ai/sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import {
  CALL_TIMEOUT_MS,
  DEFAULT_MAX_TOKENS,
  FALLBACK_BETA,
  FALLBACKS_ENABLED,
  MAX_RETRIES,
  MODEL,
  REASON,
  TRUNCATION_MARKER,
  callStructured,
  createUsageCounter,
  getModelTransport,
  isAccountFailure,
  isNoApiKey,
  jsonBlock,
  setModelLogger,
  setModelTransport,
  stableJson,
  truncateForPrompt,
  type ModelCallLog,
  type ModelRequest,
  type ModelResponse,
  type ModelTransport,
} from '@/lib/engine/model';

/* ------------------------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------------------------ */

const Answer = z.object({
  hook: z.string().describe('the one weird memorable thing'),
  confidence: z.enum(['low', 'medium', 'high']),
});
type Answer = z.infer<typeof Answer>;

const GOOD: Answer = { hook: 'the meowing', confidence: 'high' };

const USAGE = {
  input_tokens: 120,
  output_tokens: 30,
  cache_read_input_tokens: 900,
  cache_creation_input_tokens: 7,
};

/** Records what the transport saw, so a test can assert on the assembled request. */
function recorder(response: ModelResponse | ((req: ModelRequest) => ModelResponse)) {
  const seen: Array<{ request: ModelRequest; name: string; effort: string }> = [];
  const transport: ModelTransport = async (request, meta) => {
    seen.push({ request, name: meta.name, effort: meta.effort });
    return typeof response === 'function' ? response(request) : response;
  };
  setModelTransport(transport);
  return seen;
}

const ok = (value: unknown = GOOD): ModelResponse => ({
  stop_reason: 'end_turn',
  stop_details: null,
  parsed_output: value,
  usage: USAGE,
});

function call(overrides: Partial<Parameters<typeof callStructured<Answer>>[0]> = {}) {
  return callStructured({
    name: 'fingerprint',
    schema: Answer,
    system: 'FROZEN SYSTEM PROMPT v1',
    user: 'volatile seed data',
    effort: 'high',
    ...overrides,
  });
}

afterEach(() => {
  setModelTransport(null);
  setModelLogger(null);
});

/* ------------------------------------------------------------------------------------ *
 * Constants
 * ------------------------------------------------------------------------------------ */

describe('constants', () => {
  it('uses the bare model id with no date suffix', () => {
    expect(MODEL).toBe('claude-opus-5');
    expect(MODEL).not.toMatch(/-\d{8}$/);
  });

  it('matches docs/model.md on tokens, timeout and retries', () => {
    expect(DEFAULT_MAX_TOKENS).toBe(16_000);
    expect(CALL_TIMEOUT_MS).toBe(300_000);
    expect(MAX_RETRIES).toBe(2);
  });

  it('names the one reason the whole run degrades on', () => {
    expect(isNoApiKey(REASON.noApiKey)).toBe(true);
    expect(isNoApiKey(REASON.parseFailed)).toBe(false);
  });
});

/* ------------------------------------------------------------------------------------ *
 * The assembled request
 * ------------------------------------------------------------------------------------ */

describe('callStructured — the request the transport receives', () => {
  it('sends the system prompt as one cacheable text block and the volatile data as the user message', async () => {
    const seen = recorder(ok());
    await call();

    expect(seen).toHaveLength(1);
    const { request } = seen[0];
    expect(request.model).toBe(MODEL);
    expect(request.max_tokens).toBe(DEFAULT_MAX_TOKENS);
    expect(request.system).toEqual([
      {
        type: 'text',
        text: 'FROZEN SYSTEM PROMPT v1',
        cache_control: { type: 'ephemeral' },
      },
    ]);
    expect(request.messages).toEqual([{ role: 'user', content: 'volatile seed data' }]);
  });

  it('passes the effort and the zod schema through output_config', async () => {
    const seen = recorder(ok());
    await call({ effort: 'low' });

    const { request } = seen[0];
    expect(request.output_config.effort).toBe('low');
    expect(request.output_config.format.type).toBe('json_schema');
    // The `.describe()` text is what the model actually reads — assert it survives.
    expect(JSON.stringify(request.output_config.format.schema)).toContain(
      'the one weird memorable thing',
    );
  });

  it('sends the format as plain data — no parse() method rides along', async () => {
    const seen = recorder(ok());
    await call();

    const { format } = seen[0].request.output_config;
    expect(Object.keys(format).sort()).toEqual(['schema', 'type']);
    expect('parse' in format).toBe(false);
    // The whole request must survive a round trip: a transport may log or hash it.
    expect(JSON.parse(JSON.stringify(seen[0].request))).toEqual(seen[0].request);
  });

  it('never sends temperature, top_p, top_k or a thinking budget', async () => {
    const seen = recorder(ok());
    await call();

    const request = seen[0].request as unknown as Record<string, unknown>;
    expect(request.temperature).toBeUndefined();
    expect(request.top_p).toBeUndefined();
    expect(request.top_k).toBeUndefined();
    expect(request.thinking).toBeUndefined();
  });

  it('never prefills an assistant turn', async () => {
    const seen = recorder(ok());
    await call();
    expect(seen[0].request.messages.every((m) => m.role === 'user')).toBe(true);
  });

  it('honours a maxTokens override', async () => {
    const seen = recorder(ok());
    await call({ maxTokens: 2000 });
    expect(seen[0].request.max_tokens).toBe(2000);
  });

  it('tells the transport which call this is, so a fake can answer per stage', async () => {
    const seen = recorder(ok());
    await call({ name: 'pickTags', effort: 'low' });
    expect(seen[0].name).toBe('pickTags');
    expect(seen[0].effort).toBe('low');
  });

  it('asks for the server-side refusal fallback, which defaults on', async () => {
    expect(FALLBACKS_ENABLED).toBe(true);
    const seen = recorder(ok());
    await call();
    expect(seen[0].request.betas).toEqual([FALLBACK_BETA]);
    expect(seen[0].request.fallbacks).toBe('default');
  });

  it('exposes the injected transport and restores the real one on null', () => {
    const seen = recorder(ok());
    expect(getModelTransport()).not.toBeNull();
    expect(seen).toEqual([]);
    setModelTransport(null);
    expect(getModelTransport()).toBeNull();
  });
});

/* ------------------------------------------------------------------------------------ *
 * The optional refusal fallback
 * ------------------------------------------------------------------------------------ */

describe('callStructured — the refusal fallback is optional and degrades on its own', () => {
  const badRequest = (message: string) =>
    new Anthropic.BadRequestError(
      400,
      { type: 'error', error: { type: 'invalid_request_error', message } },
      message,
      new Headers(),
    );

  it('drops the beta and retries once when the workspace rejects it', async () => {
    const seen: ModelRequest[] = [];
    setModelTransport(async (request) => {
      seen.push(request);
      if (request.betas) throw badRequest('betas: unsupported beta');
      return ok();
    });

    const res = await call();

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value).toEqual(GOOD);
    expect(seen).toHaveLength(2);
    expect(seen[0].betas).toEqual([FALLBACK_BETA]);
    expect(seen[1].betas).toBeUndefined();
    expect(seen[1].fallbacks).toBeUndefined();
    // The retry is the same call, not a different one.
    expect(seen[1].messages).toEqual(seen[0].messages);
    expect(seen[1].system).toEqual(seen[0].system);
  });

  it('counts the retried call once', async () => {
    const usage = createUsageCounter();
    let first = true;
    setModelTransport(async () => {
      if (first) {
        first = false;
        throw badRequest('betas: unsupported beta');
      }
      return ok();
    });

    await call({ usage });
    expect(usage.calls).toBe(1);
    expect(usage.inputTokens).toBe(120);
  });

  it('does not retry a transient failure — that would double every timeout', async () => {
    let calls = 0;
    setModelTransport(async () => {
      calls += 1;
      throw new Anthropic.APIConnectionError({ message: 'Connection error.' });
    });

    const res = await call();
    expect(res).toEqual({ ok: false, reason: 'error:Connection error.' });
    expect(calls).toBe(1);
  });

  it('degrades when the retry fails too', async () => {
    setModelTransport(async () => {
      throw badRequest('max_tokens: too large');
    });
    const res = await call();
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason.startsWith('error:')).toBe(true);
  });
});

/* ------------------------------------------------------------------------------------ *
 * Account-level failures
 * ------------------------------------------------------------------------------------ */

describe('callStructured — the account and the key fail by name, not by error body', () => {
  /** The real shape: the API's sentence sits under `error.message`, and the SDK's own
   *  `message` becomes `"<status> " + that body as JSON`. */
  const apiError = (status: number, message: string, type = 'invalid_request_error') =>
    Anthropic.APIError.generate(
      status,
      { type: 'error', error: { type, message } },
      message,
      new Headers(),
    );

  const throwing = (err: unknown) => {
    let calls = 0;
    setModelTransport(async () => {
      calls += 1;
      throw err;
    });
    return () => calls;
  };

  it('a 400 about the credit balance -> billing, and it is NOT retried without the beta', async () => {
    const calls = throwing(
      apiError(
        400,
        'Your credit balance is too low to access the Anthropic API. Please go to Plans'
          + ' & Billing to upgrade or purchase credits.',
      ),
    );

    const res = await call();

    expect(res).toEqual({ ok: false, reason: REASON.billing });
    // Dropping the fallback beta cannot buy credit; one round trip is the whole story.
    expect(calls()).toBe(1);
  });

  it('any other 400 keeps the beta-drop retry and still ends as error:<message>', async () => {
    const calls = throwing(apiError(400, 'betas: unsupported beta'));

    const res = await call();

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason.startsWith('error:')).toBe(true);
    expect(calls()).toBe(2);
  });

  it('401 and 403 -> bad_api_key: the same thing to go and check', async () => {
    throwing(apiError(401, 'invalid x-api-key'));
    expect(await call()).toEqual({ ok: false, reason: REASON.badApiKey });

    throwing(apiError(403, 'Request not allowed'));
    expect(await call()).toEqual({ ok: false, reason: REASON.badApiKey });
  });

  it('429 -> rate_limited', async () => {
    throwing(apiError(429, 'rate limit exceeded'));
    expect(await call()).toEqual({ ok: false, reason: REASON.rateLimited });
  });

  it('529 and any other 5xx -> overloaded, classified by status rather than by class', async () => {
    // The SDK maps every >= 500 to `InternalServerError`, 529 included; `accountFailure`
    // switches on the status anyway, so an unmapped status would still land here.
    const overloaded = apiError(529, 'Overloaded');
    expect(overloaded.status).toBe(529);
    expect(overloaded).toBeInstanceOf(Anthropic.InternalServerError);
    throwing(overloaded);
    expect(await call()).toEqual({ ok: false, reason: REASON.overloaded });

    throwing(apiError(500, 'Internal server error'));
    expect(await call()).toEqual({ ok: false, reason: REASON.overloaded });
  });

  it('a body typed billing_error is billing however it is phrased', async () => {
    // A spend cap, a disabled organisation, a dead card: the API says `billing_error` and
    // the sentence looks nothing like the no-credit one, so the phrase alone would miss it.
    const calls = throwing(
      apiError(400, 'Your organization has reached its monthly spend limit.', 'billing_error'),
    );
    expect(await call()).toEqual({ ok: false, reason: REASON.billing });
    expect(calls()).toBe(1);
  });

  it('a 400 that merely mentions a balance is not billing and keeps its retry', async () => {
    const calls = throwing(apiError(400, 'credit balance metadata is not a valid field'));
    const res = await call();
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason.startsWith('error:')).toBe(true);
    expect(calls()).toBe(2);
  });

  it('a 404 is still an ordinary error, not an account failure', async () => {
    throwing(apiError(404, 'model: claude-opus-5-preview'));
    const res = await call();
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason.startsWith('error:')).toBe(true);
  });

  it('an ordinary API failure reports the API\'s sentence, never its JSON body', async () => {
    // `APIError.message` is `"<status> " + JSON.stringify(body)` for every Anthropic body,
    // so without `apiErrorSentence` this line reaches `degraded[]` as JSON cut at 200 chars.
    throwing(apiError(404, 'model: claude-opus-5-preview', 'not_found_error'));
    const res = await call();

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('error:404 model: claude-opus-5-preview');
    expect(res.reason).not.toMatch(/[{}]|not_found_error/);
  });

  it('names exactly the reasons the whole run degrades on', () => {
    for (const reason of [
      REASON.billing,
      REASON.badApiKey,
      REASON.rateLimited,
      REASON.overloaded,
    ]) {
      expect(isAccountFailure(reason)).toBe(true);
    }
    expect(isAccountFailure(REASON.parseFailed)).toBe(false);
    expect(isAccountFailure(REASON.maxTokens)).toBe(false);
    // The keyless path keeps its own predicate.
    expect(isAccountFailure(REASON.noApiKey)).toBe(false);
  });
});

/* ------------------------------------------------------------------------------------ *
 * Success
 * ------------------------------------------------------------------------------------ */

describe('callStructured — success', () => {
  it('returns the parsed value and the usage', async () => {
    recorder(ok());
    const res = await call();

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value).toEqual(GOOD);
    expect(res.usage.input_tokens).toBe(120);
    expect(typeof res.ms).toBe('number');
  });

  it('falls back to reading a JSON text block when the transport gives no parsed_output', async () => {
    recorder({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: JSON.stringify(GOOD) }],
      usage: USAGE,
    });
    const res = await call();

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value).toEqual(GOOD);
  });

  it('ignores non-text blocks when reading content', async () => {
    recorder({
      stop_reason: 'end_turn',
      content: [
        { type: 'thinking' },
        { type: 'text', text: JSON.stringify(GOOD) },
      ],
      usage: USAGE,
    });
    const res = await call();
    expect(res.ok).toBe(true);
  });

  it('accepts a minimal fake: parsed_output alone', async () => {
    setModelTransport(async () => ({ parsed_output: GOOD }));
    const res = await call();
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.usage).toEqual({});
  });
});

/* ------------------------------------------------------------------------------------ *
 * Every failure branch
 * ------------------------------------------------------------------------------------ */

describe('callStructured — failures degrade, never throw', () => {
  it('no ANTHROPIC_API_KEY and no transport -> no_api_key, without calling anything', async () => {
    setModelTransport(null);
    const res = await call();
    expect(res).toEqual({ ok: false, reason: 'no_api_key' });
  });

  it('refusal -> refusal:<category>', async () => {
    recorder({
      stop_reason: 'refusal',
      stop_details: { type: 'refusal', category: 'general_harms', explanation: null },
      usage: USAGE,
    });
    const res = await call();
    expect(res).toEqual({ ok: false, reason: 'refusal:general_harms' });
  });

  it('refusal without stop_details -> refusal:unknown', async () => {
    recorder({ stop_reason: 'refusal', stop_details: null, usage: USAGE });
    const res = await call();
    expect(res).toEqual({ ok: false, reason: 'refusal:unknown' });
  });

  it('a refusal is checked before the content, even when content parses', async () => {
    recorder({ stop_reason: 'refusal', parsed_output: GOOD, usage: USAGE });
    const res = await call();
    expect(res.ok).toBe(false);
  });

  it('max_tokens -> max_tokens', async () => {
    recorder({ stop_reason: 'max_tokens', parsed_output: GOOD, usage: USAGE });
    const res = await call();
    expect(res).toEqual({ ok: false, reason: 'max_tokens' });
  });

  it('model_context_window_exceeded -> context_window_exceeded', async () => {
    recorder({ stop_reason: 'model_context_window_exceeded', usage: USAGE });
    const res = await call();
    expect(res).toEqual({ ok: false, reason: 'context_window_exceeded' });
  });

  it('no output at all -> parse_failed', async () => {
    recorder({ stop_reason: 'end_turn', usage: USAGE });
    const res = await call();
    expect(res).toEqual({ ok: false, reason: 'parse_failed' });
  });

  it('text that is not JSON -> parse_failed', async () => {
    recorder({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'Sure! Here is the answer:' }],
      usage: USAGE,
    });
    const res = await call();
    expect(res).toEqual({ ok: false, reason: 'parse_failed' });
  });

  it('output that does not match the schema -> parse_failed (a fake is held to the same contract)', async () => {
    recorder({ stop_reason: 'end_turn', parsed_output: { hook: 42 }, usage: USAGE });
    const res = await call();
    expect(res).toEqual({ ok: false, reason: 'parse_failed' });
  });

  it('a transport that throws -> error:<message>, not an exception', async () => {
    setModelTransport(async () => {
      throw new Error('socket hang up');
    });
    const res = await call();
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('error:socket hang up');
  });

  it('collapses whitespace and caps the length of a transport error message', async () => {
    setModelTransport(async () => {
      throw new Error(`overloaded\n\n${'x'.repeat(500)}`);
    });
    const res = await call();
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason.startsWith('error:overloaded x')).toBe(true);
      expect(res.reason.length).toBeLessThanOrEqual('error:'.length + 200);
    }
  });

  it("the SDK's own \"failed to parse structured output\" throw -> parse_failed, and the call is still counted", async () => {
    const usage = createUsageCounter();
    setModelTransport(async () => {
      throw new Anthropic.AnthropicError('Failed to parse structured output: Error: bad');
    });

    const res = await call({ usage });

    expect(res).toEqual({ ok: false, reason: 'parse_failed' });
    expect(usage.calls).toBe(1);
    expect(usage.inputTokens).toBe(0);
  });

  it('an HTTP error from the SDK is not mistaken for a parse failure', async () => {
    setModelTransport(async () => {
      throw new Anthropic.APIConnectionError({ message: 'Connection error.' });
    });
    const res = await call();
    expect(res).toEqual({ ok: false, reason: 'error:Connection error.' });
  });

  it('a non-Error throw still degrades', async () => {
    setModelTransport(async () => {
      throw 'nope';
    });
    const res = await call();
    expect(res).toEqual({ ok: false, reason: 'error:nope' });
  });
});

/* ------------------------------------------------------------------------------------ *
 * Abort
 * ------------------------------------------------------------------------------------ */

describe('callStructured — abort', () => {
  it('an already-aborted signal short-circuits before the transport is touched', async () => {
    const seen = recorder(ok());
    const controller = new AbortController();
    controller.abort();

    const res = await call({ signal: controller.signal });
    expect(res).toEqual({ ok: false, reason: 'aborted' });
    expect(seen).toHaveLength(0);
  });

  it('a signal aborted while the call is in flight -> aborted, not a stale result', async () => {
    const controller = new AbortController();
    setModelTransport(async () => {
      controller.abort();
      return ok();
    });

    const res = await call({ signal: controller.signal });
    expect(res).toEqual({ ok: false, reason: 'aborted' });
  });

  it('an AbortError thrown by the transport -> aborted', async () => {
    setModelTransport(async () => {
      const err = new Error('Request was aborted.');
      err.name = 'AbortError';
      throw err;
    });
    const res = await call();
    expect(res).toEqual({ ok: false, reason: 'aborted' });
  });
});

/* ------------------------------------------------------------------------------------ *
 * Usage accounting
 * ------------------------------------------------------------------------------------ */

describe('createUsageCounter', () => {
  it('starts at zero', () => {
    const usage = createUsageCounter();
    expect(usage.snapshot()).toEqual({
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    });
  });

  it('accumulates across calls', () => {
    const usage = createUsageCounter();
    usage.record(USAGE);
    usage.record(USAGE);
    expect(usage.snapshot()).toEqual({
      calls: 2,
      inputTokens: 240,
      outputTokens: 60,
      cacheReadTokens: 1800,
      cacheCreationTokens: 14,
    });
  });

  it('counts a call whose usage is absent or partial', () => {
    const usage = createUsageCounter();
    usage.record(undefined);
    usage.record(null);
    usage.record({ input_tokens: 5, cache_read_input_tokens: null });
    expect(usage.calls).toBe(3);
    expect(usage.inputTokens).toBe(5);
    expect(usage.cacheReadTokens).toBe(0);
  });

  it('is recorded by a successful call', async () => {
    recorder(ok());
    const usage = createUsageCounter();
    await call({ usage });
    expect(usage.calls).toBe(1);
    expect(usage.inputTokens).toBe(120);
    expect(usage.outputTokens).toBe(30);
    expect(usage.cacheReadTokens).toBe(900);
  });

  it('is recorded by a refused or truncated call — those cost tokens too', async () => {
    const usage = createUsageCounter();

    recorder({ stop_reason: 'refusal', stop_details: { category: 'bio' }, usage: USAGE });
    await call({ usage });
    recorder({ stop_reason: 'max_tokens', usage: USAGE });
    await call({ usage });

    expect(usage.calls).toBe(2);
    expect(usage.inputTokens).toBe(240);
  });

  it('is NOT recorded when the call never reached the API', async () => {
    const usage = createUsageCounter();

    setModelTransport(null);
    await call({ usage });                                   // no_api_key

    setModelTransport(async () => {
      throw new Error('connection refused');
    });
    await call({ usage });                                   // transport error

    const controller = new AbortController();
    controller.abort();
    recorder(ok());
    await call({ usage, signal: controller.signal });        // aborted before dispatch

    expect(usage.calls).toBe(0);
  });
});

/* ------------------------------------------------------------------------------------ *
 * Logging
 * ------------------------------------------------------------------------------------ */

describe('per-call logging', () => {
  it('logs name, model, effort, tokens and duration on success', async () => {
    const entries: ModelCallLog[] = [];
    setModelLogger((e) => entries.push(e));
    recorder(ok());

    await call({ name: 'score', effort: 'high' });

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      name: 'score',
      model: MODEL,
      effort: 'high',
      ok: true,
      input_tokens: 120,
      cache_read_input_tokens: 900,
      output_tokens: 30,
    });
    expect(typeof entries[0].ms).toBe('number');
  });

  it('logs the reason on failure', async () => {
    const entries: ModelCallLog[] = [];
    setModelLogger((e) => entries.push(e));
    recorder({ stop_reason: 'refusal', stop_details: { category: 'cyber' }, usage: USAGE });

    await call();

    expect(entries[0].ok).toBe(false);
    expect(entries[0].reason).toBe('refusal:cyber');
  });

  it('logs the keyless fast path too', async () => {
    const entries: ModelCallLog[] = [];
    setModelLogger((e) => entries.push(e));
    setModelTransport(null);

    await call();

    expect(entries[0]).toMatchObject({ ok: false, reason: 'no_api_key', input_tokens: 0 });
  });

  it('writes one debug line to the server console when no logger is installed', async () => {
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.stubEnv('NODE_ENV', 'development');
    setModelLogger(null);
    recorder(ok());

    await call();

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toBe('[model]');
    expect(JSON.parse(String(spy.mock.calls[0][1]))).toMatchObject({
      name: 'fingerprint',
      model: MODEL,
      effort: 'high',
      ok: true,
    });

    vi.unstubAllEnvs();
    spy.mockRestore();
  });

  it('an installed logger replaces the console line rather than adding to it', async () => {
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.stubEnv('NODE_ENV', 'development');
    setModelLogger(() => {});
    recorder(ok());

    await call();

    expect(spy).not.toHaveBeenCalled();

    vi.unstubAllEnvs();
    spy.mockRestore();
  });

  it('stays quiet under vitest so a full run remains readable', async () => {
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    setModelLogger(null);
    recorder(ok());

    await call();

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

/* ------------------------------------------------------------------------------------ *
 * Prompt helpers
 * ------------------------------------------------------------------------------------ */

describe('truncateForPrompt', () => {
  it('returns short text untouched, trimmed', () => {
    expect(truncateForPrompt('  swung upright bass  ', 100)).toBe('swung upright bass');
  });

  it('normalises CRLF so the same page text always hashes the same', () => {
    expect(truncateForPrompt('a\r\nb', 100)).toBe('a\nb');
  });

  it('marks a cut so the model never mistakes a fragment for the whole document', () => {
    const out = truncateForPrompt('x'.repeat(500), 100);
    expect(out.endsWith(TRUNCATION_MARKER)).toBe(true);
    expect(out.length).toBeLessThanOrEqual(100);
  });

  it('cuts on a word boundary when one is near the end', () => {
    const text = 'the quick brown fox jumps over the lazy dog and keeps on running for ages';
    const out = truncateForPrompt(text, 40);
    expect(out.length).toBeLessThanOrEqual(40);
    expect(out.endsWith(TRUNCATION_MARKER)).toBe(true);
    expect(out.replace(TRUNCATION_MARKER, '')).toBe('the quick brown fox jumps');
  });

  it('does not cut mid-document when the only space is at the very start', () => {
    const out = truncateForPrompt(`a ${'b'.repeat(200)}`, 50);
    expect(out.length).toBeLessThanOrEqual(50);
    expect(out.startsWith('a b')).toBe(true);
  });

  it('handles degenerate budgets', () => {
    expect(truncateForPrompt('anything', 0)).toBe('');
    expect(truncateForPrompt('anything', -5)).toBe('');
    expect(truncateForPrompt('anything', 3)).toBe('any');
    expect(truncateForPrompt('', 10)).toBe('');
  });
});

describe('jsonBlock / stableJson', () => {
  it('fences the block as json', () => {
    const block = jsonBlock({ a: 1 });
    expect(block.startsWith('```json\n')).toBe(true);
    expect(block.endsWith('\n```')).toBe(true);
  });

  it('sorts keys, so the same data always produces the same prompt', () => {
    const a = jsonBlock({ title: 'The Lovecats', artist: 'The Cure', year: 1983 });
    const b = jsonBlock({ year: 1983, artist: 'The Cure', title: 'The Lovecats' });
    expect(a).toBe(b);
    expect(a.indexOf('"artist"')).toBeLessThan(a.indexOf('"title"'));
    expect(a.indexOf('"title"')).toBeLessThan(a.indexOf('"year"'));
  });

  it('keeps array order — a ranked list is data, not a set', () => {
    expect(stableJson(['b', 'a', 'c'])).toBe('[\n  "b",\n  "a",\n  "c"\n]');
  });

  it('drops undefined and keeps null (an absent measurement stays visible)', () => {
    expect(stableJson({ bpm: null, key: undefined })).toBe('{\n  "bpm": null\n}');
  });

  it('renders empty containers compactly', () => {
    expect(stableJson({ tags: [], features: {} })).toBe(
      '{\n  "features": {},\n  "tags": []\n}',
    );
  });

  it('nests', () => {
    expect(stableJson({ outer: { b: 2, a: [1, { z: 1, y: 2 }] } })).toBe(
      [
        '{',
        '  "outer": {',
        '    "a": [',
        '      1,',
        '      {',
        '        "y": 2,',
        '        "z": 1',
        '      }',
        '    ],',
        '    "b": 2',
        '  }',
        '}',
      ].join('\n'),
    );
  });
});
