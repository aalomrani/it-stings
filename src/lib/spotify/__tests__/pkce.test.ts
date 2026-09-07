/**
 * PKCE, against RFC 7636's own numbers.
 *
 * The S256 transform is the one piece of this flow that has no error message: get the
 * base64url padding or the `+`/`/` substitution wrong and Spotify answers a generic
 * `invalid_grant` at the very last step, after a browser round trip nobody can replay in a
 * test. So it is checked against the vectors in RFC 7636 Appendix B rather than against
 * itself.
 */

import { describe, expect, it } from 'vitest';

import {
  AUTHORIZE_ENDPOINT,
  DEFAULT_VERIFIER_LENGTH,
  SCOPE,
  authorizeUrl,
  base64Url,
  beginAuthorization,
  challengeFor,
  createState,
  createVerifier,
  isVerifier,
  sameState,
} from '@/lib/spotify/pkce';

/** RFC 7636 Appendix B, the code_verifier octets. */
const RFC_VERIFIER_OCTETS = [
  116, 24, 223, 180, 151, 153, 224, 37, 79, 250, 96, 125, 216, 173, 187, 186, 22, 212, 37, 77,
  105, 214, 191, 240, 91, 88, 5, 88, 83, 132, 141, 121,
];
const RFC_VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const RFC_CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

describe('base64Url', () => {
  it('encodes RFC 7636 appendix B’s verifier octets to its verifier string', () => {
    expect(base64Url(Buffer.from(RFC_VERIFIER_OCTETS))).toBe(RFC_VERIFIER);
  });

  it('strips padding and substitutes both URL-unsafe characters', () => {
    // 0xFB 0xFF -> base64 "+/8=" -> base64url "-_8"
    expect(base64Url(Buffer.from([0xfb, 0xff]))).toBe('-_8');
    expect(base64Url(Buffer.from([0]))).toBe('AA');
    expect(base64Url(Buffer.from([]))).toBe('');
  });
});

describe('challengeFor (S256)', () => {
  it('reproduces RFC 7636 appendix B’s code_challenge', () => {
    expect(challengeFor(RFC_VERIFIER)).toBe(RFC_CHALLENGE);
  });

  it('produces a 43-character base64url string with no padding for any verifier', () => {
    for (const v of [RFC_VERIFIER, createVerifier(43), createVerifier(128)]) {
      const challenge = challengeFor(v);
      expect(challenge).toHaveLength(43);
      expect(challenge).toMatch(/^[A-Za-z0-9\-_]+$/);
    }
  });

  it('is deterministic, and a one-character change changes the whole challenge', () => {
    expect(challengeFor(RFC_VERIFIER)).toBe(challengeFor(RFC_VERIFIER));
    expect(challengeFor(`${RFC_VERIFIER.slice(0, -1)}j`)).not.toBe(RFC_CHALLENGE);
  });
});

describe('createVerifier', () => {
  it('defaults to 64 characters from the RFC’s unreserved alphabet', () => {
    const v = createVerifier();
    expect(v).toHaveLength(DEFAULT_VERIFIER_LENGTH);
    expect(v).toMatch(/^[A-Za-z0-9\-._~]+$/);
    expect(isVerifier(v)).toBe(true);
  });

  it('accepts the legal length range and rejects everything outside it', () => {
    expect(createVerifier(43)).toHaveLength(43);
    expect(createVerifier(128)).toHaveLength(128);
    expect(() => createVerifier(42)).toThrow(RangeError);
    expect(() => createVerifier(129)).toThrow(RangeError);
    expect(() => createVerifier(64.5)).toThrow(RangeError);
  });

  it('does not repeat itself', () => {
    const seen = new Set(Array.from({ length: 50 }, () => createVerifier()));
    expect(seen.size).toBe(50);
  });
});

describe('isVerifier', () => {
  it('holds the RFC 7636 §4.1 length and charset rules', () => {
    expect(isVerifier(RFC_VERIFIER)).toBe(true);
    expect(isVerifier('a'.repeat(43))).toBe(true);
    expect(isVerifier('a'.repeat(128))).toBe(true);
    expect(isVerifier('a'.repeat(42))).toBe(false);
    expect(isVerifier('a'.repeat(129))).toBe(false);
    // `+` and `/` are base64, not base64url, and are not in the unreserved set.
    expect(isVerifier(`${'a'.repeat(42)}+`)).toBe(false);
    expect(isVerifier(`${'a'.repeat(42)}/`)).toBe(false);
    expect(isVerifier(null)).toBe(false);
    expect(isVerifier(undefined)).toBe(false);
  });
});

describe('sameState', () => {
  it('matches only identical strings and never throws on a length mismatch', () => {
    const state = createState();
    expect(sameState(state, state)).toBe(true);
    expect(sameState(state, `${state}x`)).toBe(false);
    expect(sameState(state, state.slice(0, -1))).toBe(false);
    expect(sameState(state, null)).toBe(false);
    expect(sameState(null, null)).toBe(false);
    expect(sameState('', '')).toBe(false);
  });
});

describe('authorizeUrl', () => {
  const url = authorizeUrl({
    clientId: 'fake-client-id',
    redirectUri: 'http://127.0.0.1:3151/api/spotify/callback',
    codeChallenge: RFC_CHALLENGE,
    state: 'state-value',
  });
  const parsed = new URL(url);

  it('points at accounts.spotify.com/authorize', () => {
    expect(url.startsWith(`${AUTHORIZE_ENDPOINT}?`)).toBe(true);
    expect(parsed.origin).toBe('https://accounts.spotify.com');
    expect(parsed.pathname).toBe('/authorize');
  });

  it('carries every parameter Spotify marks Required, and the PKCE ones', () => {
    expect(parsed.searchParams.get('client_id')).toBe('fake-client-id');
    expect(parsed.searchParams.get('response_type')).toBe('code');
    expect(parsed.searchParams.get('redirect_uri')).toBe(
      'http://127.0.0.1:3151/api/spotify/callback',
    );
    expect(parsed.searchParams.get('code_challenge_method')).toBe('S256');
    expect(parsed.searchParams.get('code_challenge')).toBe(RFC_CHALLENGE);
    expect(parsed.searchParams.get('state')).toBe('state-value');
  });

  it('asks for playlist-modify-private and nothing else', () => {
    expect(parsed.searchParams.get('scope')).toBe('playlist-modify-private');
    expect(SCOPE).toBe('playlist-modify-private');
  });

  it('never carries a client secret, and percent-encodes the loopback redirect', () => {
    expect(url).not.toMatch(/client_secret/);
    expect(url).toContain('redirect_uri=http%3A%2F%2F127.0.0.1%3A3151%2Fapi%2Fspotify%2Fcallback');
  });
});

describe('beginAuthorization', () => {
  it('returns a verifier, its own challenge, and a distinct state', () => {
    const { verifier, challenge, state } = beginAuthorization();
    expect(isVerifier(verifier)).toBe(true);
    expect(challenge).toBe(challengeFor(verifier));
    expect(state).toHaveLength(32);
    expect(state).not.toBe(verifier);
  });
});
