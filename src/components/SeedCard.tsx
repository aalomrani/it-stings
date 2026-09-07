'use client';

/**
 * The seed card. The only result-shaped thing on the page that gets the display face, and
 * the only card with the acid edge — after this the page goes quiet.
 *
 * Every hard value carries its source stamp: the year says which source supplied it (and
 * prints `year unknown` rather than a guess when nothing did), the ISRC says where it came
 * from, and the kick line names the sources that were actually joined into this record.
 */

import { ArtTile } from '@/components/ArtTile';
import { FingerprintPanel } from '@/components/FingerprintPanel';
import { NoPreviewNote, NoPreviewTag, PlayButton, PlayTime, previewMode, SpotifyEmbed } from '@/components/PlayButton';
import { SavePopover } from '@/components/SavePopover';
import { keyLine, tempoLine } from '@/lib/client/format';
import { usePlayerSnapshot } from '@/lib/client/player';
import type { Fingerprint, FingerprintField, TrackRecord } from '@/lib/types';

/** `resolved from itunes + deezer + musicbrainz` — the sources actually present on the record. */
export function resolvedFrom(seed: TrackRecord): string {
  const used: string[] = [];
  if (seed.ids.itunes) used.push('itunes');
  if (seed.ids.deezer) used.push('deezer');
  if (seed.ids.mbid) used.push('musicbrainz');
  if (seed.features) used.push('acousticbrainz');
  // Whoever actually supplied the tags — MusicBrainz supplies them when there is no
  // Last.fm key, and naming the wrong source here would be a fabricated provenance.
  if (seed.tags && !used.includes(seed.tags.source.source)) used.push(seed.tags.source.source);
  if (seed.ids.spotify) used.push('spotify');
  return used.length > 0 ? `resolved from ${used.join(' + ')}` : 'not resolved to any source';
}

/** The deep links under the byline. Spotify is the resolved URL or the keyless search. */
export function deepLinks(seed: TrackRecord): { label: string; href: string }[] {
  const out: { label: string; href: string }[] = [];
  out.push({
    label: 'spotify',
    href:
      seed.links.spotify ??
      `https://open.spotify.com/search/${encodeURIComponent(`${seed.artist} ${seed.title}`)}`,
  });
  if (seed.links.deezer) out.push({ label: 'deezer', href: seed.links.deezer });
  if (seed.links.itunes) out.push({ label: 'itunes', href: seed.links.itunes });
  if (seed.links.musicbrainz) out.push({ label: 'musicbrainz', href: seed.links.musicbrainz });
  if (seed.links.lastfm) out.push({ label: 'last.fm', href: seed.links.lastfm });
  return out;
}

export interface SeedCardProps {
  seed: TrackRecord;
  fingerprint: Fingerprint | null;
  applied: Partial<Record<FingerprintField, string>>;
  onRerun: (corrections: Partial<Record<FingerprintField, string>>) => void;
}

export function SeedCard({ seed, fingerprint, applied, onRerun }: SeedCardProps) {
  const snap = usePlayerSnapshot();
  const mode = previewMode(seed, snap.fallback[seed.key]);
  const year = seed.year;
  // The two measured values the resolver produces without any model: they belong on the
  // stamp line beside the year, not inside the fingerprint panel, because the panel only
  // exists when there is an ANTHROPIC_API_KEY and the measurements exist regardless.
  const tempo = tempoLine(seed);
  const key = keyLine(seed);

  return (
    <article className="card seed">
      <div className="head">
        <ArtTile
          src={seed.artwork?.large ?? null}
          title={seed.title}
          artist={seed.artist}
          trackKey={seed.key}
          allowFilter
        />

        <div>
          <p className="kick">seed · {resolvedFrom(seed)}</p>
          <h2 className="title">{seed.title}</h2>
          <p className="byline">
            {seed.artist} ·{' '}
            {year ? (
              <span className="yr">{year.value}</span>
            ) : (
              <span className="unk">year unknown</span>
            )}
            {seed.isrc ? <> · isrc {seed.isrc}</> : null}
          </p>
          <p className="src">
            {year
              ? `year: ${year.source.source}${year.source.field ? ` ${year.source.field}` : ''}`
              : 'year: no source gave one — not guessed'}
            {seed.isrc
              ? seed.ids.deezer
                ? ' · isrc: deezer'
                : ' · isrc: carried on the seed key — no source named'
              : ' · isrc: none returned'}
            {seed.durationMs ? ` · duration: ${seed.durationMs.source.source}` : ''}
            {tempo ? ` · ${tempo}` : ''}
            {key ? ` · ${key}` : ''}
          </p>

          <div className="tools">
            <PlayButton track={seed} mode={mode} />
            {mode === 'audio' ? <PlayTime track={seed} /> : <NoPreviewTag />}
            {/* The seed of its own run: without this the saved row would read "saved
                without a seed" for the one track on the page that IS the seed. */}
            <SavePopover
              trackKey={seed.key}
              seedKey={seed.key}
              label="save the seed"
              title={seed.title}
            />
            {mode === 'embed' ? <SpotifyEmbed track={seed} /> : null}
          </div>
          {mode === 'none' ? (
            <NoPreviewNote track={seed} note={snap.fallback[seed.key]?.note} />
          ) : null}

          <p className="links">
            open on{' '}
            {deepLinks(seed).map((link, index) => (
              <span key={link.label}>
                {index > 0 ? ' · ' : ''}
                <a href={link.href} target="_blank" rel="noopener noreferrer">
                  {link.label}
                </a>
              </span>
            ))}
          </p>
        </div>
      </div>

      {fingerprint ? (
        <FingerprintPanel
          seed={seed}
          fingerprint={fingerprint}
          applied={applied}
          onRerun={onRerun}
        />
      ) : null}
    </article>
  );
}
