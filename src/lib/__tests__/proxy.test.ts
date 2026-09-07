/**
 * `src/proxy.ts` — the profile-cookie provisioning it adds on top of the gate.
 *
 * The gate policy itself is proved in `gate.test.ts` (pure `decideAccess`). What is proved
 * here is the identity side: every response gets an `itstings_profile` cookie when the
 * request lacked a valid one, and an existing valid cookie is left untouched — even when
 * the gate is OFF, which is the local single-user case.
 */

import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it } from 'vitest';

import { proxy } from '@/proxy';
import { PROFILE_COOKIE } from '@/lib/profile';

const VALID = '55555555-5555-4555-8555-555555555555';

afterEach(() => {
  delete process.env.ITSTINGS_ACCESS_TOKEN;
});

function request(path: string, cookie?: string): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, cookie ? { headers: { cookie } } : {});
}

function profileCookie(response: ReturnType<typeof proxy>) {
  return response.cookies.get(PROFILE_COOKIE)?.value ?? null;
}

describe('proxy — profile cookie provisioning', () => {
  it('mints a cookie for a fresh visitor when the gate is off', () => {
    const res = proxy(request('/'));
    expect(profileCookie(res)).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('leaves a valid existing cookie untouched', () => {
    const res = proxy(request('/', `${PROFILE_COOKIE}=${VALID}`));
    // Nothing set on the response — the browser keeps the id it already has.
    expect(res.cookies.get(PROFILE_COOKIE)).toBeUndefined();
  });

  it('replaces a malformed cookie value with a fresh uuid', () => {
    const res = proxy(request('/', `${PROFILE_COOKIE}=not-a-uuid`));
    expect(profileCookie(res)).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('still provisions the cookie on a gated challenge redirect', () => {
    process.env.ITSTINGS_ACCESS_TOKEN = 'secret';
    const res = proxy(request('/'));
    // A browser with no gate cookie is redirected to /gate — and still handed an identity.
    expect(res.headers.get('location')).toContain('/gate');
    expect(profileCookie(res)).toMatch(/^[0-9a-f-]{36}$/);
  });
});
