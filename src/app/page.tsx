/**
 * The one page. Everything below the fold of this file is a client component, because the
 * whole product is one long-lived interaction: a debounced typeahead, an `EventSource`
 * that streams for a minute or more, and a single audio element.
 *
 * `App` reads `?seed=` with `useSearchParams`, which Next requires to sit inside a
 * `<Suspense>` boundary so the shell can be prerendered. The fallback is the same empty
 * plate the app opens on, minus the live field — never a spinner.
 */

import { Suspense } from 'react';

import { App } from '@/components/App';
import { Wasp } from '@/components/Wasp';

export default function Home() {
  return (
    <Suspense
      fallback={
        <main className="plate">
          <Wasp />
        </main>
      }
    >
      <App />
    </Suspense>
  );
}
