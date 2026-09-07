/**
 * Test transport. NOT a test file (vitest only collects `*.test.ts`).
 *
 * Every source test injects real recorded bodies from `__fixtures__/` at the ONE seam —
 * `setFetchImpl` — so nothing in the suite can reach the network even by accident. A
 * request that matches no route fails loudly rather than falling through to `fetch`.
 */

import fs from 'node:fs';
import path from 'node:path';

import { getDb } from '@/lib/db';
import { setFetchImpl } from '@/lib/http/fetchExternal';
import { resetLimiters } from '@/lib/http/rateLimit';

const FIXTURES = path.join(process.cwd(), 'src', 'lib', 'sources', '__fixtures__');

/** The recorded body of a fixture, parsed. */
export function fixture<T = unknown>(name: string): T {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES, `${name}.json`), 'utf8')) as T;
}

/** The recorded HTTP status of a fixture (404 for the misses, 422 for Brave, …). */
export function fixtureStatus(name: string): number {
  const manifest = JSON.parse(fs.readFileSync(path.join(FIXTURES, '_manifest.json'), 'utf8')) as
    Record<string, { status?: number }>;
  return manifest[name]?.status ?? 200;
}

export interface Route {
  /** Substring of the URL, or a predicate over (url, init). */
  when: string | RegExp | ((url: string, init?: RequestInit) => boolean);
  /** A fixture name, an object (stringified), or a literal body string. */
  body: string | unknown;
  status?: number;
  /** Serve this route only once, then fall through to later routes. */
  once?: boolean;
}

export interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

export interface Harness {
  calls: RecordedCall[];
  /** URLs only, in order — the readable form for assertions. */
  urls(): string[];
}

function matches(route: Route, url: string, init?: RequestInit): boolean {
  if (typeof route.when === 'string') return url.includes(route.when);
  if (route.when instanceof RegExp) return route.when.test(url);
  return route.when(url, init);
}

/**
 * Install a fake transport for the given routes. Call `resetHarness()` afterwards
 * (`afterEach`) to restore the platform fetch.
 */
export function installFetch(routes: Route[]): Harness {
  const calls: RecordedCall[] = [];
  const used = new Set<Route>();

  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({
      url,
      method: init?.method ?? 'GET',
      headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)),
      body: init?.body as string | undefined,
    });

    const route = routes.find((r) => (!r.once || !used.has(r)) && matches(r, url, init));
    if (!route) {
      throw new Error(`no fixture route for ${init?.method ?? 'GET'} ${url}`);
    }
    if (route.once) used.add(route);

    const body = typeof route.body === 'string' ? route.body : JSON.stringify(route.body);
    return new Response(body, { status: route.status ?? 200 });
  }) as typeof fetch;

  setFetchImpl(impl);
  return { calls, urls: () => calls.map((c) => c.url) };
}

/** Restores the real transport and clears every piece of cross-test state. */
export function resetHarness(): void {
  setFetchImpl(null);
  resetLimiters();
  getDb().exec('DELETE FROM http_cache; DELETE FROM tracks; DELETE FROM verifications;');
}

/**
 * iTunes really does prefix its JSON with three newlines (bytes `0a0a0a7b`). Tests that
 * care about the parse use this instead of a plain object body.
 */
export function itunesBody(name: string): string {
  return `\n\n\n${JSON.stringify(fixture(name))}`;
}
