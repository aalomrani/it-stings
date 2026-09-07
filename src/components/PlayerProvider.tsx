'use client';

/**
 * One `<audio>` element for the whole page, and the store that owns it.
 *
 * Only one card plays at a time — starting another stops the current one — which is only
 * enforceable if there is exactly one element and one piece of state, so it lives here in
 * the layout rather than in any card.
 *
 * The element renders with no `src`: nothing is fetched until a play button is pressed.
 */

import { useEffect, useRef, useState } from 'react';

import { PlayerContext, PlayerStore } from '@/lib/client/player';

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const [store] = useState(() => new PlayerStore());
  const audio = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    store.attach(audio.current);
    return () => store.detach();
  }, [store]);

  return (
    <PlayerContext.Provider value={store}>
      {children}
      {/* Never `controls`: the transport is the drawn ring on each card. */}
      <audio ref={audio} preload="none" aria-hidden="true" />
    </PlayerContext.Provider>
  );
}
