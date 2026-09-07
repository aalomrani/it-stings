/**
 * Title / artist normalisation. Shared by the resolver, the Stage-4 verifier, candidate
 * dedupe and the ranker's one-track-per-artist rule — four places that must agree
 * exactly, which is why this lives in one file and is tested hard.
 *
 * Pure functions, no I/O. Rules are specified in docs/tasks/phase1-core.md step 11.
 */

/**
 * Words that mark an edition/variant rather than a different song. Used both inside
 * brackets — "(2018 Remaster)", "[Live]" — and after a trailing dash — " - Radio Edit".
 * Deliberately unanchored: "Mixed", "Remastered", "Remixes" all match.
 */
const VARIANT =
  /remaster|remastered|live|remix|edit|version|mono|stereo|feat\.?|featuring|demo|mix|radio|single|album|deluxe|explicit|clean|bonus|anniversary|\d{4}/i;

/**
 * Featured-artist markers. The cut runs BEFORE punctuation stripping because the marker
 * itself is partly punctuation (the `.` in `feat.`, the bracket in `(feat`).
 *
 * NARROW ON PURPOSE. An earlier version also cut at whole-word `and`, `with`, `x` and
 * `&`, which destroyed real band names — "Florence and the Machine" became "florence",
 * "Sleeping with Sirens" became "sleeping". Those four words stay inside the name;
 * `&` is normalised to "and" instead ("Simon & Garfunkel" === "Simon and Garfunkel").
 * Only an explicit feature marker cuts.
 */
