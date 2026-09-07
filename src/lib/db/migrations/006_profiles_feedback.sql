-- 006 — trainable, per-browser profiles and their "this matches" feedback
-- (docs/tasks: the trainable engine — src/lib/engine/train.ts learns each profile's weights).
--
-- The engine is deterministic and keyless; TRAINING means learning one user's nine
-- DimensionScore weights from the pairs they marked 'match' / 'not'. This migration holds
-- the two tables that persist that, and nothing else. It is MULTI-USER from the start: one
-- `profiles` row per anonymous browser (identified by the `itstings_profile` cookie), and
-- feedback is always scoped to a `profile_id`, so one person's training never leaks into
-- another's ranking.
--
-- `profiles`
--   id             the cookie uuid (crypto.randomUUID, provisioned by src/proxy.ts).
--   display_name   optional, purely cosmetic ("tuned to <name>'s picks"); NULL until set.
--   weights_json   the learned WeightsMap as JSON, or NULL until the first feedback. When
--                  NULL the recommend route falls back to DEFAULT_DIMENSION_WEIGHTS, so a
--                  brand-new profile ranks exactly like the untrained engine.
--   feedback_count how many (seed, candidate) pairs this profile has voted on — the number
--                  the UI shows ("tuned to your N picks") and the learner's shrinkage `n`.
--
-- `feedback`
--   one row per (profile, seed, candidate). A later vote on the SAME pair REPLACES the
--   earlier one (UNIQUE + INSERT ... ON CONFLICT DO UPDATE), so toggling 'match' -> 'not'
--   is an update, never a second contradictory row. `label` and `source` are CHECK-bounded
--   so a typo is a write error, not a silently mis-scored pair. The (profile_id) index is
--   what makes "all of this profile's feedback" — recomputed on every vote — a range scan.

CREATE TABLE profiles (
  id             TEXT PRIMARY KEY,          -- the itstings_profile cookie uuid
  display_name   TEXT,                      -- NULL until the user names themselves
  weights_json   TEXT,                      -- learned WeightsMap as JSON; NULL until first feedback
  feedback_count INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL,          -- epoch ms
  updated_at     INTEGER NOT NULL           -- epoch ms
);

CREATE TABLE feedback (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id    TEXT NOT NULL,
  seed_key      TEXT NOT NULL,
  candidate_key TEXT NOT NULL,
  label         TEXT NOT NULL CHECK (label IN ('match', 'not')),
  source        TEXT NOT NULL CHECK (source IN ('card', 'added')),
  created_at    INTEGER NOT NULL,           -- epoch ms of the latest vote on this pair
  UNIQUE (profile_id, seed_key, candidate_key)
);

CREATE INDEX feedback_profile ON feedback(profile_id);
