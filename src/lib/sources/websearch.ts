/**
 * Web search — the ONLY legal route to forum evidence for Channel B.
 *
 * Reality that shapes this file (docs/api-reality.md §3.6):
 *  - Reddit's unauthenticated JSON is 403 and rateyourmusic is behind a Cloudflare
 *    challenge. This app never fetches either host, and never fetches a result URL at
 *    all: Channel B works from what the provider itself returns.
 *  - Tavily is primary (1,000 free credits/month, no card, no retention clause). Its
 *    `content` is up to three ≤500-char query-relevant chunks; `raw_content` is the
 *    cleaned page. `search_depth: 'basic'` is pinned at 1 credit per call.
 *  - Brave is the fallback and its ToS FORBIDS storing results, so Brave responses are
 *    fetched with `noStore: true` and never touch `http_cache`. Channel B may persist
 *    only its own extracted mentions for Brave.
 *  - Neither provider accepts a request without a key; with neither configured this
 *    returns `no_provider` without a request.
 */

import { z } from 'zod';

import { env } from '@/lib/env';
import { fetchExternal } from '@/lib/http/fetchExternal';
import {
  TTL,
  buildUrl,
  cleanQuery,
  fail,
  failureFromHttp,
  ok,
  parseBody,
  type SourceDescription,
  type SourceResult,
} from '@/lib/sources/common';

const TAVILY = 'https://api.tavily.com/search';
const BRAVE = 'https://api.search.brave.com/res/v1/web/search';

export type WebSearchProvider = 'tavily' | 'brave';

export interface WebSearchResult {
  url: string;
  title: string;
  snippet: string;
  /** Fuller text when the provider gives it (Tavily raw_content, Brave extra_snippets). */
  content?: string;
  score?: number;
}

export interface WebSearchResponse {
  provider: WebSearchProvider;
  /** True when the provider's terms forbid persisting these rows (Brave). */
  storable: boolean;
  results: WebSearchResult[];
}

const TavilySchema = z
  .object({
    query: z.string().optional(),
    results: z
      .array(
        z
          .object({
            url: z.string().optional(),
            title: z.string().optional(),
            content: z.string().optional(),
            raw_content: z.string().nullable().optional(),
            score: z.number().optional(),
          })
          .loose(),
      )
      .optional(),
  })
  .loose();

const BraveResultSchema = z
  .object({
    url: z.string().optional(),
    title: z.string().optional(),
    description: z.string().optional(),
    extra_snippets: z.array(z.string()).optional(),
    page_age: z.string().optional(),
  })
  .loose();

const BraveSchema = z
  .object({
    web: z.object({ results: z.array(BraveResultSchema).optional() }).loose().optional(),
    discussions: z.object({ results: z.array(BraveResultSchema).optional() }).loose().optional(),
  })
  .loose();

/** Which provider a call will use: an explicit choice, else Tavily, else Brave. */
export function providerFor(preferred?: WebSearchProvider): WebSearchProvider | null {
  if (preferred === 'tavily') return env.tavilyApiKey ? 'tavily' : null;
  if (preferred === 'brave') return env.braveApiKey ? 'brave' : null;
  return env.keys.websearch;
}

export interface SearchOptions {
  provider?: WebSearchProvider;
  maxResults?: number;
  includeDomains?: string[];
}

export async function search(
  query: string,
  { provider, maxResults = 8, includeDomains }: SearchOptions = {},
): Promise<SourceResult<WebSearchResponse>> {
  const q = cleanQuery(query);
  if (!q) return fail('invalid_request', 'empty query');

  const chosen = providerFor(provider);
  if (!chosen) {
    return fail(
      provider ? 'no_api_key' : 'no_provider',
      'neither TAVILY_API_KEY nor BRAVE_SEARCH_API_KEY is set',
    );
  }
  return chosen === 'tavily'
    ? tavilySearch(q, maxResults, includeDomains)
    : braveSearch(q, maxResults, includeDomains);
}

async function tavilySearch(
  query: string,
  maxResults: number,
  includeDomains?: string[],
): Promise<SourceResult<WebSearchResponse>> {
  const key = env.tavilyApiKey;
  if (!key) return fail('no_api_key', 'TAVILY_API_KEY is not set');

  const body: Record<string, unknown> = {
    query,
    search_depth: 'basic', // 1 credit; `advanced` costs 2 and we never auto-upgrade
    max_results: Math.min(Math.max(maxResults, 1), 20),
    include_raw_content: true,
  };
  if (includeDomains && includeDomains.length > 0) body.include_domains = includeDomains.slice(0, 300);

  const res = await fetchExternal({
    url: TAVILY,
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    ttlMs: TTL.websearch,
    retries: 1,
  });
  if (!res.ok) {
    return failureFromHttp(res, { 432: 'rate_limited', 433: 'rate_limited' });
  }

  const parsed = parseBody(res, TavilySchema);
  if (!parsed.ok) return parsed;

  const results: WebSearchResult[] = (parsed.value.results ?? [])
    .filter((r) => r.url)
    .map((r) => ({
      url: r.url as string,
      title: r.title ?? '',
      snippet: r.content ?? '',
      ...(r.raw_content ? { content: r.raw_content } : {}),
      ...(typeof r.score === 'number' ? { score: r.score } : {}),
    }));

  return ok(
    { provider: 'tavily', storable: true, results },
    { fromCache: parsed.fromCache, fetchedAt: parsed.fetchedAt },
  );
}

async function braveSearch(
  query: string,
  maxResults: number,
  includeDomains?: string[],
): Promise<SourceResult<WebSearchResponse>> {
  const key = env.braveApiKey;
  if (!key) return fail('no_api_key', 'BRAVE_SEARCH_API_KEY is not set');

  // Brave has no include_domains parameter; `site:` is its native equivalent.
  const scoped =
    includeDomains && includeDomains.length > 0
      ? `${query} ${includeDomains.map((d) => `site:${d}`).join(' OR ')}`
      : query;

  const url = buildUrl(BRAVE, {
    count: Math.min(Math.max(maxResults, 1), 20),
    extra_snippets: 'true',
    q: scoped.slice(0, 400),
    result_filter: 'web,discussions',
    text_decorations: 'false',
  });

  const res = await fetchExternal({
    url,
    headers: { 'X-Subscription-Token': key, Accept: 'application/json' },
    // Brave's terms forbid storing search results beyond transient operation.
    ttlMs: 0,
    noStore: true,
    retries: 1,
  });
  if (!res.ok) return failureFromHttp(res, { 422: 'invalid_api_key' });

  const parsed = parseBody(res, BraveSchema);
  if (!parsed.ok) return parsed;

  const raw = [...(parsed.value.web?.results ?? []), ...(parsed.value.discussions?.results ?? [])];
  const results: WebSearchResult[] = raw
    .filter((r) => r.url)
    .slice(0, maxResults)
    .map((r) => {
      const extra = (r.extra_snippets ?? []).join(' … ');
      return {
        url: r.url as string,
        title: r.title ?? '',
        snippet: r.description ?? '',
        ...(extra ? { content: extra } : {}),
      };
    });

  return ok(
    { provider: 'brave', storable: false, results },
    { fromCache: parsed.fromCache, fetchedAt: parsed.fetchedAt },
  );
}

export function describe(): SourceDescription {
  return { name: 'web', needsKey: true, configured: env.keys.websearch !== null };
}
