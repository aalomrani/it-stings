-- 004 — a mention carries its own source (docs/tasks/phase3-engine.md, review finding F14).
--
-- Until now `mentions.evidence_id` was NOT NULL with a foreign key into `evidence`, so a
-- mention could only be persisted by first writing an `evidence` row. Brave's ToS forbids
-- storing its Search Results, so Channel B wrote an ANCHOR row instead — provider, query
-- and the one URL the mention had to be attributable to, every other column NULL. Nothing
-- Brave authored was stored, but the shape was a lie: an `evidence` row that was not
-- evidence, re-minted every run, and never readable as a result set.
--
-- The clean shape, and the one the architecture describes, puts the source ON the mention:
--   * `evidence_id` becomes nullable — a mention from a provider whose results may not be
--     cached simply has no evidence row behind it;
--   * `url`   the page the mention was read from. Always written. A bare URL is not a
--     Search Result, it is the attribution a quotation needs;
--   * `title` the page title, and ONLY when the provider's terms allow its text to be
--     retained (Tavily). It stays NULL on the Brave path, exactly as the anchor's did.
--
-- SQLite cannot drop a NOT NULL constraint in place, so the table is recreated and the
-- rows are copied over. Existing rows keep their evidence_id and get their url from the
-- evidence row they already point at, so nothing loses its attribution.

CREATE TABLE mentions_new (
  id INTEGER PRIMARY KEY,
  evidence_id INTEGER REFERENCES evidence(id),   -- nullable: Brave writes no evidence row
  seed_key TEXT NOT NULL,
  artist TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT,                                      -- the page this was read from
  page_title TEXT,                               -- only where the provider allows storage
  sentence TEXT,
  enthusiasm TEXT,
  model TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

INSERT INTO mentions_new
  (id, evidence_id, seed_key, artist, title, url, page_title, sentence, enthusiasm, model, created_at)
SELECT m.id, m.evidence_id, m.seed_key, m.artist, m.title,
       (SELECT e.url FROM evidence e WHERE e.id = m.evidence_id),
       (SELECT e.title FROM evidence e WHERE e.id = m.evidence_id),
       m.sentence, m.enthusiasm, m.model, m.created_at
  FROM mentions m;

DROP TABLE mentions;
ALTER TABLE mentions_new RENAME TO mentions;

CREATE INDEX mentions_seed ON mentions(seed_key);
-- Channel B joins a cached mention to this run's results by page URL, never by row id.
CREATE INDEX mentions_url ON mentions(url);
