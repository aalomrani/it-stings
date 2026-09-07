/**
 * The invite gate, as a Next 16 proxy.
 *
 * `proxy.ts` is the Next 16 name for what used to be `middleware.ts`. There must NEVER
 * also be a `src/middleware.ts`: with both files present `next dev` prints "Both
 * middleware file … and proxy file … are detected", keeps listening on the port and
 * answers nothing (docs/api-reality.md, "Verification addendum (Next.js)" §(e)). The
 * proxy runs on the Node runtime only — that is not configurable in 16 — which is why it
 * may import `node:crypto` through `@/lib/gate`.
 *
 * All of the policy is in `@/lib/gate.decideAccess`, a pure function with unit tests.
 * This file only turns a decision into a response.
 *
 * With `ITSTINGS_ACCESS_TOKEN` unset every request is passed straight through, so the
 * local single-user app is unchanged.
 */

import { NextResponse, type NextRequest } from 'next/server';

import { GATE_COOKIE, GATE_COOKIE_MAX_AGE_SECONDS, accessToken, decideAccess } from '@/lib/gate';

/**
 * Everything except the build's own static output. The per-path bypasses (`/api/health`,
 * `/gate`, `public/` files) live in `gate.ts` so they are testable; this matcher only
 * keeps the proxy off the hot asset paths.
 */
export const config = {
  matcher: ['/((?!_next/static|_next/image|_next/webpack-hmr).*)'],
};

export function proxy(request: NextRequest): NextResponse {
  const token = accessToken();
  if (token === null) return NextResponse.next();

  const { nextUrl } = request;
  const decision = decideAccess(
    {
      pathname: nextUrl.pathname,
      search: nextUrl.search,
      cookie: request.cookies.get(GATE_COOKIE)?.value ?? null,
    },
    token,
  );

  switch (decision.action) {
    case 'allow':
      return NextResponse.next();

    case 'grant': {
      // 307 keeps the method, so `POST /api/resolve?key=…` still works. The token moves
      // out of the URL and into an httpOnly cookie in the same hop, so it never reaches
      // page JS and is not left sitting in the address bar to be screenshotted.
      const response = NextResponse.redirect(new URL(decision.location, request.url), 307);
      response.cookies.set(GATE_COOKIE, token, {
        httpOnly: true,
        sameSite: 'lax',
        maxAge: GATE_COOKIE_MAX_AGE_SECONDS,
        path: '/',
        // Fly terminates TLS and forwards the original scheme; plain http on localhost
        // must not get a Secure cookie or the gate would be unusable in local testing.
        secure: isHttps(request),
      });
      return response;
    }

    case 'deny':
      return NextResponse.json(
        { error: 'invite_only', message: decision.message },
        { status: 401, headers: { 'Cache-Control': 'no-store' } },
      );

    case 'challenge':
      return NextResponse.redirect(new URL(decision.location, request.url), 307);
  }
}

function isHttps(request: NextRequest): boolean {
  const forwarded = request.headers.get('x-forwarded-proto');
  if (forwarded) return forwarded.split(',')[0]?.trim() === 'https';
  return request.nextUrl.protocol === 'https:';
}
