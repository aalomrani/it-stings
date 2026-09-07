/**
 * `/playlists`. A thin server shell over one client component: the list is user-authored
 * data that changes under the user's own hands (create, rename, delete), so it is read in
 * the browser from `GET /api/playlists` rather than prerendered into HTML that would be
 * wrong the moment they touched it.
 */

import type { Metadata } from 'next';

import { PlaylistList } from '@/components/playlists/PlaylistList';

export const metadata: Metadata = {
  title: 'Playlists · It Stings',
  description: 'Every playlist saved on this machine, with what is in it and when it changed.',
};

/** The `<h1>` is the drawn "Playlists" heading inside the list itself, not a second one. */
export default function PlaylistsPage() {
  return <PlaylistList />;
}
