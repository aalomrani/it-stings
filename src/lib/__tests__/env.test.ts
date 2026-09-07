import { describe, expect, it } from 'vitest';

import { DEFAULT_MODEL, DEFAULT_SPOTIFY_REDIRECT_URI, readEnvForTests } from '@/lib/env';

describe('env', () => {
  it('never throws on a completely empty environment', () => {
    const env = readEnvForTests({});
    expect(env.model).toBe(DEFAULT_MODEL);
    expect(env.spotifyRedirectUri).toBe(DEFAULT_SPOTIFY_REDIRECT_URI);
    expect(env.fallbacks).toBe(true);
    expect(env.keys).toEqual({
      anthropic: false,
      lastfm: false,
      websearch: null,
      spotify: false,
      getsongbpm: false,
    });
  });

  it('treats an empty or whitespace value as absent', () => {
    const env = readEnvForTests({ ANTHROPIC_API_KEY: '', LASTFM_API_KEY: '   ' });
    expect(env.anthropicApiKey).toBeUndefined();
    expect(env.lastfmApiKey).toBeUndefined();
    expect(env.keys.anthropic).toBe(false);
    expect(env.keys.lastfm).toBe(false);
  });

  it('reports presence for each key', () => {
    const env = readEnvForTests({
      ANTHROPIC_API_KEY: 'sk-ant-x',
      LASTFM_API_KEY: 'lf',
      GETSONGBPM_API_KEY: 'gs',
      SPOTIFY_CLIENT_ID: 'id',
      SPOTIFY_CLIENT_SECRET: 'secret',
    });
    expect(env.keys).toEqual({
      anthropic: true,
      lastfm: true,
      websearch: null,
      spotify: true,
      getsongbpm: true,
    });
    expect(env.spotifyClientSecret).toBe('secret');
  });

  it('needs BOTH Spotify credentials before claiming Spotify works', () => {
    expect(readEnvForTests({ SPOTIFY_CLIENT_ID: 'id' }).keys.spotify).toBe(false);
    expect(readEnvForTests({ SPOTIFY_CLIENT_SECRET: 'secret' }).keys.spotify).toBe(false);
  });

  it('prefers Tavily over Brave for web search', () => {
    expect(readEnvForTests({ TAVILY_API_KEY: 't' }).keys.websearch).toBe('tavily');
    expect(readEnvForTests({ BRAVE_SEARCH_API_KEY: 'b' }).keys.websearch).toBe('brave');
    expect(readEnvForTests({ TAVILY_API_KEY: 't', BRAVE_SEARCH_API_KEY: 'b' }).keys.websearch).toBe(
      'tavily',
    );
  });

  it('overrides the model and the fallbacks switch', () => {
    expect(readEnvForTests({ ITSTINGS_MODEL: 'claude-sonnet-5' }).model).toBe('claude-sonnet-5');
    expect(readEnvForTests({ ITSTINGS_FALLBACKS: '0' }).fallbacks).toBe(false);
    expect(readEnvForTests({ ITSTINGS_FALLBACKS: 'off' }).fallbacks).toBe(false);
    expect(readEnvForTests({ ITSTINGS_FALLBACKS: '1' }).fallbacks).toBe(true);
    expect(readEnvForTests({ ITSTINGS_FALLBACKS: 'anything-else' }).fallbacks).toBe(true);
  });

  it('exposes no key VALUE through the presence flags object', () => {
    const env = readEnvForTests({ ANTHROPIC_API_KEY: 'sk-ant-secret' });
    expect(JSON.stringify(env.keys)).not.toContain('sk-ant-secret');
  });
});
