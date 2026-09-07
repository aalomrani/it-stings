/**
 * `/playlists/[id]`. The shell awaits the route param and hands the id to the client view,
 * which reads `GET /api/playlists/[id]` — the tracks come back with FRESH preview URLs
 * (Deezer signs them and they die 900 s later), so this page can never be prerendered or
 * cached: the HTML would carry dead audio.
 */

import type { Metadata } from 'next';

import { PlaylistView } from '@/components/playlists/PlaylistView';

export const metadata: Metadata = {
  title: 'A playlist · It Stings',
  description: 'One saved playlist: its tracks, in order, with the reason each one was saved.',
};

export default async function PlaylistPage({ params }: PageProps<'/playlists/[id]'>) {
  const { id } = await params;
  return <PlaylistView id={id} />;
}
