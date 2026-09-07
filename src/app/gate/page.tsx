/**
 * `/gate` — where the proxy sends a browser that has no invite cookie.
 *
 * The whole page is the wordmark and one mono line on its own opaque patch, on the toner
 * black ground. No form, no "request access", no explanation of the name: someone either
 * has the link or they do not, and a text field would only invite guessing at the token.
 *
 * Design contract: docs/design.md §2 (palette), §3.3 (the wordmark's axis settings) and
 * §4 (texture never falls under a glyph — the wordmark and the line each carry their own
 * `--card` patch, and the patch is the thing that rotates, never the sentence).
 */

import type { Metadata } from 'next';

import { INVITE_ONLY_MESSAGE } from '@/lib/gate';

import styles from './page.module.css';

export const metadata: Metadata = {
  title: 'It Stings — invite only',
  description: INVITE_ONLY_MESSAGE,
  robots: { index: false, follow: false },
};

export default function GatePage() {
  return (
    <main className={styles.plate}>
      <h1 className={styles.wordmark}>
        {/* screen-print misregistration: a second pull in blood, flat, no blur */}
        <span className={styles.ghost} aria-hidden="true">
          It Stings
        </span>
        It Stings
      </h1>
      <p className={styles.line}>{INVITE_ONLY_MESSAGE}</p>
    </main>
  );
}
