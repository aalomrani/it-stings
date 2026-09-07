/**
 * The shell. Three jobs and nothing else:
 *
 *   1. hang the three font families off `<html>` as CSS variables (docs/design.md §3);
 *   2. put the shared `<defs>` — the two filters, the three halftone screens, the tile
 *      edge and the `pathLength="100"` ring — into the document once, so every `url(#…)`
 *      and `<use href="#…">` on the page resolves;
 *   3. own the single `<audio>` element, because only one card may play at a time.
 *
 * No page-wide grain overlay: the paper tooth is a `background-image` on `<body>` and the
 * texture law (docs/design.md §4) forbids anything sitting on top of the words.
 */

import type { Metadata, Viewport } from 'next';

import { PlayerProvider } from '@/components/PlayerProvider';
import { SvgDefs } from '@/components/SvgDefs';

import { fontVariables } from './fonts';
import './globals.css';

export const metadata: Metadata = {
  title: 'It Stings',
  description:
    'I love this specific song. What else sounds like this? A single-user recommender that names the shared trait out loud.',
};

/** The ground colour matches `--ground`, so the browser chrome never flashes white. */
export const viewport: Viewport = {
  themeColor: '#141210',
  colorScheme: 'dark',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={fontVariables} suppressHydrationWarning>
      <body suppressHydrationWarning>
        <SvgDefs />
        <PlayerProvider>{children}</PlayerProvider>
      </body>
    </html>
  );
}
