/**
 * Server-only environment. The `server-only` import makes a build fail loudly if any
 * client component ever pulls this in — no API key may reach the browser bundle, ever.
 *
 * Nothing here throws: every variable is optional, a missing key degrades exactly one
 * feature, and `GET /api/health` reports presence (never values) via `env.keys`.
 */

import 'server-only';
import { z } from 'zod';

import { accessToken as readAccessToken, runCaps, type RunCaps } from './gate';

export const DEFAULT_MODEL = 'claude-opus-5';
export const DEFAULT_SPOTIFY_REDIRECT_URI = 'http://127.0.0.1:3000/api/spotify/callback';

/** Trim, then treat an empty string exactly like an absent variable. */
const optionalSecret = z
  .string()
  .trim()
  .transform((v) => (v.length > 0 ? v : undefined))
  .optional();

/** `ITSTINGS_FALLBACKS`: defaults ON (docs/model.md); "0"/"false"/"off"/"no" turn it off. */
const booleanish = z
  .string()
  .trim()
  .optional()
  .transform((v) => {
    if (v === undefined || v === '') return true;
    return !['0', 'false', 'off', 'no'].includes(v.toLowerCase());
  });

const EnvSchema = z.object({
  ANTHROPIC_API_KEY: optionalSecret,
  ITSTINGS_MODEL: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : DEFAULT_MODEL)),
  ITSTINGS_FALLBACKS: booleanish,
  LASTFM_API_KEY: optionalSecret,
  TAVILY_API_KEY: optionalSecret,
  BRAVE_SEARCH_API_KEY: optionalSecret,
  SPOTIFY_CLIENT_ID: optionalSecret,
  SPOTIFY_CLIENT_SECRET: optionalSecret,
  SPOTIFY_REDIRECT_URI: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : DEFAULT_SPOTIFY_REDIRECT_URI)),
  GETSONGBPM_API_KEY: optionalSecret,
  /**
   * Phase 7 (shared deployment). The parsing rules for all three live in `@/lib/gate`,
   * which `src/proxy.ts` also imports and which therefore cannot import this file:
   * `env.ts` is `server-only` and the proxy is bundled separately. Reading them here too
   * is what lets `/api/health` and the UI say whether the instance is gated and capped —
   * the TOKEN's value is never exposed, only `gate: boolean`.
   */
  ITSTINGS_ACCESS_TOKEN: optionalSecret,
  ITSTINGS_MAX_RUNS_PER_DAY: optionalSecret,
  ITSTINGS_MAX_RUNS_PER_IP_PER_HOUR: optionalSecret,
});

export interface KeyPresence {
  anthropic: boolean;
  lastfm: boolean;
  websearch: 'tavily' | 'brave' | null;
  spotify: boolean;
  getsongbpm: boolean;
}

export interface Env {
  anthropicApiKey?: string;
  model: string;
  lastfmApiKey?: string;
  tavilyApiKey?: string;
  braveApiKey?: string;
  spotifyClientId?: string;
  /**
   * Not named in the task contract's export list but required by the Spotify
   * client-credentials flow in `sources/spotify.ts` (docs/tasks/phase1-sources.md).
   */
  spotifyClientSecret?: string;
  spotifyRedirectUri: string;
  getsongbpmApiKey?: string;
  fallbacks: boolean;
  /** Phase 7: the invite token, when this instance is gated. Never leaves the server. */
  accessToken?: string;
  /** True when `ITSTINGS_ACCESS_TOKEN` is set: safe to show ("invite-only instance"). */
  gate: boolean;
  /** Run caps (`null` = unlimited). Parsed by `@/lib/gate.runCaps`. */
  caps: RunCaps;
  keys: KeyPresence;
}

function readEnv(source: Record<string, string | undefined> = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  // The schema cannot realistically fail (every field is an optional string), but a
  // hostile value must never take the app down: fall back to an all-empty environment.
  const v = parsed.success
    ? parsed.data
    : EnvSchema.parse({});

  const websearch: KeyPresence['websearch'] = v.TAVILY_API_KEY
    ? 'tavily'
    : v.BRAVE_SEARCH_API_KEY
      ? 'brave'
      : null;

  return {
    anthropicApiKey: v.ANTHROPIC_API_KEY,
    model: v.ITSTINGS_MODEL,
    lastfmApiKey: v.LASTFM_API_KEY,
    tavilyApiKey: v.TAVILY_API_KEY,
    braveApiKey: v.BRAVE_SEARCH_API_KEY,
    spotifyClientId: v.SPOTIFY_CLIENT_ID,
    spotifyClientSecret: v.SPOTIFY_CLIENT_SECRET,
    spotifyRedirectUri: v.SPOTIFY_REDIRECT_URI,
    getsongbpmApiKey: v.GETSONGBPM_API_KEY,
    fallbacks: v.ITSTINGS_FALLBACKS,
    accessToken: readAccessToken(source) ?? undefined,
    gate: readAccessToken(source) !== null,
    caps: runCaps(source),
    keys: {
      anthropic: Boolean(v.ANTHROPIC_API_KEY),
      lastfm: Boolean(v.LASTFM_API_KEY),
      websearch,
      spotify: Boolean(v.SPOTIFY_CLIENT_ID && v.SPOTIFY_CLIENT_SECRET),
      getsongbpm: Boolean(v.GETSONGBPM_API_KEY),
    },
  };
}

/**
 * Parsed once per process. Tests that need a different environment call
 * `readEnvForTests(fakeProcessEnv)` rather than mutating this object.
 */
export const env: Env = readEnv();

/** Presence flags only — safe to serialise into an API response. */
export const keys: KeyPresence = env.keys;

export { readEnv as readEnvForTests };
