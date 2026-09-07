/**
 * The anonymous per-browser training identity.
 *
 * A profile is a uuid carried in the `itstings_profile` cookie. `src/proxy.ts` provisions
 * it (mirroring the gate cookie's attribute logic) so that by the time anyone searches, the
 * cookie exists; the `profiles` row itself is created LAZILY, only when a browser first
 * trains something.
 *
 * This module is imported by `src/proxy.ts`, so — like `@/lib/gate` — it must stay free of
 * `server-only`, `@/lib/db` and anything that pulls in a native binary. It is pure cookie
 * parsing and a shared set of cookie attributes; the uuid is minted in `src/proxy.ts` with
 * `node:crypto`, and the database lookups live in `@/lib/db/repos/profiles`.
 */

/** The cookie that names the training profile. Anonymous, per browser. */
export const PROFILE_COOKIE = 'itstings_profile';

/** One year, in seconds — a profile you trained in March is still yours in December. */
export const PROFILE_COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

/**
 * A cookie value we accept as a profile id. The proxy mints `crypto.randomUUID()`, so a
 * well-formed value is an RFC-4122 uuid; anything else (an empty cookie, a truncated one, a
 * hand-forged string) is rejected so it never becomes a profiles-table primary key.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidProfileId(value: string | null | undefined): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

/** Pull one cookie's value out of a raw `Cookie:` header. Returns null when absent. */
function readCookie(header: string | null | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}

/** What `profileIdFrom` will accept: a raw cookie header, or any request-like object. */
type CookieSource =
  | string
  | { cookies?: { get?: (name: string) => { value?: string } | undefined } }
  | { headers?: { get?: (name: string) => string | null } }
  | null
  | undefined;

/**
 * The valid profile id carried by a request (or a raw `Cookie:` header string), or `null`
 * when the cookie is missing or malformed. Accepts a `NextRequest` (reads `cookies.get`), a
 * web `Request` (reads the `cookie` header), or the header string directly — so both the
 * proxy and the route handlers can call it.
 */
export function profileIdFrom(source: CookieSource): string | null {
  let value: string | null = null;

  if (typeof source === 'string') {
    value = readCookie(source, PROFILE_COOKIE);
  } else if (source && typeof source === 'object') {
    const withCookies = source as {
      cookies?: { get?: (name: string) => { value?: string } | undefined };
    };
    if (withCookies.cookies && typeof withCookies.cookies.get === 'function') {
      value = withCookies.cookies.get(PROFILE_COOKIE)?.value ?? null;
    } else {
      const withHeaders = source as { headers?: { get?: (name: string) => string | null } };
      if (withHeaders.headers && typeof withHeaders.headers.get === 'function') {
        value = readCookie(withHeaders.headers.get('cookie'), PROFILE_COOKIE);
      }
    }
  }

  return isValidProfileId(value) ? value : null;
}

/**
 * Whether a request arrived over https, so a caller knows whether to mark the cookie
 * `Secure`. Mirrors the gate cookie's logic in `src/proxy.ts`: trust `x-forwarded-proto`
 * (Fly terminates TLS and forwards the original scheme) and otherwise fall back to the
 * request URL's protocol. Plain http on localhost must NOT get a `Secure` cookie or the
 * cookie would never be stored in local testing.
 */
export function requestIsHttps(request: { headers: { get(name: string): string | null }; url?: string }): boolean {
  const forwarded = request.headers.get('x-forwarded-proto');
  if (forwarded) return forwarded.split(',')[0]?.trim() === 'https';
  if (request.url) {
    try {
      return new URL(request.url).protocol === 'https:';
    } catch {
      /* fall through */
    }
  }
  return false;
}

/** The cookie attributes for `itstings_profile`, shared by the proxy and the routes. */
export function profileCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    maxAge: PROFILE_COOKIE_MAX_AGE_SECONDS,
    path: '/',
    // Only over https — Fly serves https, localhost serves http and must stay usable.
    secure,
  };
}
