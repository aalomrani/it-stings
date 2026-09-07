/**
 * The three families of docs/design.md §3, loaded with `next/font/google` so the app has
 * no external stylesheet at runtime (the mockups' one `<link>` is the only thing about
 * them that does not survive into the build).
 *
 * Fallback stacks are copied verbatim from the design document. The display stack is
 * deliberate: every entry after Bricolage is a real condensed grotesque that ships on a
 * real machine, so a failed webfont degrades to a *different* squashed display face and
 * never to Arial.
 */

import { Bricolage_Grotesque, IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google';

/**
 * Variable, all three axes. `wght` is included by default; `opsz` and `wdth` have to be
 * asked for, and the design sets all three on every heading
 * (`font-variation-settings:"opsz" 96,"wdth" 76,"wght" 800`).
 */
export const display = Bricolage_Grotesque({
  subsets: ['latin'],
  axes: ['opsz', 'wdth'],
  display: 'swap',
  variable: '--font-display',
  fallback: [
    'Haettenschweiler',
    'Arial Narrow',
    'Helvetica Neue Condensed Bold',
    'Franklin Gothic Medium Cond',
    'Impact',
    'sans-serif',
  ],
});

/** Everything functional: the `why`, fingerprint values, result titles, notices. */
export const sans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  display: 'swap',
  variable: '--font-sans',
  fallback: [
    '-apple-system',
    'BlinkMacSystemFont',
    'Segoe UI',
    'Helvetica',
    'Arial',
    'sans-serif',
  ],
});

/** Numbers, sources, labels, chips, stamps, the receipt line. */
export const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  display: 'swap',
  variable: '--font-mono',
  fallback: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
});

export const fontVariables = `${display.variable} ${sans.variable} ${mono.variable}`;
