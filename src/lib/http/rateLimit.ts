/**
 * Per-host rate limiting. Every external request goes through `fetchExternal`, and every
 * `fetchExternal` attempt goes through the limiter for its host — so these policies are
 * the whole of our politeness story.
 *
 * The limiters are process-wide singletons stashed on `globalThis`, because Next's dev
 * hot reload re-evaluates modules and a fresh limiter per reload would let us burst past
 * MusicBrainz's 1 req/s and earn a 403.
 *
 * Policies (docs/architecture.md, docs/api-reality.md):
 *   musicbrainz.org       strictly serial, >= 1100 ms between request STARTS
 *   api.deezer.com        <= 45 per 5 s (sliding)
 *   itunes.apple.com      <= 20 per 60 s
 *   ws.audioscrobbler.com <= 4 per s
 *   api.tavily.com        <= 1 per s
 *   api.search.brave.com  <= 1 per s
 *   acousticbrainz.org    <= 5 per s
 *   everything else       <= 10 per s
 */

export interface Policy {
  /** Max request starts inside `windowMs`. */
  limit: number;
  windowMs: number;
  /** Minimum gap between two request starts. */
  minGapMs: number;
  /** When true, only one request may be in flight at a time. */
  serial: boolean;
}

export interface Limiter {
  readonly host: string;
  readonly policy: Policy;
  schedule<T>(fn: () => Promise<T>): Promise<T>;
  /** Requests currently queued (not yet started). Diagnostics only. */
  readonly pending: number;
}

const policy = (limit: number, windowMs: number, extra: Partial<Policy> = {}): Policy => ({
  limit,
  windowMs,
  minGapMs: 0,
  serial: false,
  ...extra,
});

export const DEFAULT_POLICY: Policy = policy(10, 1000);

/** Keyed by registrable host; a subdomain inherits its parent's policy. */
export const POLICIES: Record<string, Policy> = {
  'musicbrainz.org': policy(1, 1100, { minGapMs: 1100, serial: true }),
  'api.deezer.com': policy(45, 5000),
  'itunes.apple.com': policy(20, 60_000),
  'ws.audioscrobbler.com': policy(4, 1000),
  'api.tavily.com': policy(1, 1000),
  'api.search.brave.com': policy(1, 1000),
  'acousticbrainz.org': policy(5, 1000),
};

/** Exact match first, then suffix match so `www.musicbrainz.org` inherits. */
export function policyFor(host: string): Policy {
  const h = host.toLowerCase();
  const exact = POLICIES[h];
  if (exact) return exact;
  for (const [key, value] of Object.entries(POLICIES)) {
    if (h.endsWith(`.${key}`)) return value;
  }
  return DEFAULT_POLICY;
}

interface Job {
  run: () => void;
}

class HostLimiter implements Limiter {
  /** Timestamps of recent request STARTS, oldest first. */
  private starts: number[] = [];
  private lastStart = Number.NEGATIVE_INFINITY;
  private queue: Job[] = [];
  private inFlight = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    readonly host: string,
    readonly policy: Policy,
  ) {}

  get pending(): number {
    return this.queue.length;
  }

  schedule<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        run: () => {
          this.inFlight += 1;
          void (async () => {
            try {
              resolve(await fn());
            } catch (err) {
              reject(err);
            } finally {
              this.inFlight -= 1;
              this.pump();
            }
          })();
        },
      });
      this.pump();
    });
  }

  /** Milliseconds to wait before the next start is allowed. */
  private waitMs(now: number): number {
    const { limit, windowMs, minGapMs } = this.policy;
    this.starts = this.starts.filter((t) => now - t < windowMs);
    let wait = 0;
    if (this.starts.length >= limit) {
      const oldestInWindow = this.starts[this.starts.length - limit];
      wait = Math.max(wait, oldestInWindow + windowMs - now);
    }
    if (minGapMs > 0 && Number.isFinite(this.lastStart)) {
      wait = Math.max(wait, this.lastStart + minGapMs - now);
    }
    return wait;
  }

  private pump(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    while (this.queue.length > 0) {
      if (this.policy.serial && this.inFlight > 0) return;
      const now = Date.now();
      const wait = this.waitMs(now);
      if (wait > 0) {
        this.timer = setTimeout(() => {
          this.timer = null;
          this.pump();
        }, wait);
        // Never hold the process open for a queued request.
        (this.timer as { unref?: () => void }).unref?.();
        return;
      }
      const job = this.queue.shift();
      if (!job) return;
      this.starts.push(now);
      this.lastStart = now;
      job.run();
    }
  }
}

interface LimiterRegistry {
  limiters: Map<string, HostLimiter>;
}

const globalRef = globalThis as typeof globalThis & { __itstingsLimiters?: LimiterRegistry };
const registry: LimiterRegistry = (globalRef.__itstingsLimiters ??= { limiters: new Map() });

/** The limiter for a hostname (not a URL). Created on first use, then reused forever. */
export function getLimiter(host: string): Limiter {
  const key = host.toLowerCase();
  let limiter = registry.limiters.get(key);
  if (!limiter) {
    limiter = new HostLimiter(key, policyFor(key));
    registry.limiters.set(key, limiter);
  }
  return limiter;
}

/** The limiter for a URL's host; falls back to the default policy on an unparseable URL. */
export function getLimiterForUrl(url: string): Limiter {
  try {
    return getLimiter(new URL(url).hostname);
  } catch {
    return getLimiter('invalid.local');
  }
}

/** Tests only: drop every limiter so timing state does not leak between cases. */
export function resetLimiters(): void {
  registry.limiters.clear();
}
