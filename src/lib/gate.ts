/**
 * The shared instance's two guard rails: the invite gate and the cost caps.
 *
 * This module is imported by `src/proxy.ts`, which Next bundles as the proxy (middleware)
 * entry. That is why it has exactly ONE dependency — `node:crypto` — and in particular
 * why it does NOT import `@/lib/env` (which is `server-only`) or `@/lib/db` (which loads
 * better-sqlite3's native binary). Everything here is either a pure function or a read of
 * `process.env`, so the same rules can be unit-tested without a request, a database or a
 * running server.
 *
 * The database side of the caps lives in `@/lib/db/repos/counters`, which imports this
 * file for its bucket keys and limits. Never the other way round.
 *
 * Both features are OFF by default:
 *   - no `ITSTINGS_ACCESS_TOKEN`            -> no gate, the app behaves exactly as it did
 *     locally (docs/tasks/phase7-ship.md §4);
 *   - no `ITSTINGS_MAX_RUNS_PER_DAY` / `ITSTINGS_MAX_RUNS_PER_IP_PER_HOUR` -> unlimited.
 *     The deployed image turns them on: the Dockerfile and fly.toml set 60 and 6.
 */

import { timingSafeEqual } from 'node:crypto';

/** The env vars this module reads. `process.env` in production, a literal in tests. */
export type EnvSource = Record<string, string | undefined>;

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

/** Cookie that carries the invite token once a `?key=` link has been opened. */
export const GATE_COOKIE = 'itstings';

/** 180 days, in seconds — a link you were sent in March still works in September. */
export const GATE_COOKIE_MAX_AGE_SECONDS = 180 * 24 * 60 * 60;

/** The drawn page a browser without the cookie is sent to. */
export const GATE_PATH = '/gate';

/** The query parameter that carries the token in an invite link. */
export const GATE_KEY_PARAM = 'key';

/** The one line of copy on `/gate`, and the message an API 401 carries. */
export const INVITE_ONLY_MESSAGE =
  "this one's invite-only — ask whoever sent you for the link";

/**
 * Paths the gate never touches:
 *   `/api/health`  the healthcheck runs before anything has a cookie (Docker, Fly);
 *   `/gate`        the page that explains the gate cannot be behind it;
 *   `/_next/*`     the build's own JS/CSS/fonts — a gated page still has to render;
 *   `/favicon.ico` and friends: files served straight out of `public/`.
 */
const BYPASS_PREFIXES = ['/api/health', GATE_PATH];
const BYPASS_EXACT = new Set([
  '/favicon.ico',
  '/robots.txt',
  '/sitemap.xml',
  '/manifest.json',
  '/apple-touch-icon.png',
]);
/** Anything served from `public/` by extension (the mockups' SVGs, an og image, …). */
const STATIC_FILE = /\.(?:ico|png|jpg|jpeg|gif|svg|webp|avif|woff2?|ttf|otf|txt|xml|webmanifest)$/i;