const FEATURE_SEP =
  /(?:[([]\s*(?:feat|ft|featuring)\b)|(?:\s+(?:feat|ft|featuring)\.?(?=\s|$))/i;

/**
 * The punctuation and words that separate one CREDITED ACT from another inside a single
 * credit string. `and` / `with` / `x` / `vs` need whitespace on both sides, so "Malcolm X"
 * keeps its X and "AC/DC" is never split (a slash is not a joiner at all).
 *
 * Used by `creditSegments`, which is what makes `artistOverlap` honest.
 */
const CREDIT_JOINER =
  /(?:[([]\s*(?:feat|ft|featuring)\b\.?\s*)|(?:\s+(?:feat|ft|featuring)\.?\s+)|(?:\s*[,&+]\s*)|(?:\s+(?:and|with|x|vs|versus|meets|presents)\.?\s+)/gi;

/** Only extracts the names after an explicit feature marker. */
const FEATURE_CREDIT = /(?:[([]\s*|\s+)(?:feat|ft|featuring)\b\.?\s*([^)\]]*)/gi;

/**
 * The longest a serial-comma BAND name's tail may be. "Earth, Wind & Fire" and "Crosby,
 * Stills & Nash" both trail three words; "Haley Reinhart, Wheeling High School Jazz Combo
 * & Brian Logan" trails eight and is a list of collaborators, not a band.
 */
const SERIAL_COMMA_MAX_TAIL_WORDS = 4;

/**
 * A comma normally separates collaborators ("Louis Prima, Keely Smith") — but not in the
 * serial-comma band names ("Earth, Wind & Fire", "Crosby, Stills & Nash", "Blood, Sweat
 * & Tears"), which always join their last member with "and"/"&". So a comma cuts unless
 * what follows it is a SHORT tail carrying such a joiner.
 */
function cutAtCollaboratorComma(s: string): string {
  const i = s.indexOf(',');
  if (i <= 0) return s;
  const rest = s.slice(i + 1);
  const words = rest.trim().split(/\s+/).filter(Boolean);
  if (/\band\b/.test(rest) && words.length <= SERIAL_COMMA_MAX_TAIL_WORDS) return s;
  return s.slice(0, i);
}

/** NFKD, then drop the combining marks it split off: "telepatía" -> "telepatia". */
function foldDiacritics(s: string): string {
  return s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
}

function collapse(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** Remove `(...)`, `[...]`, `{...}` segments whose contents look like an edition marker. */
function stripVariantBrackets(s: string): string {
  let out = s;
  for (let pass = 0; pass < 4; pass++) {
    const next = out.replace(/[([{]([^()[\]{}]*)[)\]}]/g, (match, inner: string) =>
      VARIANT.test(inner) ? ' ' : match,
    );
    if (next === out) break;
    out = next;
  }
  return out;
}

/** Remove a trailing " - <edition marker>" (also en/em dash), repeatedly. */
function stripVariantSuffix(s: string): string {
  let out = s;
  for (let pass = 0; pass < 4; pass++) {
    const m = /\s+[-–—]\s+([^-–—]*)$/.exec(out);
    if (!m || m.index === undefined || !VARIANT.test(m[1])) break;
    out = out.slice(0, m.index);
  }
  return out;
}

/**
 * Apostrophes are DELETED so "don't" -> "dont"; every other non-alphanumeric becomes a
 * space so "Jump, Jive an' Wail" -> "jump jive an wail".
 */
function stripPunctuation(s: string): string {
  return s.replace(/['’ʼ`´]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ');
}

/** Everything before the first featured-artist separator; the whole string if none. */
function cutAtFeature(s: string): string {
  const m = FEATURE_SEP.exec(s);
  return m && m.index > 0 ? s.slice(0, m.index) : s;
}

/**
 * Normalised song title: diacritics folded, edition markers removed, punctuation gone.
 * Does NOT drop a leading "the" — "The Lovecats" and "The Love Cats" must stay distinct
 * (a real Last.fm ambiguity the resolver deals with, not normalisation).
 */
export function normTitle(s: string): string {
  let out = foldDiacritics(s).toLowerCase();
  out = out.replace(/&/g, 'and');
  out = stripVariantBrackets(out);
  out = stripVariantSuffix(out);
  out = stripPunctuation(out);
  return collapse(out);
}

/**
 * Normalised PRIMARY artist: the title pipeline, then cut at an explicit feature marker
 * or a collaborator comma, then drop a leading "the" so "The Cure" === "Cure".
 *
 * "&" and "+" both become "and" before the comma test, so "Earth, Wind & Fire" and
 * "Florence + the Machine" survive whole.
 */
export function normArtist(s: string): string {
  let out = foldDiacritics(s).toLowerCase();
  out = out.replace(/&/g, ' and ').replace(/(?<=\S)\s*\+\s*(?=\S)/g, ' and ');
  out = stripVariantBrackets(out);
  out = stripVariantSuffix(out);
  out = cutAtFeature(out);
  out = cutAtCollaboratorComma(out);
  out = stripPunctuation(out);
  out = collapse(out);
  return collapse(out.replace(/^the\s+/, ''));
}

/**
 * Every act named inside one credit string, each normalised on its own.
 *
 *   "The Avener & Waldeck"  -> ["avener", "waldeck"]
 *   "Florence + the Machine" -> ["florence", "machine"]
 *   "Sia Momo"               -> ["sia momo"]      // no joiner: ONE act, not two
 *
 * The last line is the whole point. Splitting only at explicit joiners is what stops a
 * one-token act name from matching any longer name that happens to contain it.
 */
export function creditSegments(s: string): string[] {
  const folded = stripVariantSuffix(stripVariantBrackets(foldDiacritics(s).toLowerCase()));
  const out: string[] = [];
  for (const part of folded.split(CREDIT_JOINER)) {
    const norm = collapse(collapse(stripPunctuation(part ?? '')).replace(/^the\s+/, ''));
    if (norm.length > 0) out.push(norm);
  }
  return [...new Set(out)];
}

/**
 * The acts a title or credit names as FEATURED: "Creep (feat. Haley Reinhart)" ->
 * ["haley reinhart"]. The Stage-4 verifier uses it so a candidate that names only the
 * guest still reaches the record the guest actually sings on.
 */
export function featuredArtists(s: string): string[] {
  const folded = foldDiacritics(s).toLowerCase();
  const out: string[] = [];
  FEATURE_CREDIT.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = FEATURE_CREDIT.exec(folded)) !== null) {
    for (const part of (m[1] ?? '').split(CREDIT_JOINER)) {
      const norm = collapse(collapse(stripPunctuation(part ?? '')).replace(/^the\s+/, ''));
      if (norm.length > 0) out.push(norm);
    }
  }
  return [...new Set(out)];
}

/**
 * True when `a` and `b` name the same act, allowing for one of them carrying EXTRA
 * CREDITED ACTS the other omits: "The Cure" vs "The Cure & Siouxsie" overlap, "The Cure"
 * vs "The Smiths" do not. This is the check the Stage-4 verifier uses (a Deezer credit
 * often carries a collaborator the candidate name omits) and the looser twin of
 * `sameArtist`, which stays exact.
 *
 * DIRECTIONAL AND JOINER-AWARE ON PURPOSE. An earlier version accepted any whole-token
 * run, so a one-token act matched every longer name containing it — `artistOverlap("Sia
 * Momo", "Sia")` was true and Stage 4 certified "Sia Momo — Titanium (2T21 Edit)" as
 * Sia's "Titanium". The shorter name is now accepted only when it is one of the other's
 * credit SEGMENTS, i.e. the extra text is a different act, not more of the same name.
 * "Prince" no longer matches "Prince Buster"; "Hell" no longer matches "Hell on Wheels".
 */
export function artistOverlap(a: string, b: string): boolean {
  const na = normArtist(a);
  const nb = normArtist(b);
  if (na.length === 0 || nb.length === 0) return false;
  if (na === nb) return true;
  return creditSegments(b).includes(na) || creditSegments(a).includes(nb);
}

/** Same primary artist, normalised. */
export function sameArtist(a: string, b: string): boolean {
  const na = normArtist(a);
  return na.length > 0 && na === normArtist(b);
}

/**
 * Same title, normalised — or one a prefix of the other with a remainder of at most four
 * characters of punctuation/whitespace. (After normalisation punctuation is already gone,
 * so in practice the prefix arm only tolerates trailing separator debris.)
 */
export function sameTitle(a: string, b: string): boolean {
  const na = normTitle(a);
  const nb = normTitle(b);
  if (na.length === 0 || nb.length === 0) return false;
  if (na === nb) return true;
  const [short, long] = na.length <= nb.length ? [na, nb] : [nb, na];
  if (!long.startsWith(short)) return false;
  const rest = long.slice(short.length);
  return rest.length <= 4 && /^[\s\p{P}]*$/u.test(rest);
}

/** The dedupe / cache key for a candidate: `<normArtist>|<normTitle>`. */
export function trackNormKey(artist: string, title: string): string {
  return `${normArtist(artist)}|${normTitle(title)}`;
}
