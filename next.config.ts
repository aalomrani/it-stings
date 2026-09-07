import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Deployable build (docs/tasks/phase7-ship.md §1). `next build` additionally emits
   * `.next/standalone/` — a self-contained server plus only the traced `node_modules`,
   * which is what the Dockerfile copies. better-sqlite3 is on Next's built-in
   * `serverExternalPackages` list, so its prebuilt `.node` binary is traced automatically
   * (docs/api-reality.md §8: `route.js.nft.json` already contains `prebuilds/*.node`).
   */
  output: "standalone",

  /**
   * Dev only. Next 16 blocks its own script/HMR requests when the page is opened from a
   * host other than localhost, and the page then never hydrates (typing does nothing,
   * Enter falls back to a native form submit). README and the Spotify redirect rule both
   * point people at 127.0.0.1, so allow it. Ignored by `next build`/`next start`.
   */
  allowedDevOrigins: ["127.0.0.1", "localhost"],

  /**
   * The migration `.sql` files are read at RUNTIME from `process.cwd()` (see
   * `src/lib/db/index.ts`, which deliberately reads them with `turbopackIgnore` so
   * Turbopack does not trace the whole project into the server bundle). Nothing imports
   * them, so nothing traces them either — this copies them into `.next/standalone/`,
   * where the generated `server.js` `process.chdir(__dirname)`s to.
   *
   * Verified under Turbopack on 2026-09-06: `next build` traced all four `.sql` files
   * (001, 003, 004, 005) into `.next/standalone/src/lib/db/migrations/` on its own. The
   * Dockerfile's `COPY` of the directory and `scripts/smoke-prod.sh`'s fallback copy stay
   * as belt and braces.
   */
  outputFileTracingIncludes: {
    "/**": ["./src/lib/db/migrations/*.sql"],
  },
};

export default nextConfig;
