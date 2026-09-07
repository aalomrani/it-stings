-- It Stings — initial schema. Copied verbatim from docs/architecture.md
-- ("Database schema"). Migrations are append-only: never edit this file once it has run,
-- add 002_*.sql instead.

CREATE TABLE tracks (
  key TEXT PRIMARY KEY, isrc TEXT, title TEXT NOT NULL, artist TEXT NOT NULL,
  norm_artist TEXT NOT NULL, norm_title TEXT NOT NULL,
  json TEXT NOT NULL,             -- full TrackRecord
  resolved_at INTEGER NOT NULL
);
CREATE INDEX tracks_norm ON tracks(norm_artist, norm_title);
CREATE INDEX tracks_isrc ON tracks(isrc);

CREATE TABLE http_cache (
  cache_key TEXT PRIMARY KEY,     -- sha1(method + url + relevant headers)
  url TEXT NOT NULL, status INTEGER NOT NULL, body TEXT NOT NULL,
  fetched_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
CREATE INDEX http_cache_exp ON http_cache(expires_at);

CREATE TABLE fingerprints (
  track_key TEXT NOT NULL, model TEXT NOT NULL, prompt_version TEXT NOT NULL,
  json TEXT NOT NULL, created_at INTEGER NOT NULL,
  PRIMARY KEY (track_key, model, prompt_version)
);

CREATE TABLE evidence (                -- Channel B raw search results (cache)
  id INTEGER PRIMARY KEY, provider TEXT NOT NULL, query TEXT NOT NULL,
  url TEXT NOT NULL, title TEXT, snippet TEXT, content TEXT,
  fetched_at INTEGER NOT NULL
);
CREATE INDEX evidence_q ON evidence(provider, query);

CREATE TABLE mentions (                -- Channel B model-extracted mentions (cache)
  id INTEGER PRIMARY KEY, evidence_id INTEGER NOT NULL REFERENCES evidence(id),
  seed_key TEXT NOT NULL, artist TEXT NOT NULL, title TEXT NOT NULL,
  sentence TEXT, enthusiasm TEXT, model TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX mentions_seed ON mentions(seed_key);

CREATE TABLE verifications (           -- Stage 4 cache: (artist,title) -> track key or miss
  norm_artist TEXT NOT NULL, norm_title TEXT NOT NULL,
  track_key TEXT,                      -- NULL = verified miss
  checked_at INTEGER NOT NULL, PRIMARY KEY (norm_artist, norm_title)
);

CREATE TABLE runs (
  id TEXT PRIMARY KEY, seed_key TEXT NOT NULL, options_hash TEXT NOT NULL,
  engine_version TEXT NOT NULL, json TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX runs_seed ON runs(seed_key, options_hash, engine_version);

CREATE TABLE playlists (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE playlist_items (
  id INTEGER PRIMARY KEY, playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  track_key TEXT NOT NULL REFERENCES tracks(key), position INTEGER NOT NULL,
  why TEXT, seed_key TEXT, added_at INTEGER NOT NULL
);
CREATE INDEX playlist_items_pl ON playlist_items(playlist_id, position);