export function isBypassedPath(pathname: string): boolean {
  if (BYPASS_EXACT.has(pathname)) return true;
  if (STATIC_FILE.test(pathname)) return true;
  if (pathname.startsWith('/_next/')) return true;
  return BYPASS_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** `/api/...` answers 401 JSON; everything else is a browser and gets redirected. */
export function isApiPath(pathname: string): boolean {
  return pathname === '/api' || pathname.startsWith('/api/');
}

/** The configured token, or null when the gate is off. Empty/whitespace counts as unset. */
export function accessToken(source: EnvSource = process.env): string | null {
  const raw = source.ITSTINGS_ACCESS_TOKEN?.trim();
  return raw && raw.length > 0 ? raw : null;
}

export function gateEnabled(source: EnvSource = process.env): boolean {
  return accessToken(source) !== null;
}

/**
 * Constant-time comparison. `timingSafeEqual` THROWS on a length mismatch, which would
 * turn "wrong length" into a different (and much faster) code path, so the length check
 * is folded into the boolean instead: when the lengths differ the candidate is compared
 * against itself — the same work — and `sameLength` is what makes the answer false.
 */
export function tokenMatches(candidate: string | null | undefined, token: string | null): boolean {
  if (token === null || candidate === null || candidate === undefined) return false;
  const a = Buffer.from(candidate, 'utf8');
  const b = Buffer.from(token, 'utf8');
  // Compare a against a fixed-length copy so the work is the same either way, then AND in
  // the length equality. `timingSafeEqual` never sees mismatched lengths.
  const sameLength = a.length === b.length;
  const rhs = sameLength ? b : a;
  const equal = timingSafeEqual(a, rhs);
  return sameLength && equal;
}

export type GateDecision =
  /** No gate, a bypassed path, or a valid cookie: hand the request through untouched. */
  | { action: 'allow' }
  /** A valid `?key=`: set the cookie and redirect to the same URL without the key. */
  | { action: 'grant'; location: string }
  /** A browser with no valid credential: send it to the drawn `/gate` page. */
  | { action: 'challenge'; location: string }
  /** An API request with no valid credential: 401 JSON, no redirect. */
  | { action: 'deny'; message: string };

export interface GateRequest {
  /** Request path, no query string. */
  pathname: string;
  /** The query string, with or without the leading `?`. */
  search?: string;
  /** Value of the `itstings` cookie, if the request carried one. */
  cookie?: string | null;
}

/**
 * The whole gate, as one pure function. `src/proxy.ts` is the only caller; it turns the
 * decision into a `NextResponse` and owns the cookie attributes.
 *
 * Order matters: a valid `?key=` wins over a stale cookie, so re-sending someone the
 * invite link is always the fix when their cookie is wrong.
 */
export function decideAccess(
  request: GateRequest,
  token: string | null = accessToken(),
): GateDecision {
  if (token === null) return { action: 'allow' };
  if (isBypassedPath(request.pathname)) return { action: 'allow' };

  const params = new URLSearchParams(request.search ?? '');
  const key = params.get(GATE_KEY_PARAM);
  if (tokenMatches(key, token)) {
    params.delete(GATE_KEY_PARAM);
    const rest = params.toString();
    return { action: 'grant', location: rest ? `${request.pathname}?${rest}` : request.pathname };
  }

  if (tokenMatches(request.cookie, token)) return { action: 'allow' };

  if (isApiPath(request.pathname)) return { action: 'deny', message: INVITE_ONLY_MESSAGE };
  return { action: 'challenge', location: GATE_PATH };
}

/** The link the owner sends to a friend. Documented in README.md and docs/deploy.md. */
export function inviteLink(origin: string, token: string): string {
  const url = new URL('/', origin);
  url.searchParams.set(GATE_KEY_PARAM, token);
  return url.toString();
}

// ---------------------------------------------------------------------------
// The cost caps
// ---------------------------------------------------------------------------

/** What the deployed image sets. Unset locally means unlimited, not this. */
export const DEFAULT_MAX_RUNS_PER_DAY = 60;
export const DEFAULT_MAX_RUNS_PER_IP_PER_HOUR = 6;

/** `run_counters.scope` values. Two scopes, two bucket shapes. */
export const SCOPE_DAY = 'day';
export const SCOPE_IP_HOUR = 'ip-hour';

export interface RunCaps {
  /** Runs per UTC day across the whole instance. `null` = unlimited. */
  perDay: number | null;
  /** Runs per hour per client IP. `null` = unlimited. */
  perIpPerHour: number | null;
}

/**
 * Absent -> unlimited (the local default: the brief was a single-user app and nothing
 * should change for the owner). `0` -> unlimited, explicitly. A positive integer -> that
 * many. Anything else (a typo, `"sixty"`, `-3`) -> the deployed default, because a typo
 * that silently removes a spending limit is the expensive failure.
 */
function parseCap(raw: string | undefined, fallback: number): number | null {
  const value = raw?.trim();
  if (value === undefined || value === '') return null;
  if (!/^-?\d+$/.test(value)) return fallback;
  const n = Number(value);
  if (n === 0) return null;
  if (n < 0) return fallback;
  return n;
}

export function runCaps(source: EnvSource = process.env): RunCaps {
  return {
    perDay: parseCap(source.ITSTINGS_MAX_RUNS_PER_DAY, DEFAULT_MAX_RUNS_PER_DAY),
    perIpPerHour: parseCap(
      source.ITSTINGS_MAX_RUNS_PER_IP_PER_HOUR,
      DEFAULT_MAX_RUNS_PER_IP_PER_HOUR,
    ),
  };
}

/** `YYYY-MM-DD`, UTC. The instance-wide bucket. */
export function dayBucket(now: number = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

/** `YYYY-MM-DDTHH`, UTC. */
export function hourBucket(now: number = Date.now()): string {
  return new Date(now).toISOString().slice(0, 13);
}

/** `<ip>@YYYY-MM-DDTHH`. An unknown IP shares one bucket rather than escaping the cap. */
export function ipHourBucket(ip: string | null | undefined, now: number = Date.now()): string {
  const who = ip && ip.trim().length > 0 ? ip.trim() : 'unknown';
  return `${who}@${hourBucket(now)}`;
}

/**
 * Best guess at who is asking, for the per-IP cap only — never for authorisation.
 * `fly-client-ip` is set by Fly's proxy; `x-forwarded-for` is the general case and its
 * FIRST entry is the client (the rest are proxies). Locally there is no header and the
 * caps are off anyway.
 */
export function clientIp(headers: Headers): string | null {
  const fly = headers.get('fly-client-ip');
  if (fly && fly.trim()) return fly.trim();
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  const real = headers.get('x-real-ip');
  if (real && real.trim()) return real.trim();
  return null;
}

export interface BudgetCounts {
  /** Runs already recorded in today's bucket. */
  day: number;
  /** Runs already recorded in this IP's current-hour bucket. */
  ipHour: number;
}

export type BudgetVerdict =
  | { ok: true }
  | { ok: false; scope: typeof SCOPE_DAY | typeof SCOPE_IP_HOUR; limit: number; message: string };

/** The sentence the `error` SSE event carries. A human sentence, not a status code. */
export function capMessage(scope: typeof SCOPE_DAY | typeof SCOPE_IP_HOUR, limit: number): string {
  return scope === SCOPE_DAY
    ? `today's budget of ${limit} runs is used up — try tomorrow`
    : `that's ${limit} runs from here in the last hour — give it a little while`;
}

/**
 * Pure cap check. `counts` are the runs ALREADY recorded, so the limit-th run is allowed
 * and the one after it is refused. The instance-wide cap is checked first: when both are
 * blown, "today's budget is used up" is the more useful sentence.
 */
export function checkRunBudget(counts: BudgetCounts, caps: RunCaps = runCaps()): BudgetVerdict {
  if (caps.perDay !== null && counts.day >= caps.perDay) {
    return {
      ok: false,
      scope: SCOPE_DAY,
      limit: caps.perDay,
      message: capMessage(SCOPE_DAY, caps.perDay),
    };
  }
  if (caps.perIpPerHour !== null && counts.ipHour >= caps.perIpPerHour) {
    return {
      ok: false,
      scope: SCOPE_IP_HOUR,
      limit: caps.perIpPerHour,
      message: capMessage(SCOPE_IP_HOUR, caps.perIpPerHour),
    };
  }
  return { ok: true };
}
