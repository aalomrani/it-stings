/**
 * Genre-tag normalisation and weighted overlap — pure, no I/O.
 *
 * Crowd tags (Last.fm, MusicBrainz) are noisy: the same idea shows up as "synth-pop",
 * "synthpop" and "synth pop"; half of them are nationality/language/decade/chart junk
 * ("british", "1985", "seen live") that says nothing about how a record sounds. This
 * module folds the variants together, drops the junk, and measures how much two tag sets
 * genuinely share — the raw material for the deterministic scorer's tag-based dimensions
 * and for the "shared tags …" clause in its templated `why`.
 *
 * `weightedJaccard` counts a shared tag at `min(count)` and drops count-1 tags, so a lone
 * crowd vote never manufactures a match — the honesty the spec asks for, in arithmetic.
 */

export interface WeightedTag {
  name: string;
  count: number;
}

/** NFKD then strip combining marks: "télépatía" -> "telepatia". Inlined (normalize.ts's is private). */
function foldDiacritics(s: string): string {
  return s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Canonical spellings for tags that name the same thing. Keyed on the CLEANED form
 * (lowercase, diacritics folded, punctuation collapsed to single spaces), so "synth-pop"
 * and "synth_pop" both arrive here as "synth pop".
 */
const SYNONYMS: Record<string, string> = {
  'synth pop': 'synthpop',
  synthpop: 'synthpop',
  'electro pop': 'electropop',
  electropop: 'electropop',
  goth: 'gothic rock',
  gothic: 'gothic rock',
  'goth rock': 'gothic rock',
  'gothic rock': 'gothic rock',
  'post punk': 'post-punk',
  postpunk: 'post-punk',
  'new wave': 'new wave',
  newwave: 'new wave',
  'hip hop': 'hip hop',
  hiphop: 'hip hop',
  'trip hop': 'trip hop',
  triphop: 'trip hop',
  rnb: 'rhythm and blues',
  'r n b': 'rhythm and blues',
  'r and b': 'rhythm and blues',
  'rhythm and blues': 'rhythm and blues',
  'drum and bass': 'drum and bass',
  'drum n bass': 'drum and bass',
  dnb: 'drum and bass',
  electronica: 'electronic',
  'electronic music': 'electronic',
  'alternative rock': 'alternative rock',
  'alt rock': 'alternative rock',
  'indie rock': 'indie rock',
  'nu metal': 'nu metal',
  numetal: 'nu metal',
};

/**
 * Tags that describe WHO or WHEN, not how it sounds — dropped wholesale. Nationalities and
 * languages (including a few non-English spellings the crowd uses, e.g. "britannique"),
 * plus catalogue/chart cruft ("seen live", "favourites"). Decade tags, bare years and
 * UUIDs are caught by pattern below, not by this set.
 */
const STOP_TAGS = new Set<string>([
  // nationality / language
  'british', 'american', 'english', 'french', 'german', 'spanish', 'italian', 'japanese',
  'swedish', 'norwegian', 'finnish', 'danish', 'australian', 'canadian', 'irish', 'scottish',
  'welsh', 'dutch', 'belgian', 'brazilian', 'mexican', 'russian', 'polish', 'greek',
  'uk', 'usa', 'us', 'gb', 'england', 'america', 'europe', 'european',
  'britannique', 'americaine', 'allemand', 'francais', 'espanol',
  'anglais', 'anglaise',
  // catalogue / chart / listening junk
  'seen live', 'favourites', 'favorites', 'favourite', 'favorite', 'my favourite',
  'my favourites', 'albums i own', 'love', 'loved', 'beautiful', 'awesome', 'amazing',
  'cool', 'good', 'great', 'best', 'fav', 'favs', 'spotify', 'itunes', 'radio',
  'to check out', 'want to see live', 'under 2000 listeners', 'discover',
  'i own it', 'owned', 'wishlist',
]);

/** "1980s", "80s", "1985", "the 90s" -> a period label, dropped. */
function isPeriodTag(s: string): boolean {
  if (/^\d{4}$/.test(s)) return true; // bare year
  if (/^(?:19|20)\d0s$/.test(s)) return true; // 1980s
  if (/^\d0s$/.test(s)) return true; // 80s
  return false;
}

/** An MBID / UUID that leaked in as a tag. */
function isUuidTag(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

/** Clean one already-split fragment: fold, lowercase, punctuation -> single spaces. */
function cleanFragment(raw: string): string {
  let out = foldDiacritics(raw).toLowerCase();
  out = out.replace(/['’ʼ`´]/g, ''); // apostrophes deleted, "rock 'n' roll" -> "rock n roll"
  out = out.replace(/[^a-z0-9]+/g, ' ').trim();
  return out.replace(/\s+/g, ' ');
}

/**
 * Normalise ONE raw tag into zero or more canonical tags:
 *  - a "/"-blob ("rock/pop", "electro swing / nu jazz") splits into its parts;
 *  - each part is cleaned, synonym-mapped, and dropped if it is period/UUID/stop junk.
 *
 * Returns [] when nothing survives (a pure nationality or decade tag). De-duplicated.
 */
export function normalizeGenreTag(raw: string): string[] {
  if (typeof raw !== 'string') return [];
  const out: string[] = [];
  for (const piece of raw.split('/')) {
    // UUID check runs on the raw piece: cleaning turns hyphens into spaces first.
    if (isUuidTag(piece.trim())) continue;
    const cleaned = cleanFragment(piece);
    if (cleaned.length === 0) continue;
    if (isPeriodTag(cleaned)) continue;
    if (STOP_TAGS.has(cleaned)) continue;
    const canonical = SYNONYMS[cleaned] ?? cleaned;
    if (STOP_TAGS.has(canonical) || canonical.length === 0) continue;
    if (!out.includes(canonical)) out.push(canonical);
  }
  return out;
}

/**
 * Normalise a whole tag list, folding variants together and SUMMING the counts of tags
 * that collapse onto the same canonical name. A "/"-blob contributes its full count to
 * each of its parts. Result is sorted by count descending, then name.
 */
export function normalizeTags(tags: readonly WeightedTag[] | null | undefined): WeightedTag[] {
  const totals = new Map<string, number>();
  for (const tag of tags ?? []) {
    const count = Number.isFinite(tag.count) ? tag.count : 0;
    for (const name of normalizeGenreTag(tag.name)) {
      totals.set(name, (totals.get(name) ?? 0) + count);
    }
  }
  return [...totals.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** A normalised tag list as a name -> count map. */
function tagMap(tags: readonly WeightedTag[] | null | undefined): Map<string, number> {
  const m = new Map<string, number>();
  for (const { name, count } of normalizeTags(tags)) m.set(name, count);
  return m;
}

/**
 * Weighted Jaccard over two tag lists, in [0,1]:
 *   Σ min(a,b) / Σ max(a,b)  over the union of canonical tag names,
 * AFTER dropping any tag whose (summed) count is ≤ 1 on its own side.
 *
 * Dropping count-1 tags is the honesty guard: a single stray crowd vote on each side that
 * happens to coincide must not read as agreement. When every tag on a side is count-1 the
 * side is empty and the score is 0 — an honest "no measurable tag overlap".
 */
export function weightedJaccard(
  seedTags: readonly WeightedTag[] | null | undefined,
  candTags: readonly WeightedTag[] | null | undefined,
): number {
  const a = tagMap(seedTags);
  const b = tagMap(candTags);
  const names = new Set<string>();
  for (const [name, count] of a) if (count > 1) names.add(name);
  for (const [name, count] of b) if (count > 1) names.add(name);
  if (names.size === 0) return 0;

  let minSum = 0;
  let maxSum = 0;
  for (const name of names) {
    const av = (a.get(name) ?? 0) > 1 ? (a.get(name) as number) : 0;
    const bv = (b.get(name) ?? 0) > 1 ? (b.get(name) as number) : 0;
    minSum += Math.min(av, bv);
    maxSum += Math.max(av, bv);
  }
  return maxSum === 0 ? 0 : minSum / maxSum;
}

/**
 * The canonical tags two lists actually share, strongest first — the concrete "shared
 * tags jazz, swing" material behind a `why`. Weight is `min(count)`, floored at 1, so a
 * genuine overlap that is only count-1 on one side still shows (unlike `weightedJaccard`,
 * which is a strength measure and drops it). The scorer's genre-only guard, not this
 * function, decides whether a bare-tag overlap is enough.
 */
export function sharedTags(
  seedTags: readonly WeightedTag[] | null | undefined,
  candTags: readonly WeightedTag[] | null | undefined,
): WeightedTag[] {
  const a = tagMap(seedTags);
  const b = tagMap(candTags);
  const out: WeightedTag[] = [];
  for (const [name, av] of a) {
    if (!b.has(name)) continue;
    out.push({ name, count: Math.max(1, Math.min(av, b.get(name) as number)) });
  }
  return out.sort((x, y) => y.count - x.count || (x.name < y.name ? -1 : x.name > y.name ? 1 : 0));
}

/** The set of canonical tag names present in a list — for unweighted set overlap. */
export function tagNameSet(tags: readonly WeightedTag[] | null | undefined): Set<string> {
  return new Set(normalizeTags(tags).map((t) => t.name));
}

/** Unweighted Jaccard over two canonical tag-name sets, in [0,1]. */
export function setJaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const name of a) if (b.has(name)) inter += 1;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}
