# It Stings — API reality

Synthesized from eight reconnaissance probes run on **2026-09-06** from a machine whose IP geolocates to **SA (Saudi Arabia)** (`curl -s https://ifconfig.co/country-iso` → `SA`; Deezer `/infos` → `country_iso: "SA"`). Every statement below is backed by a real request listed in section 9. Anything marked **UNTESTED** was not observed; the probes report what the API returned *without* a key in those cases. No API keys existed in the probe environment, and none appear in this document.

Shared sample set used by every coverage table (artist — title — year): 1 The Cure — The Lovecats — 1983 · 2 Louis Prima — Jump, Jive an' Wail — 1956 · 3 Cherry Poppin' Daddies — Zoot Suit Riot — 1997 · 4 Caravan Palace — Lone Digger — 2015 · 5 Squirrel Nut Zippers — Hell — 1996 · 6 Peggy Lee — Fever — 1958 · 7 Talking Heads — Psycho Killer — 1977 · 8 Billie Eilish — bad guy — 2019 · 9 Olivia Rodrigo — vampire — 2023 · 10 Sade — Smooth Operator — 1984 · 11 Parov Stelar — Booty Swing — 2012 · 12 The Stranglers — Golden Brown — 1981 · 13 Kali Uchis — telepatía — 2020 · 14 Big Bad Voodoo Daddy — Mr. Pinstripe Suit — 1998 · 15 Lawrence Arabia — Apple Pie Bed — 2009.

---

## 1. Status board

| API | Status | Signup | Single most important gotcha |
|---|---|---|---|
| iTunes Search API (`itunes.apple.com/search`, `/lookup`) | **Works keyless** | — | **No ISRC anywhere**: no `isrc` field in `/search` or `/lookup?id=`, and `/lookup?isrc=<valid ISRC>` returns `{"resultCount":0}`. From this IP every explicit track comes back `trackExplicitness:"cleaned"`. |
| Deezer public API (`api.deezer.com`) | **Works keyless** | — | Preview MP3 URLs carry an HMAC (`hdnea=exp=…~hmac=…`) that **expires exactly 900 s** after mint; tampered/stripped → 403. **All errors, including throttling, are HTTP 200** with `{"error":{"type","message","code"}}`. |
| MusicBrainz WS/2 (`musicbrainz.org/ws/2`) | **Works keyless** (descriptive User-Agent mandatory, else 403) | — | Even at 1 req/s with a proper UA, **12 of ~45 requests returned HTTP 503 "server busy"** (`retry-after: 0`); every retry succeeded. Retry-on-503 is mandatory. |
| AcousticBrainz v1 (`acousticbrainz.org/api/v1`) | **Works keyless** — read-only frozen dataset | — | Data collection stopped in 2022 ("the website and its API will continue to be available"). **Nothing for the only post-2022 track** (vampire 2023: count 0, 404). Bulk endpoints cap at 25 MBIDs. |
| Last.fm (`ws.audioscrobbler.com/2.0`) | **Needs key** | https://www.last.fm/api/account/create (302 → login; create a user at https://www.last.fm/join first) | Missing key → **HTTP 400 `error:6`**, the *same* code documented for "not found"; invalid key → 403 `error:10`. Check for the key locally; never call upstream without one. ToS 2.6 forbids scraping www.last.fm; 4.3.4 caps stored data at 100 MB. |
| Spotify Web API (`api.spotify.com/v1`) | **Needs key** (+ app owner must have **Premium**) | https://developer.spotify.com/dashboard | Development Mode today: **5 authorized users** (not 25), Premium required, search `limit` max **10** (default 5), batch `GET /tracks` / audio-features / recommendations / related-artists **Deprecated**, playlist writes renamed `/tracks` → `/items`, redirect URI must be `http://127.0.0.1:PORT/…` (**`localhost` rejected**). |
| Spotify keyless surfaces (`open.spotify.com/oembed`, `/embed/track/{id}`, `/track/{id}`, `/search/{q}`) | **Works keyless** | — | `/embed/track/{id}` returns **200 even for nonexistent IDs**; validate with oEmbed (404 empty body for bad IDs). |
| Tavily (`api.tavily.com/search`) | **Needs key** | https://app.tavily.com | 1,000 free credits/month, no card. `search_depth:"advanced"` costs 2 credits and `auto_parameters` may silently pick it — pin `basic`. Terms contain no result-retention prohibition. |
| Brave Search API (`api.search.brave.com/res/v1/web/search`) | **Needs key** (credit card required even for the free $5/month) | https://api-dashboard.search.brave.com/app/plans | ToS (1 Sep 2026): may not "store, cache, or create a database of Search Results … other than transient storage". Auth failures are **HTTP 422**, not 401. |
| Exa (`api.exa.ai/search`) | **Needs key** | https://dashboard.exa.ai/api-keys | No key → **HTTP 402 x402 crypto-payment challenge** (not 401). ToS 4.2(a) bars copying/storing information obtained through the Services except browser cache. `neural`/`keyword` types are gone. |
| Serper (`google.serper.dev/search`) | **Needs key** — not recommended | https://serper.dev | SERP snippets only, no page content; 2,500 one-time free queries; its scrape host would be proxied Reddit scraping. |
| Reddit (direct) | **Dead (blocked)** | — | `search.json` → **403** with a 190 KB HTML block page; `old.reddit.com` → 302 login wall; OAuth token endpoint → 401 (needs registered app; Data API terms require a separate agreement for commercial use). |
| rateyourmusic.com | **Dead (blocked)** | — | Cloudflare JS challenge (403, `cf-mitigated: challenge`, "Just a moment..."). |
| GetSongBPM (`api.getsong.co`) | **Needs key** (free; **backlink mandatory**) | https://getsongbpm.com/api (browser only — Cloudflare challenge blocks curl) | Live host is **`api.getsong.co`**; the documented old host `api.getsongbpm.com` serves a Cloudflare challenge instead of redirecting. Signup form requires an existing backlink URL. `tempo` arrives as a **string** (`"220"`). |
| tunebat.com / songbpm.com | **Dead / not an API** | — | tunebat: 403 Cloudflare challenge on site, robots.txt and `api.tunebat.com`; songbpm: plain HTML Astro site with a POST form, no JSON endpoint. |
| Odesli / song.link | **Dead** | — | `401 {"statusCode":401,"code":"PUBLIC_API_ACCESS_DEPRECATED"}`. |
| Wikidata (P2207 Spotify track ID) | Works keyless but **throttles** | — | HTTP 429 after ~40 requests at 1 req/s (and again after 7 at 2.5 s spacing). Optional at best. |
| Anthropic API via `@anthropic-ai/sdk` 0.124.0 | **Needs key — UNTESTED** (no request made) | — | Structured output = `output_config: { format: zodOutputFormat(schema) }` + `client.messages.parse()` → `message.parsed_output`. No `output_format`/`response_format` param exists in the types. |
| Toolchain: Next 16.3.4 + better-sqlite3 13.0.3 + TS 5.9.3 | **Works** on macOS 15.5 arm64 / Node 24.20.0 / npm 11.19.0 | — | npm 11.19's **`allowScripts` gate silently skips** install scripts (exit 0, only a warning); better-sqlite3 still works because it ships a prebuilt `darwin-arm64.node`. `@types/better-sqlite3` is required or `tsc`/`next build` fail with TS7016. |

---

## 2. Environment variables

Proposed names (aligned with `docs/architecture.md`). All are read server-side only; none is ever shipped to the client bundle.

| Var | Consumed by | When missing | Probe status |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | recommendation engine (`@anthropic-ai/sdk`) | recommendations unavailable; search / resolve / preview / playlists keep working | UNTESTED — SDK type-checks and bundles; no API call was made |
| `ITSTINGS_MODEL` | engine | falls back to the default in `docs/model.md` | — (SDK `Model` union includes `'claude-fable-5-1'`, `'claude-sonnet-5'`, `'claude-opus-5'`, … and `(string & {})`) |
| `LASTFM_API_KEY` | Channel A: `track.getSimilar`, `track.getTopTags`, `tag.getTopTracks`, `track.getInfo`, `artist.getSimilar` | Channel A skipped; `/api/lastfm/status` reports `configured:false`. **Never call upstream without it** — upstream answers `error:6`, indistinguishable from "not found" | UNTESTED (only error shapes observed) |
| `TAVILY_API_KEY` | Channel B primary search provider | fall through to Brave; if neither key, Channel B skipped | UNTESTED (401 shape observed) |
| `BRAVE_SEARCH_API_KEY` | Channel B fallback | — | UNTESTED (422 shape observed) |
| `EXA_API_KEY` | Channel B optional third provider | — | UNTESTED (401 / 402 shapes observed) |
| `SERPER_API_KEY` | not needed (skip) | — | UNTESTED (403 shape observed) |
| `SPOTIFY_CLIENT_ID` | PKCE login, `/v1/search`, `POST /v1/me/playlists`, `POST /v1/playlists/{id}/items` | Spotify link falls back to `https://open.spotify.com/search/<artist> <title>` (keyless deep link); playlist export disabled; oEmbed/embed still work when an ID is known | UNTESTED (401 / 400 `invalid_client` shapes observed) |
| `SPOTIFY_CLIENT_SECRET` | only if the classic auth-code flow is used instead of PKCE | not needed for PKCE | UNTESTED |
| `SPOTIFY_REDIRECT_URI` | Spotify auth; must be a loopback IP literal such as `http://127.0.0.1:3000/api/spotify/callback` (`localhost` is rejected by Spotify) | auth cannot start | — (docs quoted) |
| `GETSONGBPM_API_KEY` | tempo fallback (`api.getsong.co`) | tempo provider is not registered; tempo comes from Deezer `bpm` / AcousticBrainz `rhythm.bpm` or stays unknown | UNTESTED (401 shapes observed) |

No env var is needed for iTunes, Deezer, MusicBrainz, AcousticBrainz, or Spotify's oEmbed / embed / deep-link surfaces. MusicBrainz needs a fixed `User-Agent: ItStings/0.1 (local dev)` (constant, not a secret).

---

## 3. Per-API findings

### 3.1 iTunes Search API — observed reality (probed from an SA-geolocated IP)

**Status: works, no key, no rate limiting observed, CORS `*` on API and asset hosts.** All 15 sample tracks found in both `country=US` and `country=GB`, each with `previewUrl` (30 s AAC ~1 MB, range-capable, CORS-open) and `artworkUrl100` (upsizable).

#### Endpoints
| Endpoint | Params observed working | Notes |
|---|---|---|
| `GET https://itunes.apple.com/search` | `term` (URL-encoded, `+` for space), `entity=song`, `limit` (1..200, **hard cap 200**: `limit=500` still returned 200), `country` (US, GB), `media=music`, `attribute=songTerm`, `explicit=Yes|No` (no observable effect from this IP) | Missing `term` → HTTP 200 `{"resultCount":0,"results":[]}` (never a 4xx) |
| `GET https://itunes.apple.com/lookup` | `id=<trackId>`, `id=<id1>,<id2>,<id3>` (comma list works: 3 ids → 3 results in 0.60 s), `id=<collectionId>&entity=song` (album + its tracks), `upc=<upc>` (worked: `upc=603497862962` → collection "Greatest Hits" collectionId 1288102355), `country` | `isrc=` **does not work** (see ISRC) |

Response envelope: `{"resultCount": N, "results": [...]}`. Raw body starts with three `\n` before `{` (bytes `0a0a0a7b`); headers are `content-type: text/javascript; charset=utf-8` and `content-disposition: attachment; filename=1.txt`. `JSON.parse` on the text is fine.

Response headers of note: `access-control-allow-origin: *`, `cache-control: max-age=86400`, `x-cache: TCP_MISS/HIT from ...akamaitechnologies.com`, `x-true-cache-key: /L/itunes.apple.com/search vcd=2897 ci2=country=US&entity=song&limit=3&term=...` (Akamai caches per exact query string — normalize param order in the proxy to get edge hits), `apple-timing-app: 61 ms`. OPTIONS preflight → 200 with `access-control-allow-methods: GET,POST,HEAD,OPTIONS`, `access-control-allow-headers: *`, `access-control-max-age: 86400`.

#### Track result shape (`wrapperType:"track"`, `kind:"song"`) — exactly 31 keys observed, identical in /search and /lookup
```
artistId, artistName, artistViewUrl,
collectionId, collectionName, collectionCensoredName, collectionViewUrl, collectionPrice, collectionExplicitness,
trackId, trackName, trackCensoredName, trackViewUrl, trackPrice, trackExplicitness, trackTimeMillis, trackNumber, trackCount,
discNumber, discCount, previewUrl, artworkUrl30, artworkUrl60, artworkUrl100,
releaseDate (ISO "1983-10-18T12:00:00Z"), primaryGenreName, country ("USA"/"GBR"), currency ("USD"/"GBP"), isStreamable, kind, wrapperType
```
Real example (US): `trackId 1288102536`, `artistName "The Cure"`, `trackName "The Lovecats"`, `collectionName "Greatest Hits"`, `trackTimeMillis 220093`, `releaseDate "1983-10-18T12:00:00Z"`, `primaryGenreName "Alternative"`, `isStreamable true`, `trackExplicitness "notExplicit"`.

**There is no `isrc` field** in either endpoint's output. Album results from `/lookup?id=<collectionId>` have `wrapperType:"collection"`, `collectionType:"Album"`, `collectionExplicitness`, and no `trackExplicitness`.

#### ISRC — dead end
- `/lookup?isrc=USUM71900764` (Billie Eilish "bad guy", ISRC obtained live from Deezer `/track/655095912`) → HTTP 200 `{"resultCount":0,"results":[]}`.
- Same with `&country=GB`, `&entity=song`, `&entity=musicTrack&country=US` → 0 results each.
- `/lookup?isrc=GBALB8300001` (The Cure "The Lovecats", from Deezer) → 0 results.
- Bogus `isrc=ZZZZZ9999999` → same 200 / 0 (no error shape to distinguish "not found" from "unsupported").

Conclusion: cannot get or resolve ISRCs via iTunes. Use MusicBrainz/Deezer for ISRC; join to iTunes by normalized artist+title, then pick the candidate whose `trackTimeMillis` is within ~2 s of the reference duration.

#### Artwork (`artworkUrl100` on is1-ssl.mzstatic.com)
Rewriting the trailing `100x100bb.jpg` works, verified by real fetches of the same asset:
| URL suffix | Status | content-type | content-length |
|---|---|---|---|
| `600x600bb.jpg` | 200 | image/jpeg | 117267 (decoded JPEG SOF = 600x600) |
| `1000x1000bb.jpg` | 200 | image/jpeg | 280688 |
| `3000x3000bb.jpg` | 200 | image/jpeg | 946089 |
| `600x600bb.webp` | 200 | image/webp | 33226 |

Headers: `access-control-allow-origin: *`, `cache-control: max-age=15167638, no-transform`, `access-control-expose-headers: Content-Length,Content-Type,ETag,Cache-Control,Expires,Last-Modified`. Artwork URLs differ per storefront for the same song (US Lovecats art is `.../603497862962.jpg/...`, GB is `.../06UMGIM29542.rgb.jpg/...`).

#### previewUrl (audio-ssl.itunes.apple.com)
Present on all 30 sample matches (15 tracks × 2 storefronts). Three HEADs:
| Track | Status | content-type | content-length |
|---|---|---|---|
| The Lovecats | 200 | audio/x-m4p | 974850 |
| bad guy | 200 | audio/x-m4p | 1060807 |
| telepatía | 200 | audio/x-m4p | 1040881 |

Headers on all: `accept-ranges: bytes`, `access-control-allow-origin: *`, `access-control-allow-headers: range`, `access-control-allow-methods: HEAD, GET, PUT`, `access-control-allow-credentials: false`, `access-control-expose-headers: *`, `access-control-max-age: 3000`, `cache-control: public, max-age=30761274`. Range GET (`Range: bytes=0-1023`, `Origin: http://localhost:3000`) → **206** `content-range: bytes 0-1023/974850`; first bytes `00 00 00 18 66 74 79 70 4d 34 41 20` = `ftypM4A` (plain AAC-in-M4A despite the `audio/x-m4p` label). Header evidence says a browser `<audio src>` from any origin can fetch and seek it; **not verified in an actual browser**. Preview URLs are **unsigned** (no expiring token in the URL) and differ per storefront (different `mzaf_` ids for US vs GB Lovecats).

#### Explicit content — filtered by caller location (observed; root cause inferred)
- `ifconfig.co/country-iso` → `SA` for this machine.
- `term=cardi+b+wap&country=US` → 3 results, all `trackExplicitness:"cleaned"`; identical with `&explicit=Yes`.
- `term=olivia+rodrigo+vampire&country=US&explicit=Yes` → `vampire [GUTS]` id 1694768031 `cleaned`, `vampire [GUTS (spilled)]` id 1736995100 `cleaned`.
- `/lookup?id=1694767605&entity=song` (GUTS album) → `collectionExplicitness:"cleaned"`, tracks `bad idea right?` and `vampire` `cleaned`, others `notExplicit`.
- Across 738 track records saved this session: 707 `notExplicit`, 31 `cleaned`, **0 `explicit`**.
- `explicit=No` returned the same list as default.

Implication when the app runs from this location: previews are clean edits; `trackExplicitness` cannot be used to flag explicit songs; `trackId`s for explicit originals are not reachable. UNTESTED from a non-SA vantage point (no proxies used per ground rules), so "geo-based" is an inference consistent with all observations.

#### Storefront / `country`
- No sample track missing in US or GB; all 15 found in both.
- `trackId`/`collectionId` are storefront-specific in practice: `/lookup?id=1288102536&country=GB` (a US Lovecats id) → `resultCount:0`. GB Lovecats is `trackId 1440932670`, `collectionId 1440932660`, `collectionName "The Cure: Greatest Hits"`, `trackTimeMillis 218600` (vs 220093 US). Same-id cases exist (Zoot Suit Riot 675806955, Lone Digger 1005692215, bad guy 1450695739, Psycho Killer 20833655 identical in both).
- Store `(trackId, country)` together; never look up an id without the country it came from.

#### Typeahead suitability
| term | time_total | top results |
|---|---|---|
| `loveca` | 0.72 s | Taylor Swift "Lover", "Cruel Summer", ... — The Cure absent from top 5 |
| `jump jive` | 0.68 s | Brian Setzer Orchestra "Jump, Jive an' Wail" #1, Louis Prima #2 |
| `psycho k` | **6.26 s** first run, 0.56 s / 0.44 s on re-runs | "Psycho" by Eddie Noack, Red Velvet, ... — Talking Heads absent |
| `psycho killer` | 0.78 s | Talking Heads #1 |
| `telepat%C3%ADa` vs `telepatia` | 0.66 s / 0.67 s | identical 5 results, Kali Uchis #1 (diacritics are folded) |

Latency for full-word `artist title` queries: 0.67–1.31 s over 30 requests (median ~0.77 s). `limit=200` response: 302 KB, 2.6 s. Partial-word prefixes are matched poorly (no prefix search on the last token), so a typeahead needs whole words or artist context; debounce ≥300 ms and cache.

#### Rate limiting
25 back-to-back requests with unique cache-busting terms (all `x-cache: TCP_MISS`, i.e. origin hits) completed in 18.5 s: 25/25 HTTP 200, no `retry-after`/`x-ratelimit*` headers, and a follow-up request 5 s later was 200. Apple's documented ~20 req/min limit was not hit; no 403/429 body observed, so the **error shape is UNKNOWN**. Keep the proxy at ≤20/min anyway and lean on `cache-control: max-age=86400`.

#### Coverage over the sample set (query = `term=<artist> <title>&entity=song&limit=10`)
| # | Track | US found (rank, trackId) | Version returned / notes | releaseDate | preview / art |
|---|---|---|---|---|---|
| 1 | The Cure — The Lovecats (1983) | yes (1, 1288102536) | studio, on "Greatest Hits" compilation; Japanese Whispers version at rank 5; remix/acoustic/live also present | 1983-10-18 | yes / yes |
| 2 | Louis Prima — Jump, Jive an' Wail (1956) | yes (2, 543999200) | title spelled "Jump, Jive, An' Wail"; rank 1 is "(1996 Remaster)"; Brian Setzer cover ranks above Prima on partial queries | 1956-11-01 | yes / yes |
| 3 | Cherry Poppin' Daddies — Zoot Suit Riot (1997) | yes (1, 675806955) | studio, original album; 20th-anniversary/live versions present | 1997-03-18 | yes / yes |
| 4 | Caravan Palace — Lone Digger (2015) | yes (1, 1005692215) | studio, "<I°_°I>" | 2015-09-18 | yes / yes |
| 5 | Squirrel Nut Zippers — Hell (1996) | yes (1, 1443757613) | on "The Best of" compilation; releaseDate 1997 not 1996 | 1997-01-01 | yes / yes |
| 6 | Peggy Lee — Fever (1958) | yes (1, 715591830) | "Things Are Swingin'"; 1989 re-record present; GB rank 1 is 1970 "Best of" compilation | 1958-11-03 | yes / yes |
| 7 | Talking Heads — Psycho Killer (1977) | yes (1, 20833655) | on "The Best of (Remastered)"; 2024 Remaster, live, acoustic present | 1977-09-16 | yes / yes |
| 8 | Billie Eilish — bad guy (2019) | yes (1, 1450695739) | studio album; Bieber remix rank 2 | 2019-03-29 | yes / yes |
| 9 | Olivia Rodrigo — vampire (2023) | yes (1, 1736995100) | **`cleaned`** edit (GUTS (spilled)); GUTS original 1694768031 also `cleaned` | 2023-06-30 | yes / yes |
| 10 | Sade — Smooth Operator (1984) | yes (1, 604770244) | rank 1 is "(Single Version)" 258693 ms; exact-title album version 294133 ms only surfaced in GB at rank 5 | 1984-08-28 | yes / yes |
| 11 | Parov Stelar — Booty Swing (2012) | yes (1, 1855694439) | "The Paris Swing Box - EP"; releaseDate 2010 not 2012 | 2010-07-23 | yes / yes |
| 12 | The Stranglers — Golden Brown (1981) | yes (2, 696838901) | rank 1 is "(Slowed Down Version)"; album version says 1983-01-01 (La folie reissue), original 1981 date only on the sped/slowed single | 1983-01-01 | yes / yes |
| 13 | Kali Uchis — telepatía (2020) | yes (1, 1541731262) | studio; acoustic versions present | 2020-11-18 | yes / yes |
| 14 | Big Bad Voodoo Daddy — Mr. Pinstripe Suit (1998) | yes (1, 1440897370) | studio; releaseDate 1994 (self-titled first issue) not 1998; only 3 results total | 1994-01-01 | yes / yes |
| 15 | Lawrence Arabia — Apple Pie Bed (2009) | yes (1, 1774368858) | "Chant Darling"; only 1 result in US (4 in GB, GB id 949837536) | 2009-01-01 | yes / yes |

GB: all 15 found, all with preview + artwork; differing ids for #1 (1440932670), #2 (726137265), #6 (724175496), #9 (1694768031), #10, #12 (697039305), #15 (949837536).

`releaseDate` is the date of the album/collection the returned track sits on, not the original recording's release — unreliable for the app's "year" field (5/15 disagree with the sample year: Hell, Booty Swing, Golden Brown, Mr. Pinstripe Suit, plus Fever in GB).

#### Recommended usage in It Stings
- Server route `/api/itunes/search?q=&country=` → `https://itunes.apple.com/search?term=<q>&media=music&entity=song&limit=25&country=<cc>`; strip leading whitespace, `JSON.parse`. Cache in SQLite keyed on normalized `(term, country, limit)` for ≥24 h (Apple itself sets max-age 86400).
- Build `term` as `"<artist> <title>"` with whole words; do not rely on prefix matching for the last token; debounce typeahead ≥300 ms; expect ~0.7 s per call with rare multi-second outliers, so add a client-side timeout (~5 s) and show cached results first.
- Persist `trackId`, `collectionId`, `country`, `previewUrl`, `artworkUrl100`, `trackTimeMillis`, `trackName`, `collectionName`, `artistName`, `trackExplicitness`. Derive large artwork by replacing `/100x100bb.jpg` with `/600x600bb.jpg` (or `.webp`) at render time; no need to store it.
- Version selection: prefer candidates whose `trackName` equals the target exactly (no parenthetical "(Live)", "(Remaster)", "(Slowed…)"), and whose `trackTimeMillis` is closest to a reference duration from MusicBrainz/Deezer; compilations ("Greatest Hits", "Best of") are usually the same studio master and fine to use.
- Get ISRC and original release year from MusicBrainz/Deezer, not iTunes.
- Preview playback: stream `previewUrl` directly in `<audio>` (CORS `*`, range support) or through the proxy; it is ~30 s AAC ~1 MB, `audio/x-m4p` label.
- If the deployment runs from Saudi Arabia (as this probe did), explicit songs will only come back as `cleaned` edits; do not build explicit-flag features on `trackExplicitness` from this location.

---

### 3.2 Deezer public API — observed reality

All findings are from real requests made 2026-09-06 ~10:57–12:17 UTC from a client Deezer geolocates as `country_iso: "SA"` (`GET /infos`). No API key, no auth, no cookies were sent. Deezer sets Akamai bot-manager cookies (`_abck`, `bm_sz`, `dzr_uniq_id`) on every response; ignoring them caused no problems.

#### Auth / key
- None required for any endpoint tested. `/infos` returns `user_token: null` and still works.
- developers.deezer.com was NOT visited during the probe.

#### Transport facts
- HTTP/2, `server: Apache`, `content-type: application/json; charset=utf-8`, `x-content-type-options: nosniff`, `x-org: FR`. No `cache-control`/`etag` on API responses. No rate-limit headers of any kind (grep for rate|quota|retry|limit over 130 response header sets: none).
- **Errors are always HTTP 200.** Shape: `{"error":{"type":"<Type>","message":"<msg>","code":<int>}}`. Observed:
  - `/track/0`, `/track/999999999999`, `/track/isrc:ZZZZZ0000000`, `/album/0` → `{"error":{"type":"DataException","message":"no data","code":800}}`
  - `/search` (no q) → `{"type":"MissingParameterException","message":"Missing parameters: q","code":501}`
  - `/search?q=` → `{"type":"ParameterException","message":"empty parameter","code":500}`
  - `/nonexistent` → `{"type":"InvalidQueryException","message":"Unknown path components : /nonexistent","code":600}`
  - throttled → `{"type":"Exception","message":"Quota limit exceeded","code":4}`
  - No results is NOT an error: `/search?q=zzqxjvkwpl` → `{"data":[],"total":0}`.
- `?output=jsonp&callback=cb` → `content-type: text/javascript; charset=utf-8`, body `cb({...})`. Without `callback` the body is `({...})`. `?output=xml` → `application/xml` with CDATA-wrapped fields.

#### CORS (verified from headers)
- `api.deezer.com` GET (with and without `Origin: http://localhost:3000`) and OPTIONS preflight return `access-control-allow-headers`, `access-control-allow-methods: POST, GET, OPTIONS, DELETE, PUT`, `access-control-allow-credentials: true`, `access-control-expose-headers: Location`, `access-control-max-age: 86400` — but **no `access-control-allow-origin`**. A browser `fetch()` to api.deezer.com will fail CORS. JSONP is the only browser-direct path; the app's server-route proxy design is correct.
- `cdnt-preview.dzcdn.net` (preview MP3): `access-control-allow-origin: *`, `access-control-allow-headers: Range`, `access-control-expose-headers: x-deezer-client-ip, content-length, content-range, Akamai-Request-BC`. Browser can `fetch()`/`<audio>` the signed preview URL directly, including Range requests.
- `cdn-images.dzcdn.net` (covers/artist pictures): `access-control-allow-origin: *`, `cache-control: public`, `content-type: image/jpeg`.

#### Endpoints

**`GET /search?q=<terms>`** (also `/search/track?q=`)
- Params observed working: `q` (required), `limit` (default 25; **max 100, silently clamped** — `limit=200`/`500` return 100 items and `next` with `index=100`), `index` (offset), `order=RANKING` (no change vs default), `strict=on` (no change observed).
- Response: `{"data":[...], "total":<int>, "next":"<url>"?, "prev":"<url>"?}`. `next`/`prev` are absolute URLs with `index=` filled in; `next` absent when no more pages. `total` is fuzzy: it changed between pages of the same query (237 vs 235) and is capped at 300 for broad queries.
- `/search/track` returned the identical item shape and ordering as `/search` for the same query.
- **Search item fields (exact):** `id, readable, title, title_short, title_version, isrc, link, duration, rank, explicit_lyrics, explicit_content_lyrics, explicit_content_cover, preview, md5_image, artist{id,name,link,picture,picture_small,picture_medium,picture_big,picture_xl,tracklist,type}, album{id,title,cover,cover_small,cover_medium,cover_big,cover_xl,md5_image,tracklist,type}, type`.
  - Search items DO include `isrc` and `preview`. They do NOT include `bpm`, `gain`, `release_date`, `track_position`, `disk_number`, `contributors`, `available_countries`, `share`, `track_token`. `album.release_date` is also absent in search items.
- **Advanced syntax** `q=artist:"The Cure" track:"The Lovecats"` works (returns `total: 4`, filtered to that artist). `album:"..."` works (`artist:"Talking Heads" album:"Talking Heads: 77" track:"Psycho Killer"` → 4 hits, first is the original album version id 6587351). BUT the advanced form is not reliably better than a plain `"<artist> <title>"` query — see coverage table: it returned the wrong version first for Louis Prima (1999 Remaster), Zoot Suit Riot (20th Anniversary re-recording), Booty Swing (only the live version, `total: 1`), Mr. Pinstripe Suit (live first), and a duplicate id for Apple Pie Bed. It did rescue Lone Digger (plain search omitted the original entirely).
- **Typeahead / partial terms work:** `q=loveca` → top hit The Cure "The Lovecats" (total 300); `q=lovec` → same; `q=the cure loveca` → same; `q=zoot su` → "Zoot Suit Riot" first; `q=psycho kil` → "Psycho Killer (2003 Remaster)" first.
- Ordering is by `rank` (popularity) blended with text match, not by originality: compilations and remasters frequently outrank the original album version. Live/acoustic/karaoke covers appear but usually below the studio track.
- Plain search omitted a `readable: true`, available-in-client-country track entirely (Lone Digger 109590416, `total: 2` for `q=Caravan Palace Lone Digger`), so absence from search is not evidence of unavailability.

**`GET /track/{id}`**
- **Full field list (union over 24 responses):** `id, readable, title, title_short, title_version, isrc, link, share, duration, track_position, disk_number, rank, release_date, explicit_lyrics, explicit_content_lyrics, explicit_content_cover, preview, bpm, gain, available_countries, contributors[], md5_image, track_token, artist{...}, album{...}, type`.
- **Extra vs search item (9 fields):** `available_countries` (array of ISO-2, 64–215 entries), `bpm`, `contributors` (array of artist objects each with extra `role: "Main"` and `radio`), `disk_number`, `gain`, `release_date` (`YYYY-MM-DD` string), `share`, `track_position`, `track_token` (opaque ~275–490 char string; not needed). Nothing present in search items is missing from `/track`.
- `/track` also enriches nested objects: `artist` adds `radio, share`; `album` adds `link, release_date`.
- **`title_version` is NOT guaranteed**: absent (key missing, not `""`) in 3/24 responses (ids 14719906, 137903747, 13851424). Every other key was present in all 24. Use `title_version ?? ""`.
- **`bpm` JSON type varies:** float (`91.9`, `135.11`) or int (`123`, `113`, `0`). Zero means unknown; never `null`, never absent in this sample.
- **`gain`** present in 24/24, always a negative number (float or int; observed range −7.9 to −22.6), looks like ReplayGain dB.
- **`release_date` is the date of that edition/album, not the recording:** The Lovecats (1983) → `2001-11-12`; Fever (1958) → `2003-03-03`; Golden Brown (1981) → `1989-09-25`; Psycho Killer (1977) → `2004-08-17`; Zoot Suit Riot (1997) → `2015-02-19`. Worse, `track.release_date` and `album.release_date` disagree in both directions (Zoot Suit Riot track `2015-02-19` vs album `1997-03-18`; Hell track `2016-08-05` vs album `2002-01-01`; Fever track `2003-03-03` vs album `1988-01-01`). Do not use either for the "year" of a song; only current-era singles matched (bad guy 2019, vampire 2023, telepatía 2020, Lone Digger 2015, Mr. Pinstripe 1998, Diamond Life 1984).
- `available_countries` matters: The Cure "The Lovecats" 1143631 lists 188 countries, GB yes, US **no**; the ISRC-lookup twin 1126164 lists only 64 countries (no GB, no US).

**`GET /track/isrc:{ISRC}`**
- Round-trips: `isrc:GBALB8300001` → a Lovecats track, `isrc:USUM71900764` → 655095912 bad guy, `isrc:FR89R1500001` → 109590416 Lone Digger, `isrc:USUG12304091` → 2440763155 vampire, `isrc:USEM39700073` → 2184700 Mr. Pinstripe Suit. Lowercase `isrc:gbalb8300001` works; dashed `GB-ALB-83-00001` → `DataException/800`.
- **Returns one arbitrary Deezer id among duplicates sharing the ISRC, not necessarily the one search returned:** GBALB8300001 → id 1126164 (rank 185696, 64 countries) although search's top hit was 1143631 (rank 759227, 188 countries) with the same ISRC; GBBBM8400006 (Smooth Operator, Diamond Life 1030591232) → id 13132245 on the "Love Affair" compilation, `release_date 1994-02-21`. Response shape is the full `/track` shape.

**`GET /artist/{id}/top?limit=N`**
- `{"data":[...],"total":29,"next":"...index=5"}`; items have the search-item fields **plus `contributors`** but **no `isrc`, no `bpm`**. `preview` present. `limit`/`index` paginate; `artist.tracklist` in every artist object points here with `limit=50`.

**`GET /album/{id}`**
- Fields: `id, title, upc, link, share, cover, cover_small, cover_medium, cover_big, cover_xl, md5_image, genre_id, genres{data:[{id,name,picture,type}]}, label, nb_tracks, duration, fans, release_date, record_type ("album"), available, explicit_lyrics, explicit_content_lyrics, explicit_content_cover, contributors[], artist{...}, tracks{data:[...]}, type, tracklist`.
- `tracks.data` items have the search-item fields but **no `isrc`, no `bpm`**. Album has `upc` (`731458943228`) and `label` (`Polydor Records`).

#### Images
Stable, unsigned, CORS-open URLs built from `md5_image`: `https://cdn-images.dzcdn.net/images/cover/{md5_image}/{W}x{H}-000000-80-0-0.jpg` (sizes seen: 56, 250, 500, 1000). `cover_medium` = 250x250, `cover_xl` = 1000x1000. `https://api.deezer.com/album/{id}/image` → 302 to the 120x120 variant. Safe to cache in SQLite indefinitely.

#### Preview MP3 (`preview` field)
- Host `cdnt-preview.dzcdn.net`, path `/api/1/1/<hash>.mp3`, query `hdnea=exp=<epoch>~acl=<path>*~data=user_id=0,application_id=42~hmac=<64 hex>`.
- **`exp` = response `Date` + exactly 900 s** (measured 900 s on three separate mints; each mint has a different `hmac`; the path/hash is stable per track).
- `Range: bytes=0-1000` → `HTTP 206`, `content-type: audio/mpeg`, `content-range: bytes 0-1000/479827`, `content-length: 1001`, `accept-ranges: bytes`, `server: Google Frontend`, `cache-control: public, max-age=12960000`, `access-control-allow-origin: *`. Same for all three tracks tested; each preview is 479,827 bytes (30 s at 128 kbps), starts with an ID3v2.4 header (`49 44 33 04`). Full HEAD → 200, `content-length: 479827`.
- Tampered `exp` → `HTTP 403 text/html`; signature stripped → `HTTP 403`. **Do not persist preview URLs** past ~14 min; persist the Deezer track id and re-mint via `/track/{id}` (or any search/top/album response, which all mint fresh URLs). The MP3 bytes themselves are `cache-control: public`, so a server-side blob cache (~480 KB/track) is an option if offline previews are wanted.

#### Rate limiting (observed)
- Burst 1: 60 parallel `GET /track/1143631?burst=N` (same resource, cache-busting query) completed in 0.90 s → 60× HTTP 200, all valid track bodies, **no throttle**.
- Burst 2: 70 parallel `GET /search?q=song{N}&limit=1` (distinct queries) in 1.25 s → 70× HTTP 200; 55 valid, **15 bodies `{"error":{"type":"Exception","message":"Quota limit exceeded","code":4}}`**, first failure at request ~37 (sequence `....................................E..E............E..E.EEE.EE.EEEEEE`). No `Retry-After` or `X-RateLimit-*` headers.
- A single search 1 s after the burst was still throttled; the next probe (a few seconds later) succeeded. Consistent with the documented 50 req / 5 s rolling window. Same-resource repeats apparently do not count (cached upstream), distinct requests do.
- Recommendation: server-side token bucket of about 8 req/s (or 45 per 5 s), treat `body.error.code === 4` as retryable with 1–2 s backoff, and never key retry logic on HTTP status.

#### BPM / metadata coverage over the shared sample (from `/track/{id}`)
`P` = top hit of plain `q="<artist> <title>"`; `A` = alternate id (advanced-syntax top hit or the original-album id). Year in parentheses = expected original year.

| # | Track | Deezer id | which | top hit correct? | bpm | gain | release_date | album.release_date | isrc |
|---|---|---|---|---|---|---|---|---|---|
| 1 | The Cure — The Lovecats (1983) | 1143631 | P | yes (Greatest Hits comp, original recording) | 91.9 | −8.8 | 2001-11-12 | 2001-11-12 | GBALB8300001 |
| 1 | same, via /track/isrc: | 1126164 | A | duplicate, 64 countries only | 91.9 | −8.8 | 2001-11-12 | 2001-11-12 | GBALB8300001 |
| 2 | Louis Prima — Jump, Jive an' Wail (1956) | 14719906 | P | yes (The Wildest!, rank only 6860) | 102.1 | −12.1 | 2011-11-15 | 2015-07-01 | NLG620480565 |
| 2 | adv top hit | 3093592 | A | no: "(1999 - Remaster)" | 101.83 | −18.6 | 2004-05-03 | 2004-01-01 | USCA29900213 |
| 3 | Cherry Poppin' Daddies — Zoot Suit Riot (1997) | 69256670 | P | yes (album Zoot Suit Riot; TuneCore reissue ISRC) | 91.9 | −12.6 | 2015-02-19 | 1997-03-18 | TCABP1327651 |
| 3 | adv top hit | 137903747 | A | no: "(20th Anniversary)" re-recording | 91.88 | −10.6 | 2017-01-13 | 2017-01-13 | USLQB1500001 |
| 4 | Caravan Palace — Lone Digger (2015) | 3392254691 | P | **no**: "Lone Digger (Mixed)" 2025 DJ mix; original absent from plain results | **0** | −7.9 | 2025-06-20 | 2025-06-20 | FR89R2500004 |
| 4 | adv top hit (original) | 109590416 | A | yes | 124.2 | −8 | 2015-10-16 | 2015-10-16 | FR89R1500001 |
| 5 | Squirrel Nut Zippers — Hell (1996) | 129634398 | P | yes (Best Of comp; album-filtered search for "Hot" → 0 results) | 100.11 | −10.9 | 2016-08-05 | 2002-01-01 | USMA20215137 |
| 6 | Peggy Lee — Fever (1958) | 3124340 | P | yes (Best Of comp, original recording) | 137.4 | −22.6 | 2003-03-03 | 1988-01-01 | USCA28900304 |
| 7 | Talking Heads — Psycho Killer (1977) | 747527 | P | remaster: "(2003 Remaster)" from Best Of; original album id 6587351 exists (ISRC USWB19900858) | 123 | −12.7 | 2004-08-17 | 2004-08-17 | USWB10302417 |
| 8 | Billie Eilish — bad guy (2019) | 655095912 | P | yes | 135.11 | −8.2 | 2019-03-29 | 2019-03-29 | USUM71900764 |
| 9 | Olivia Rodrigo — vampire (2023) | 2440763155 | P | yes (GUTS) | **0** | −8.4 | 2023-09-08 | 2023-09-08 | USUG12304091 |
| 9 | adv top hit | 2713054981 | A | same recording on GUTS (spilled) | **0** | −8.4 | 2024-03-22 | 2024-03-22 | USUG12304091 |
| 10 | Sade — Smooth Operator (1984) | 10686127 | P | remaster/edit: "(2011 Remastered)" 259 s; Diamond Life original is 2nd | 119.2 | −9.4 | 2011-05-09 | 2011-05-09 | GBARL1100319 |
| 10 | Diamond Life original | 1030591232 | A | yes, 297 s | 119.8 | −10.7 | 1984-07-16 | 1984-07-16 | GBBBM8400006 |
| 11 | Parov Stelar — Booty Swing (2012) | 13851424 | P | yes (on a compilation; original ISRC) | 113 | −10.1 | 2011-10-07 | 2011-10-07 | ATE611000013 |
| 11 | adv top hit (only result) | 3677797302 | A | no: "(Live @ Pukkelpop)" | **0** | −10.4 | 2016-03-11 | 2016-03-11 | ATE611500048 |
| 12 | The Stranglers — Golden Brown (1981) | 3152622 | P | yes (comp, original ISRC) | 187.1 | −14.7 | 1989-09-25 | 1989-09-25 | GBAYE8100053 |
| 13 | Kali Uchis — telepatía (2020) | 1148585682 | P | yes | **0** | −10.5 | 2020-12-04 | 2020-12-04 | GBUM72005748 |
| 14 | Big Bad Voodoo Daddy — Mr. Pinstripe Suit (1998) | 2184700 | P | yes ("(Album Version)", title_version "(Album Version)") | 106.8 | −10.9 | 1998-10-12 | 1998-01-01 | USEM39700073 |
| 14 | same ISRC, Best Of edition (adv 2nd) | 1761439787 | A | same recording | **0** | −11.5 | 2008-07-03 | 2005-01-01 | USEM39700073 |
| 15 | Lawrence Arabia — Apple Pie Bed (2009) | 69002469 | P | yes (Chant Darling) | 126.8 | −10.4 | 2010-01-04 | 2010-01-04 | GBBRP0922203 |
| 15 | adv top hit (NZ duplicate) | 3049462741 | A | same song, different ISRC | **0** | −10.4 | 2009-03-09 | 2010-01-04 | HB0NZ0900003 |

**BPM tally:** plain top hits 12/15 nonzero, 3/15 zero (Lone Digger (Mixed), vampire, telepatía). Choosing the best available id per song: 13/15 nonzero, 2/15 zero (vampire, telepatía). Across all 24 ids the table above lists **7 zeros** (3392254691, 2440763155, 2713054981, 3677797302, 1148585682, 1761439787, 3049462741), i.e. 17/24 nonzero — the probe's own summary line said "6/24 (25%)" while its verified-command note listed 7; **trust the per-row table**. `bpm` key absent: 0/24. `gain`: 24/24 present. `isrc`: 24/24 present. **BPM is attached to the Deezer track id, not the recording**: Mr. Pinstripe Suit is 106.8 on 2184700 and 0 on 1761439787 (identical ISRC); Apple Pie Bed 126.8 vs 0. So when bpm is 0, trying sibling ids (other search hits with the same `isrc`) can fill it.

**Search-quality tally (plain query):** 12/15 top hits are the right studio recording (often via a compilation), 2/15 are a remaster/edit of the right recording (Psycho Killer, Smooth Operator), 1/15 wrong (Lone Digger → DJ-mix version). Advanced `artist:"" track:""` syntax was worse in 5/15 cases and better in 1/15.

#### ISRC agreement with iTunes
iTunes Search returns no `isrc` field at all and `lookup?isrc=` returns `resultCount: 0`, so **iTunes/Deezer ISRC agreement is UNTESTABLE via the public iTunes Search API**. iTunes does give the correct original 1983 release date for The Lovecats where Deezer gives 2001.

#### Recommended usage in It Stings
1. Server route `/api/deezer/search?q=` → `GET https://api.deezer.com/search?q=<plain "artist title" or user text>&limit=10`. Use the plain query for typeahead (partial words work). Do not default to `artist:"" track:""` syntax; offer it only as a second pass when the plain top hit's `title_version` looks like a remix/live/mixed.
2. Pick a hit by filtering `title_version` (absent/empty preferred; demote `(Live...)`, `(Mixed)`, `(Remaster...)`, `(Acoustic...)`, `Karaoke`), then prefer higher `rank`. Keep `isrc` from the search item.
3. Server route `/api/deezer/track/:id` → `GET /track/{id}` for `bpm`, `gain`, `contributors`, `available_countries`. Cache `id, isrc, title, title_short, title_version, duration, rank, bpm, gain, release_date, album.id, album.title, md5_image, artist.id, artist.name` in SQLite indefinitely. Treat `bpm === 0` as unknown and try sibling ids with the same `isrc` before falling back to another BPM source.
4. Never store `preview` beyond 14 min. Store the track id; when the client needs audio, call `/track/{id}` (or return the fresh `preview` from the search response) and hand the signed URL to the browser, which can play/fetch it directly (CDN sends `ACAO: *`, supports Range).
5. Build cover URLs from `md5_image` (`https://cdn-images.dzcdn.net/images/cover/{md5}/250x250-000000-80-0-0.jpg`) and cache them; they are unsigned and CORS-open.
6. Rate limit in the proxy: ≤45 requests per rolling 5 s; parse every body for `error.code`; on `code 4` sleep 1–2 s and retry once. All Deezer failures are HTTP 200.
7. Do not use Deezer `release_date` (track or album) as the song's year; use MusicBrainz `first-release-date` (iTunes `releaseDate` is also unreliable — see 3.1).
8. Use `/track/isrc:{ISRC}` only as a fallback resolver, and check `available_countries`/`rank` on what it returns (it may hand back a low-rank, region-limited duplicate).

---

### 3.3 MusicBrainz WS/2 + AcousticBrainz v1 — observed reality

Both services **work with no key**. Raw JSON bodies and header dumps from the probe are in the scratchpad (`mb_*.json`, `ab_*.json`, `abhdr_*.txt`, `hdr*_*.txt`, `burst_*.txt` under `/private/tmp/claude-501/-Users-aalomrani-Desktop-Side-Chicks-It-Stings/d1c2d915-622a-4a26-95b1-706b30e6c6b0/scratchpad`).

#### MusicBrainz — auth, headers, CORS, rate limiting
- **Auth:** none. **Key:** none.
- **User-Agent is mandatory.** Request with an empty UA (`curl -H "User-Agent:"`) → **HTTP 403**, body `{"error": "Your requests are being throttled by MusicBrainz because the application you are using has not identified itself. Please update your application, and see http://musicbrainz.org/doc/XML_Web_Service/Rate_Limiting for more information."}`, headers `x-ratelimit-who: ua-missing`, `x-mb-rate-limiter: lua`, `server: openresty`. With `-A "ItStings/0.1 (local dev)"` everything works.
- **CORS:** `access-control-allow-origin: *` on every MB response observed (200, 403, 404, 503). Not needed for this app (server-proxied).
- **Two distinct rate-limit header families were observed:**
  1. Gateway/lua limiter (openresty) — only seen on 403/503: `x-mb-rate-limiter: lua`, `x-ratelimit-zone: global`, `x-ratelimit-who: global|ua-missing`, `x-ratelimit-limit: 15`, `x-ratelimit-remaining: 8..14`, `x-ratelimit-reset: <epoch>`, `retry-after: 0`.
  2. Backend (`server: Plack::Handler::Starlet`) on 200/404 lookups: `x-ratelimit-limit: 1200`, `x-ratelimit-remaining: <n>`, `x-ratelimit-reset: <epoch>`. Search responses (Solr path) show `x-ratelimit-limit: 360`. **`x-ratelimit-remaining` is NOT per-client**: consecutive requests from this one IP at 1.1 s spacing returned remaining=567, 724, 0, 415, 882, 110, 508 … (non-monotonic). Do not use these headers for client-side pacing.
- **503 "server busy" at compliant rates.** With 1.1 s sleeps and a valid UA, 12 of ~45 lookups returned **HTTP 503** `{"error": "The MusicBrainz web server is currently busy. Please try again later."}` (`x-ratelimit-zone: global`, `retry-after: 0`). Retrying after 1.1 s succeeded every time (worst case: 3rd attempt, Psycho Killer ISRC). **A retry loop on 503 (3–4 attempts, ≥1 s backoff) is mandatory.**
- **Burst test (done once):** 3 concurrent GETs of `/recording/{mbid}?fmt=json` → all **HTTP 200**, but wall times were 12.8 s, 13.7 s, 5.7 s (queued/delayed, no 503, no `retry-after`). Over-rate from one client is throttled by latency, while the 503s above come from the global limiter under load. Stay at 1 req/s, strictly serial.
- Other headers on 200: `etag`, `x-cache-status: MISS`, `x-mb-gateway: rex`, `content-type: application/json; charset=utf-8`. Typical latency 0.4 s.

#### MusicBrainz — recording search
`GET https://musicbrainz.org/ws/2/recording?query=recording:"The Lovecats" AND artist:"The Cure"&fmt=json&limit=5` → **200** (0.40 s, 12.9 KB)

Top-level: `{ "created": "2026-09-06T10:57:34.794Z", "count": 36, "offset": 0, "recordings": [...] }`

Each `recordings[]` item (union of keys observed): `id`, `score` (int, 100 = best), `title`, `length` (ms, may be null), `video`, `disambiguation` (optional), `first-release-date` (optional — only 2 of 5 Lovecats hits had it), `artist-credit-id`, `artist-credit[]` (`name`, `artist{id,name,sort-name,aliases[]}`), `releases[]` (`id`, `title`, `status` ("Official"/"Bootleg"), `status-id`, `count`, `track-count`, `release-group{id,title,primary-type,secondary-types[]}`, `media[]{position,track[]{id,number,title,length},track-count,track-offset}`).

- **No `isrcs`, no `tags`, no `genres` in search results.** ISRCs and tags come only from a lookup with `inc=`.
- Multiple recordings share score 100 (5 distinct "The Lovecats" recordings, lengths 213000–275893 ms, incl. bootlegs). Search alone cannot pick the canonical one; pair with Deezer/iTunes duration or prefer `releases[].status == "Official"` and earliest `first-release-date`.
- Louis Prima search: `count=27`; Fever: `count=164`; Zoot Suit Riot: `count=17`; Apple Pie Bed: `count=3`.

#### MusicBrainz — ISRC lookup (the AcousticBrainz join key)
`GET https://musicbrainz.org/ws/2/isrc/{ISRC}?fmt=json&inc=artists+releases`

- Hit → **200** `{ "isrc": "GBALB8300001", "recordings": [ { "id": "1c19fbb9-edce-49e1-a934-de6071dd7964", "title": "The Lovecats", "disambiguation": "album original mix", "length": 220000, "video": false, "first-release-date": "1983-11-28", "artist-credit": [ { "name": "The Cure", "joinphrase": "", "artist": { "id": "69ee3720-a7cb-4402-b48d-a02c366f2bcf", "name": "The Cure", "sort-name": "Cure, The", "type": "Group", "type-id": "...", "country": "GB", "disambiguation": "" } } ] } ] }`
- Miss → **404** `{"help":"For usage, please see: https://musicbrainz.org/development/mmd","error":"Not Found"}`
- **`inc=releases` is silently ignored on /isrc** — no `releases` key ever appeared (tested `inc=releases` and `inc=releases+isrcs+artist-credits`). `inc=artists` adds `artist-credit`; `inc=isrcs` adds `isrcs[]` (all ISRCs of that recording, e.g. Lovecats → `["GBALB0000100","GBALB8300001","GBUM72004963"]`). For releases, do a second `/recording/{mbid}?inc=releases` call.
- One ISRC can map to several recordings: bad guy USUM71900764 → 3 (album 694da04d, radio edit f8c8ea7a, 2021 dup 28c07f52); Golden Brown GBAYE8100053 → 2 (1981 c7d0bf6e, 2010 dup 0cda5ff4). Prefer the one whose `length` is closest to the source track and earliest `first-release-date`.

**ISRC → MBID hit rate over the sample: 13/15.** Important methodology note: the ISRCs this probe fed to MusicBrainz came from Deezer's **advanced-syntax** search (`q=artist:"..." track:"..."`) top hit, which the Deezer probe found picks a worse edition in 5/15 cases. So the two 404s (Louis Prima, Apple Pie Bed) and several "non-canonical" hits below are on remaster/live/duplicate ISRCs; the plain-search ISRCs for those tracks (NLG620480565, TCABP1327651, ATE611000013, USEM39700073, GBBRP0922203) were tested in verification: NLG620480565 → **404**, TCABP1327651 → 200 (b944f19c, canonical 1997), ATE611000013 → 200 (123f59a2, studio 2010; AB count 48), USEM39700073 → 200 (05f63c90, studio 1998; AB count 17), GBBRP0922203 → **404**; Lone Digger's plain hit FR89R2500004 → 200 (a1a2e9d7, 2025 "Mixed", AB count 0). Plain-search ISRCs also score 13/15 in MB; ISRC-only AB coverage stays 10/15 (misses: Prima, Lone Digger, Fever, vampire, Apple Pie Bed) but fixes Zoot Suit Riot, Booty Swing, Mr. Pinstripe Suit to canonical recordings [corrected in verification].

| # | Track | Deezer ISRC used | MB status | Recording MBID(s) | Note |
|---|---|---|---|---|---|
| 1 | The Cure - The Lovecats | GBALB8300001 | 200 | 1c19fbb9-edce-49e1-a934-de6071dd7964 | "album original mix", 1983-11-28 |
| 2 | Louis Prima - Jump, Jive an' Wail | USCA29900213 | **404** | — | Deezer's adv pick was the 1999 remaster; canonical 1956 recording is b89ccfb7-deb4-49fb-8647-1c931d8badda (via search) |
| 3 | Cherry Poppin' Daddies - Zoot Suit Riot | USLQB1500001 | 200 | 8002d485-294f-44b7-ba44-ff4094898e3c | Deezer adv pick = "20th anniversary remix" (2017); canonical 1997 recording is b944f19c-0a0c-4278-a613-c72ae8932232 (via search) |
| 4 | Caravan Palace - Lone Digger | FR89R1500001 | 200 | 5f926e49-e0b8-4b45-8172-a1b9076d6b22 | |
| 5 | Squirrel Nut Zippers - Hell | USMA20215137 | 200 | d61f5090-b243-4910-a109-411fcb4a4a0b | |
| 6 | Peggy Lee - Fever | USCA28900304 | 200 | 15e883d4-a77c-4bc8-aa2b-42209946b42e | 1958-06 original |
| 7 | Talking Heads - Psycho Killer | USWB10302417 | 200 (3rd attempt) | e66ea0ae-72e9-4471-a3ab-964b6c25696b | recording has 7 ISRCs |
| 8 | Billie Eilish - bad guy | USUM71900764 | 200 | 694da04d-1ffc-435c-8b4b-59cc23ac8003 (+2) | 3 recordings returned |
| 9 | Olivia Rodrigo - vampire | USUG12304091 | 200 | 0c846a8e-debd-4a63-bb93-6c57f5178b45 | |
| 10 | Sade - Smooth Operator | GBARL1100319 | 200 | 34f59f6d-9fdb-4bed-bdb8-06478011d9be | Deezer = 2011 remaster ISRC; maps to "UK single version" |
| 11 | Parov Stelar - Booty Swing | ATE611500048 | 200 | 676b97c5-72fd-493c-9368-aa8ea8f9a124 | Deezer adv top hit was the LIVE Pukkelpop version; studio 2011 = d259fc63-e2e9-4445-a3b9-8296ac27ffe7 |
| 12 | The Stranglers - Golden Brown | GBAYE8100053 | 200 | c7d0bf6e-b2aa-4ffa-bded-2448415b39b0 (+1) | |
| 13 | Kali Uchis - telepatía | GBUM72005748 | 200 | 2fc3283f-dc40-4c7b-af4b-e60d27d66750 | |
| 14 | Big Bad Voodoo Daddy - Mr. Pinstripe Suit | US3P60477013 | 200 | 79955480-a51f-4e21-b7ac-109859903c0c | Deezer adv top hit was the LIVE 2004 version; studio 1998 = 05f63c90-1953-4120-8676-b00c5216d59d |
| 15 | Lawrence Arabia - Apple Pie Bed | HB0NZ0900003 | **404** | — | search gives 7387e7d5-..., ebdbf232-..., 4b619626-... |

Takeaway: the ISRC join works, but the **quality of the ISRC depends on which Deezer track you pick** (remasters/live/anniversary editions carry different ISRCs and map to different MB recordings). Filter Deezer results by title similarity and reject "(Live)", "Remaster", "Anniversary" variants when the requested year is the original.

#### MusicBrainz — recording lookup by MBID
`GET https://musicbrainz.org/ws/2/recording/{mbid}?fmt=json&inc=isrcs+artist-credits+releases+tags+genres` → **200**

Top-level keys: `artist-credit`, `disambiguation`, `first-release-date`, `genres`, `id`, `isrcs`, `length`, `releases`, `tags`, `title`, `video`.
- `isrcs`: array of strings (Lovecats: 3; Psycho Killer: 7; vampire: 1).
- `tags[]`: `{ "name": "new wave", "count": 9 }` (free-text folksonomy). Lovecats: 17 tags; Psycho Killer: 11; vampire (2023): 3 (`ballad`, `pop`, `pop rock`).
- `genres[]`: `{ "id": "56407f9d-3398-4bf3-bbbd-ea372fa5adeb", "name": "new wave", "count": 9, "disambiguation": "" }` — the subset of tags that are MB-recognised genres. Lovecats: 11; Psycho Killer: 6; vampire: 3. **Populated on all three tested, including the 2023 track.**
- `artist-credit[].artist` also carries its own `tags[]` and `genres[]` (artist-level genre fallback when the recording has none).
- `releases[]`: capped at **25 per lookup** (all three tests returned exactly 25). Keys: `id`, `title`, `status`, `status-id`, `date`, `country`, `barcode`, `packaging`, `packaging-id`, `quality`, `disambiguation`, `text-representation`, `release-events[] { "date": "1983-11-28", "area": { "name": "United Kingdom", "iso-3166-1-codes": ["GB"], "id": "..." } }`, `artist-credit`, `tags`, `genres`.
- Bare `/recording/{mbid}?fmt=json` returns only `id,title,disambiguation,length,video,first-release-date`.

#### AcousticBrainz — status, auth, rate limits, CORS
- **UP** (nginx/1.31.3). Homepage text (fetched): "Between 2015 and 2022, AcousticBrainz helped to crowd source acoustic information from music recordings... In 2022, the decision was made to stop collecting data. For now, the website and its API will continue to be available." → **read-only, frozen dataset, still served.**
- **Auth:** none; no key.
- **Rate limit headers (on every response incl. 400/404):** `x-ratelimit-limit: 100`, `x-ratelimit-remaining`, `x-ratelimit-reset: <epoch>`, `x-ratelimit-reset-in: <seconds, observed 4..10>` → **100 requests per 10-second window.** Never got close to it.
- **CORS:** `access-control-allow-origin: *`, `access-control-allow-methods: HEAD, GET`, `access-control-max-age: 21600`, `access-control-expose-headers: X-RateLimit-Remaining,X-RateLimit-Limit,X-RateLimit-Reset,X-RateLimit-Reset-In`.
- No User-Agent requirement observed (plain curl default UA worked).

#### AcousticBrainz — the `/count` 400 explained
- `GET /api/v1/count` → **400** `{"message":"Missing `recording_ids` parameter"}`. The bare path is the **bulk** count endpoint.
- Correct calls:
  - `GET /api/v1/{mbid}/count` → **200** `{"count":252,"mbid":"1c19fbb9-edce-49e1-a934-de6071dd7964"}`; for an MBID with no data → **200** `{"count":0,"mbid":"..."}` (not 404).
  - `GET /api/v1/count?recording_ids=mbid1;mbid2` → **200** `{"1c19fbb9-...":{"count":252},"e66ea0ae-...":{"count":262},"mbid_mapping":{}}`. **MBIDs with zero submissions are omitted from the object.** `mbid_mapping` was `{}` in every response (it is for MBIDs that were merged/redirected in MB).

#### AcousticBrainz — per-recording endpoints
`GET https://acousticbrainz.org/api/v1/{mbid}/low-level` → **200** (51.7 KB, 0.5 s) or **404** `{"message":"Not found"}`; invalid UUID in the path → **404** (Flask HTML "The requested URL was not found on the server").

Top-level: `lowlevel`, `metadata`, `rhythm`, `tonal`. Exact paths (values are for Lovecats 1c19fbb9, submission 0):
- `rhythm.bpm` = 91.6769332886 (float)
- `rhythm.danceability` = 1.21954584122 (Essentia scalar, roughly 0–3, higher = more danceable; sample range 1.04–1.45)
- `rhythm.beats_count` = 334, `rhythm.onset_rate` = 4.078, `rhythm.bpm_histogram_first_peak_bpm`, `rhythm.bpm_histogram_second_peak_bpm`, `rhythm.beats_position[]`, `rhythm.beats_loudness{}`
- `tonal.key_key` = "F", `tonal.key_scale` = "major", `tonal.key_strength` = 0.504, `tonal.chords_key` = "F", `tonal.chords_scale` = "major", `tonal.chords_changes_rate`, `tonal.tuning_frequency` = 434.19, `tonal.hpcp{}`, `tonal.thpcp[]`
- `lowlevel.average_loudness` = 0.873, `lowlevel.dynamic_complexity` = 3.43, `lowlevel.dissonance{}`, `lowlevel.spectral_centroid{}`, `lowlevel.spectral_energy*`, `lowlevel.mfcc{}`, `lowlevel.gfcc{}`, `lowlevel.barkbands*`, `lowlevel.melbands*`, `lowlevel.erbbands*`, `lowlevel.zerocrossingrate{}`, `lowlevel.silence_rate_*dB{}`, `lowlevel.pitch_salience{}` (most are `{mean,var,min,max,dmean,dvar,...}` stat objects)
- `metadata.audio_properties` = `{ "length": 219.7159, "bit_rate": 192000, "codec": "mp3", "sample_rate": 44100, "analysis_sample_rate": 44100, "lossless": false, "replay_gain": -4.4887, "md5_encoded": "...", "downmix": "mix", "equal_loudness": 0 }`
- `metadata.tags` = arrays of strings: `title`, `artist`, `album`, `albumartist`, `date`, `genre`, `label`, `tracknumber`, `musicbrainz_recordingid`, `musicbrainz_albumid`, `musicbrainz_artistid`, `musicbrainz_albumartistid`, `barcode`, `catalognumber`, `file_name`, ... (from the submitter's file tags; e.g. `date: ["1986"]` for a 1983 song — do not use as release year)
- `metadata.version` = `{ "essentia": "2.1-beta1", "extractor": "music 1.0", ... }`

`GET https://acousticbrainz.org/api/v1/{mbid}/high-level` → **200** (9 KB) or **404** `{"message":"Not found"}`

Top-level: `highlevel`, `metadata`. `highlevel` keys (18 classifiers): `danceability`, `gender`, `genre_dortmund`, `genre_electronic`, `genre_rosamerica`, `genre_tzanetakis`, `ismir04_rhythm`, `mood_acoustic`, `mood_aggressive`, `mood_electronic`, `mood_happy`, `mood_party`, `mood_relaxed`, `mood_sad`, `moods_mirex`, `timbre`, `tonal_atonal`, `voice_instrumental`. Each is `{ "value": "<class>", "probability": <float>, "all": { "<class>": <prob>, ... }, "version": {...} }`. Observed classes:
- `highlevel.danceability.value` in {`danceable`,`not_danceable`}
- `highlevel.mood_happy.value` {`happy`,`not_happy`}; `mood_sad` {`sad`,`not_sad`}; `mood_relaxed` {`relaxed`,`not_relaxed`}; `mood_party` {`party`,`not_party`}; `mood_aggressive`; `mood_acoustic`; `mood_electronic`
- `highlevel.genre_dortmund.value` in {alternative, blues, electronic, folkcountry, funksoulrnb, jazz, pop, raphiphop, rock}
- `highlevel.genre_rosamerica.value` in {cla, dan, hip, jaz, pop, rhy, roc, spe}
- `highlevel.genre_tzanetakis.value` in {blu, cla, cou, dis, hip, jaz, met, pop, reg, roc}
- `highlevel.genre_electronic.value` in {ambient, dnb, house, techno, trance}
- `highlevel.moods_mirex.value` in {Cluster1..Cluster5}; `ismir04_rhythm.value` in {ChaChaCha, Jive, Quickstep, Rumba-*, Samba, Tango, VienneseWaltz, Waltz}; `timbre` {bright,dark}; `tonal_atonal` {tonal,atonal}; `voice_instrumental` {voice,instrumental}; `gender` {male,female}
- `?map_classes=true` rewrites abbreviations to labels: `rhy` → "Rhythm and Blues", `jaz` → "Jazz", `Cluster5` → "aggressive, fiery, tense/anxious, intense, volatile, visceral", `not_happy` → "Not happy". Works on individual and bulk.
- `metadata` on high-level = `{ audio_properties, tags, version{highlevel{...}, lowlevel{...}} }`.

**Multiple submissions / `?n=`**: `n` is a 0-based submission offset. Lovecats has `count: 252`: `n=0,1,99,251` → 200 (different data each: bpm 91.677 / 91.753 / 91.678 / 91.732), `n=252` and `n=100000` → **404** `{"message":"Not found"}`, `n=-1` and `n=abc` silently behave as `n=0`. Different submissions of the same recording disagree on classifier output (Lovecats `mood_happy` = `not_happy` at n=0 but `happy` at n=1). Use n=0 for a single value, or fetch a few offsets and vote.

#### AcousticBrainz — bulk endpoints
- `GET /api/v1/low-level?recording_ids=mbid1;mbid2;...` and `GET /api/v1/high-level?recording_ids=...` (semicolon-separated).
- **Limit: 25 MBIDs.** 32 ids → **400** `{"message":"More than 25 recordings not allowed per request"}` (same on `/count`). Bad id in the list → **400** `{"message":"'not-a-uuid' is not a valid UUID"}`. Missing param → **400** `{"message":"Missing `recording_ids` parameter"}`.
- Response shape: `{ "<mbid>": { "0": { lowlevel, metadata, rhythm, tonal } }, "<mbid2>": { "0": {...} }, "mbid_mapping": {} }` (high-level: `{ "0": { highlevel, metadata } }`). **MBIDs with no data are simply absent** (request of 25 ids returned 11 keys, HTTP 200).
- Per-id offset: `recording_ids=mbid:0;mbid:1;mbid:2` → `{ "<mbid>": { "0": {...}, "1": {...}, "2": {...} } }` (observed bpm 91.677/91.753/91.741).
- `features=` filter on bulk low-level: `&features=rhythm.bpm;tonal.key_key;tonal.key_scale;rhythm.danceability;lowlevel.average_loudness` → only those leaves plus `metadata.audio_properties` and `metadata.version` are returned; **`metadata.tags` is dropped when `features` is used** (requesting `metadata.tags.title` returned nothing). 25-id unfiltered low-level response was 541 KB / 1.3 s; use `features=` in production.
- `map_classes=true` also works on bulk high-level.

#### AcousticBrainz coverage over the sample set
Via `count?recording_ids=` and bulk low-level/high-level over 32 candidate MBIDs (13 ISRC-resolved + MB search variants), then wider searches (Fever 25 MBIDs, Zoot Suit Riot 17, Louis Prima 25).

| # | Track | AB data? | MBID used | submissions | rhythm.bpm | key | rhythm.danceability | hl.danceability | hl.mood_happy | genre_dortmund / genre_rosamerica |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | The Cure - The Lovecats (1983) | YES (ISRC) | 1c19fbb9-... | 252 | 91.7 | F major | 1.22 | not_danceable | not_happy | electronic / rhy |
| 2 | Louis Prima - Jump, Jive an' Wail (1956) | YES (search fallback only) | b89ccfb7-deb4-49fb-8647-1c931d8badda | 35 | 101.5 | A# major | — | — | — | — |
| 3 | Cherry Poppin' Daddies - Zoot Suit Riot (1997) | YES (adv-syntax ISRC MBID 8002d485 = remix has 0; the plain-search ISRC TCABP1327651 resolves directly to b944f19c [corrected in verification]) | b944f19c-0a0c-4278-a613-c72ae8932232 | 63 | 91.9 | G# minor | — | — | — | — |
| 4 | Caravan Palace - Lone Digger (2015) | YES (ISRC) | 5f926e49-... | 114 | 123.7 | F minor | 1.16 | danceable | not_happy | electronic / rhy |
| 5 | Squirrel Nut Zippers - Hell (1996) | YES (ISRC) | d61f5090-... | 45 | 102.0 | A# major | 1.13 | not_danceable | not_happy | electronic / pop |
| 6 | Peggy Lee - Fever (1958) | PARTIAL: 1958 original (ISRC MBID 15e883d4) has 0; only a 1987 re-recording a38234ef (2 subs, 136 bpm A minor) and a 1977 live 5d4c0e31 (1 sub) | a38234ef-... | 2 | 136.2 | A minor | — | — | — | — |
| 7 | Talking Heads - Psycho Killer (1977) | YES (ISRC) | e66ea0ae-... | 262 | 123.5 | F minor | 1.45 | not_danceable | not_happy | electronic / hip |
| 8 | Billie Eilish - bad guy (2019) | YES (ISRC) | 694da04d-... | 242 | 135.1 | C major | 1.06 | danceable | not_happy | electronic / rhy |
| 9 | Olivia Rodrigo - vampire (2023) | **NO** (count 0; low/high-level 404) | 0c846a8e-... | 0 | — | — | — | — | — | — |
| 10 | Sade - Smooth Operator (1984) | YES (ISRC) | 34f59f6d-... | 97 | 119.2 | F minor | 1.31 | not_danceable | not_happy | electronic / hip |
| 11 | Parov Stelar - Booty Swing (2012) | YES — the adv-syntax ISRC pointed at the LIVE recording (676b97c5, 2 subs) and studio MBIDs d259fc63/96bc94dd/abd85361 have 0, BUT the plain-search ISRC ATE611000013 resolves in MB to studio recording **123f59a2-69cf-4407-99e7-ce200a8e9ce8** (2010-11-19, 197506 ms; not in the top-5 of MB search) which has **48** AB submissions [corrected in verification] | 676b97c5-... | 2 | 113.1 | D minor | 1.40 | not_danceable | not_happy | electronic / pop |
| 12 | The Stranglers - Golden Brown (1981) | YES (ISRC) | c7d0bf6e-... | 123 | 184.6 | F# major | 1.38 | danceable | happy | electronic / dan |
| 13 | Kali Uchis - telepatía (2020) | YES (ISRC) | 2fc3283f-... | 8 | 84.0 | B minor | 1.21 | danceable | not_happy | electronic / rhy |
| 14 | Big Bad Voodoo Daddy - Mr. Pinstripe Suit (1998) | YES (adv-syntax ISRC → live 2004: 5 subs, 104.6 bpm B minor; the plain-search ISRC USEM39700073 resolves directly to studio 1998 05f63c90: 17 subs [corrected in verification]) | 05f63c90-... | 17 | 107.6 | A# minor | 1.25 | not_danceable | not_happy | electronic / pop |
| 15 | Lawrence Arabia - Apple Pie Bed (2009) | YES (search fallback only; ISRC 404 in MB) | ebdbf232-420f-4f9e-98b6-ba16ddeb9cf9 | 4 | 126.9 | D# major | 1.20 | danceable | not_happy | electronic / rhy |

- **ISRC-only path: 10/15 tracks** with AB data (11/13 of the resolved MBIDs counting Fever's 0). **With MB-search fallback across all candidate recordings: 14/15.** Only vampire (2023) is missing — consistent with the 2022 freeze. telepatía (Nov 2020) has 8 submissions, bad guy (2019) 242, Lone Digger (2015) 114; older classics 45–262.
- Submission counts are a strong popularity proxy; obscure tracks have 1–8.
- **`genre_dortmund` returned `electronic` for all 11 high-level hits** on this sample (incl. Talking Heads, Sade, Squirrel Nut Zippers) — useless here. `genre_rosamerica` varied (rhy/pop/hip/dan/roc) but is also noisy (Sade → hip). `mood_happy` was `not_happy` for 9 of 11. `highlevel.danceability` disagrees with `rhythm.danceability` ordering (Psycho Killer has the highest rhythm.danceability 1.45 yet hl = not_danceable). Treat high-level classifier output as weak signal; `rhythm.bpm`, `tonal.key_*`, `lowlevel.average_loudness`, `lowlevel.dynamic_complexity` are the reliable fields.

#### Recommended usage in It Stings
1. Resolve track → ISRC from Deezer (`/search` then `/track/{id}.isrc`), filtering out Live/Remaster/Anniversary variants when they do not match the requested year.
2. `GET musicbrainz.org/ws/2/isrc/{isrc}?fmt=json&inc=isrcs+artist-credits` (UA `ItStings/0.1 (local dev)`, 1 req/s, retry 503 up to 4× with ≥1.1 s backoff). Choose the recording whose `length` best matches; if 404, fall back to `GET /recording?query=recording:"{title}" AND artist:"{artist}"&fmt=json&limit=25` and take Official-release candidates.
3. Cache the MBID in SQLite forever (MBIDs are stable; keep alternates).
4. `GET musicbrainz.org/ws/2/recording/{mbid}?fmt=json&inc=tags+genres+isrcs` for genres/tags (cache; refresh rarely). Note `releases` is capped at 25.
5. AcousticBrainz in batches of ≤25 MBIDs (include alternates): `GET acousticbrainz.org/api/v1/count?recording_ids=...` to find which MBIDs have data, then `GET /api/v1/low-level?recording_ids=...&features=rhythm.bpm;rhythm.danceability;tonal.key_key;tonal.key_scale;tonal.key_strength;lowlevel.average_loudness;lowlevel.dynamic_complexity` and `GET /api/v1/high-level?recording_ids=...&map_classes=true`. Read offset `"0"`. 100 req/10 s is generous; cache permanently (dataset is frozen — it will never change).
6. Expect no AB data for anything released after ~2021; the app needs a fallback (Deezer `bpm` exists but is often 0 — vampire and telepatía returned `bpm: 0` on every Deezer id tried) or a local analyser for new releases.

---

### 3.4 Last.fm API — reality check (probed ~10:57–11:05 UTC)

**Base URL:** `https://ws.audioscrobbler.com/2.0/` (docs still print `http://`; plain http is served without redirect — use https).
**Auth:** every read method requires `api_key` (a 32-hex key issued at `/api/account/create`). No user session needed for the methods we use ("This service does not require authentication").
**Status:** endpoint alive (HTTP/2, JSON, CORS `*`); **we have no key, so all success shapes below are from the official docs, not observed.** Error handling *was* observed.

#### Verified error behaviour (real requests)
| Situation | HTTP | Body (`format=json`) |
|---|---|---|
| no `api_key`, or `api_key=` empty (any method, even unknown) | 400 | `{"message":"Invalid parameters - Your request is missing a required parameter","error":6}` |
| `api_key=INVALID` / `api_key=000…0` (known method) | 403 | `{"message":"Invalid API key - You must be granted a valid key by last.fm","error":10}` |
| key present (any value) + unknown method | 400 | `{"message":"Invalid Method - No method with that name in this package","error":3}` |
| no `format=json` | same codes | XML `<lfm status="failed"><error code="10">…</error></lfm>` |

Observed identically for `track.getSimilar`, `track.getTopTags`, `tag.getTopTracks`, `track.getInfo`, `artist.getSimilar`, `track.search`. POST form body works for reads. `callback=cb` wraps even errors. `error` is a JSON **number**; `message` a string.

**Consequence:** "key missing" and "track not found" share code **6**. The app must (a) never call upstream without a key and (b) validate `artist`/`track` locally, so that any upstream 6 with a key present means *not found*. (The "Track not found" message text itself is UNTESTED.)

Full documented error list (from `/api/errorcodes`): 2 invalid service, 3 invalid method, 4 auth failed, 5 invalid format, **6 invalid parameters**, 7 invalid resource, 8 operation failed ("Most likely the backend service failed. Please try again."), 9 invalid session key, **10 invalid API key**, 11 service offline, 13 invalid method signature, 16 temporarily unavailable, **26 API key suspended**, 27 deprecated, **29 rate limit exceeded** ("Your IP has made too many requests in a short period, exceeding our API guidelines").

#### Response headers observed
`server: openresty`, `content-type: application/json`, `access-control-allow-origin: *`, `access-control-allow-methods: POST, GET, OPTIONS`, `access-control-max-age: 86400`, `via: 1.1 google`. **No** `X-RateLimit-*`, `Retry-After`, `Cache-Control`, or `Expires` on error responses (success responses UNTESTED).

#### Methods (parameters quoted from the official pages, fetched 2026-09-06)

**track.getSimilar** — "Get the similar tracks for this track on Last.fm, based on listening data."
- `track` (Required unless mbid), `artist` (Required unless mbid), `mbid` (Optional), `autocorrect[0|1]` (Optional: "Transform misspelled artist and track names into correct artist and track names, returning the correct version instead. The corrected artist and track name will be returned in the response."), `limit` (Optional: "Maximum number of similar tracks to return" — no default stated), `api_key`.
- Doc XML: `<similartracks track="Believe" artist="Cher"><track><name/><mbid/><match>10.95</match><url/><streamable fulltrack="0">1</streamable><artist><name/><mbid/><url/></artist><image size="small|medium|large"/></track>…`. Expected JSON (by the REST translation rules): `similartracks.track[]` with `.name`, `.mbid`, `.match` (string), `.url`, `.artist.name`, `.artist.mbid`, `.artist.url`, `.image[]{#text,size}`. `playcount` is **not** in the doc sample (UNTESTED). Match range for tracks is not defined in this doc (artist.getSimilar says 0–1) — UNTESTED.

**track.getTopTags** — "Get the top tags for this track on Last.fm, ordered by tag count. Supply either track & artist name or mbid."
- `track`, `artist` (Required unless mbid), `mbid`, `autocorrect[0|1]`, `api_key`.
- Doc XML: `<toptags artist="Cher" track="Believe"><tag><name>pop</name><count>97</count><url>www.last.fm/tag/pop</url></tag>…`. JSON: `toptags.tag[]` `.name`, `.count` (string; top tag ≈100, relative), `.url`.

**tag.getTopTracks** — "Get the top tracks tagged by this tag, ordered by tag count."
- `tag` (Required), `limit` (Optional, "Defaults to 50"), `page` (Optional, "Defaults to first page"), `api_key`.
- Doc XML: `<toptracks tag="Disco"><track rank=""><name/><mbid/><url/><streamable/><artist><name/><mbid/><url/></artist><image…/></track>…`. JSON: `tracks.track[]` (container key in JSON is UNTESTED; XML root is `toptracks`) with `.name`, `.mbid`, `.url`, `.artist.name`, `.artist.mbid`, and the `rank` attribute — per REST doc "Attributes are expressed as string member values with the attribute name as key"; the `@attr.rank` nesting is not shown in the docs and must be confirmed with a key.

**track.getInfo** — "Get the metadata for a track on Last.fm using the artist/track name or a musicbrainz id."
- `mbid`, `track`, `artist` (Required unless mbid), `username` (Optional: "If supplied, the user's playcount for this track and whether they have loved the track is included"), `autocorrect[0|1]`, `api_key`.
- Doc XML: `<track><id/><name/><mbid/><url/><duration>240000</duration><streamable fulltrack="1">1</streamable><listeners/><playcount/><artist><name/><mbid/><url/></artist><album position="1"><artist/><title/><mbid/><url/><image size…/></album><toptags><tag><name/><url/></tag></toptags><wiki><published/><summary/><content/></wiki></track>`. "duration : In milliseconds".

**track.search** — "Search for a track by track name. Returns track matches sorted by relevance."
- `track` (Required), `artist` (Optional: "Narrow your search by specifying an artist."), `limit` (Optional, "Defaults to 30"), `page`, `api_key`.
- Doc XML: `<results for="Believe"><opensearch:totalResults/><opensearch:startIndex/><opensearch:itemsPerPage/><trackmatches><track><name/><artist>Disturbed</artist><url/><streamable/><listeners/><image/></track></trackmatches></results>` — note `artist` is a **plain string** here.

**artist.getSimilar** — `artist` (Required unless mbid), `mbid`, `limit`, `autocorrect[0|1]`, `api_key`. Doc XML `<similarartists artist="Cher"><artist><name/><mbid/><match>1</match><url/><image size="small|medium|large|extralarge|mega"/><streamable/></artist>…`; "match : A similarity value between 0 (not similar) and 1 (very similar)".

#### JSON conventions (quoted from `/api/rest`)
"Attributes are expressed as string member values with the attribute name as key. Element child nodes are expressed as object members values with the node name as key. Text child nodes are expressed as string values, unless the element also contains attributes, in which case the text node is expressed as a string member value with the key #text. Repeated child nodes will be grouped as an array member with the shared node name as key." Example shows `"count": "55483"` — **numbers arrive as strings**. Errors: `{"error": 10, "message": "Invalid API Key"}`. Single-item arrays may collapse to an object (rule 4 only groups *repeated* nodes) — guard with `Array.isArray`.

#### Autocorrect gotcha (verified on the public site)
`https://www.last.fm/music/The+Cure/_/The+Lovecats` and `https://www.last.fm/music/The+Cure/_/The+Love+Cats` are two separate entries with separate canonical URLs and separate stats (recon parse: 943,363 listeners / 6,481,777 scrobbles vs 116,006 / 624,195). Louis Prima's page 301s from `Jump,+Jive+an'+Wail` to `Jump,+Jive+An'+Wail`. Always send `autocorrect=1`, and persist the corrected `artist`/`track` names the response echoes (container attributes `<similartracks track="…" artist="…">`) so the cache is keyed on Last.fm's canonical spelling as well as the raw query.

#### Coverage over the sample set
API coverage: **UNTESTED (needs key)** for all 15. Proxy signal — public catalogue page HEAD (not parsed), nonsense control returns 404:

| # | Track | Public page |
|---|---|---|
| 1 | The Cure — The Lovecats | 200 (plus separate "The Love Cats" entry) |
| 2 | Louis Prima — Jump, Jive an' Wail | 301 → `Jump,+Jive+An'+Wail` |
| 3 | Cherry Poppin' Daddies — Zoot Suit Riot | 200 |
| 4 | Caravan Palace — Lone Digger | 200 |
| 5 | Squirrel Nut Zippers — Hell | 200 |
| 6 | Peggy Lee — Fever | 200 |
| 7 | Talking Heads — Psycho Killer | 200 |
| 8 | Billie Eilish — bad guy | 200 |
| 9 | Olivia Rodrigo — vampire | 200 |
| 10 | Sade — Smooth Operator | 200 |
| 11 | Parov Stelar — Booty Swing | 200 |
| 12 | The Stranglers — Golden Brown | 200 |
| 13 | Kali Uchis — telepatía | 200 (`telepat%C3%ADa`) |
| 14 | Big Bad Voodoo Daddy — Mr. Pinstripe Suit | 200 |
| 15 | Lawrence Arabia — Apple Pie Bed | 200 |
| ctl | Zzxqv Nonexistent Artist — Qwertyuiop… | 404 |

#### Public (non-API) pages as fallback
`GET /music/The+Cure/_/The+Lovecats/+similar` → **302** to `/music/The+Cure/_/The+Lovecats` (200, ~470 KB HTML). Pages exist, but **do not scrape**: ToS 2.6 — "You must not gather any other data from Last.fm in any other way." Not used in the app.

#### Rate limits, caching, attribution — what the 2026 ToS actually says
- **4.4 Rate Limit:** "Last.fm sets and enforces limits on use of the API to prevent abuse and ensure reliability of service (e.g. limiting the number of API requests that you may make or the number of users you may serve), in our sole discretion. You agree to, and will not attempt to circumvent, such limitations." → **no numeric limit**; the historical "5 requests per second averaged over 5 minutes" sentence is gone from both `/api/tos` and `/api/intro`.
- **Intro:** "Your account may be suspended if your application is continuously making several calls per second or if you're making excessive calls." / "try not to hit the API on page load." / "Please use an identifiable User-Agent header on all requests."
- **4.3.4 Caching / storage:** "the licence granted to You is temporary and restricted to a small portion of Last.fm Data available via the API, not to exceed the Reasonable Usage Cap in total at any time … The 'Reasonable Usage Cap' is a maximum of 100 MB … You will implement suitable caching in accordance with the HTTP headers sent with web service responses."
- **2.7 Attribution:** "You agree to use one of the buttons saying 'powered by AudioScrobbler' from the page located at http://www.last.fm/resources, such button linking back to Last.fm. … All links to Last.fm from pages displaying information on an artist, album or track should link to the appropriate catalogue page on Last.fm. For example: http://www.last.fm/music/<artistname>/_/<trackname>." Reinforced by 4.2.2 ("Crediting Last.fm in the form set out in Clause 2.7").
- **3.1 Non-commercial:** "You are permitted to use the Last.fm Data solely for non-commercial purposes."
- **4.3.3:** "You must not sub-license the Last.fm Data to a third party." **9.3:** on termination "delete all Last.fm Data in Your possession or control."
- **2.2:** "You must be a registered User to have access to, retrieve and use the Last.fm Data."

#### Signup
`https://www.last.fm/api/account/create` → 302 `/login?next=/api/account/create` (live; needs a Last.fm user — `/join` is 200). Existing keys: `/api/accounts` (login-gated). No approval wait is documented; the key is issued on form submit (UNTESTED here).

#### Recommended server-route design for It Stings
Env: `LASTFM_API_KEY` (optional). Shared helper `lastfm(method, params)`:
1. If `!LASTFM_API_KEY` → return `{ ok:false, reason:"key_missing" }` immediately (HTTP 200 to the UI, never call upstream — upstream would answer code 6, which is ambiguous).
2. Validate required params locally (non-empty `artist`+`track`, or `tag`) so upstream code 6 can be mapped to `not_found`.
3. GET `https://ws.audioscrobbler.com/2.0/?method=…&format=json&autocorrect=1&api_key=…` with header `User-Agent: ItStings/0.1 (local dev)`; 10 s timeout; process-wide token bucket ≤ 4 req/s, concurrency 2 (ToS gives no number; intro warns about "several calls per second").
4. Map upstream: `error 10|26` or HTTP 403 → `key_invalid` and flip an in-memory circuit breaker so no further Last.fm calls happen until restart; `error 6` (key present, params validated) → `not_found`, negative-cache 7 days; `error 29` → `rate_limited`, exponential backoff from 2 s, serve stale cache; `error 8|11|16` or 5xx → retry once after 1 s then stale-or-`upstream_error`; `error 3|5` → programming bug, log loudly.
5. Parse defensively: coerce `match`, `count`, `rank`, `playcount`, `listeners`, `duration` with `Number()`; wrap single objects into arrays; read corrected names from the container attributes (verify the `@attr` nesting once a key exists).

Routes (all GET, SQLite cache keyed on `method|lower(artist)|lower(track)|limit`):
- `/api/lastfm/similar?artist&track&limit=50` → `track.getSimilar` — cache **30 days**; return `[{name, artist, match, mbid, url}]`.
- `/api/lastfm/tags?artist&track` → `track.getTopTags` — cache **30 days**; return `[{name, count}]`, drop tags with count < 10.
- `/api/lastfm/tag-tracks?tag&limit=50&page=1` → `tag.getTopTracks` — cache **14–30 days** (charts drift slowly); return `[{rank, name, artist, mbid, url}]`.
- `/api/lastfm/track?artist&track` → `track.getInfo` — cache **7 days** (listeners/playcount drift; use it for canonical name, mbid, album/art, wiki summary).
- `/api/lastfm/similar-artists?artist&limit=30` → `artist.getSimilar` — cache **30 days**.
- `track.search` only as a disambiguation fallback when getInfo returns 6; cache 7 days.
- `/api/lastfm/status` → `{ configured: boolean, degraded: reason|null }` so the UI can hide Last.fm-powered panels (and show a "add LASTFM_API_KEY to .env" hint) instead of erroring.

Compliance in-app: show "Powered by AudioScrobbler / Last.fm" with links using the API-returned `url` (ToS 2.7); keep the Last.fm tables in SQLite under a size guard (ToS 4.3.4 100 MB) with an eviction job; never expose cached Last.fm rows through any public endpoint (4.3.3); never scrape www.last.fm HTML (2.6); personal, non-commercial use only (3.1).

---

### 3.5 Spotify — API reality (no credentials)

#### TL;DR
- **Everything on `https://api.spotify.com/v1/*` needs a Bearer token.** No key in this environment, so all catalog/search/playlist calls are **UNTESTED (needs key)**; the error shapes below are what you get without one.
- **Keyless pieces that DO work:** `open.spotify.com/oembed` (JSON, CORS `*`), `open.spotify.com/embed/track/{id}` (iframe HTML), `open.spotify.com/track/{id}` (server-rendered `og:` meta), `open.spotify.com/search/{query}` (200, valid deep link).
- **Deprecation state (all quoted from live pages):** audio-features / audio-analysis / recommendations / related-artists / featured playlists / category playlists / `preview_url` / `popularity` / batch `GET /tracks` all marked **Deprecated** in the reference; playlist write endpoints renamed `/tracks` → `/items` (Feb 2026); `POST /users/{user_id}/playlists` → `POST /me/playlists`.
- **Development Mode today (docs):** owner must have **Premium**; **5 authorized users** per app (not 25; 25 is the Client-IDs-per-developer cap since July 2026); search `limit` max **10**, default **5**; redirect URI must be `http://127.0.0.1:PORT/...` — `localhost` is rejected.

#### Deprecations — evidence

**Blog, 2024-11-27** — `https://developer.spotify.com/blog/2024-11-27-changes-to-the-web-api` (HTTP 200). Verbatim:
> Effective today, **new** Web API use cases will no longer be able to access or use the following endpoints and functionality in their third-party applications. Applications with existing extended mode Web API access that were relying on these endpoints remain unaffected by this change.
> - Related Artists
> - Recommendations
> - Audio Features
> - Audio Analysis
> - Get Featured Playlists
> - Get Category's Playlists
> - 30-second preview URLs, in multi-get responses (SimpleTrack object)
> - Algorithmic and Spotify-owned editorial playlists
>
> These changes will impact the following Web API applications:
> - Existing apps that are still in development mode without a pending extension request
> - New apps that are registered on or after today's date

**Blog, 2026-02-06** — `https://developer.spotify.com/blog/2026-02-06-update-on-developer-access-and-platform-security` (HTTP 200):
> Starting **Wednesday, 11 February**, all newly created Development Mode Client IDs will be created under the updated Development Mode rules and will have the following restrictions applied by default:
> - Development Mode use will require a Spotify Premium account
> - Developers will be limited to one Development Mode Client ID
> - Each Client ID will be limited to up to five authorized users
> - API access will be limited to a smaller set of supported endpoints
>
> From **March 9**, these same requirements will also apply to **all existing Development Mode integrations**.
> [...]
> **Update — March 9: Postponed endpoint access changes for existing integrations.** After some review and feedback from the community, we have decided to postpone endpoint access changes for existing integrations. The Spotify Premium requirement, the authorized user cap and one Client ID per developer limit will take effect as planned for existing Development Mode integrations.

Note: `https://developer.spotify.com/blog`, `/blog/`, `/community/news`, `/news` all return **404** — there is no fetchable blog index; posts are reachable only by direct URL.

**Reference page badges** (HTTP 200 each). Each page renders, directly after the "OAuth 2.0" auth badge, a tag `<span class="e-10202-tag encore-negative-subdued-set ..." data-encore-id="tag"><span ...>Deprecated</span></span>`:
| Reference page | Path on page | Badge / notice observed |
|---|---|---|
| `/reference/get-audio-features` | `GET /audio-features/{id}` | **Deprecated** badge (no prose notice; response schema still documented: `acousticness, analysis_url, danceability, duration_ms, energy, id, instrumentalness, key, ...`) |
| `/reference/get-several-audio-features` | — | **Deprecated** |
| `/reference/get-audio-analysis` | `GET /audio-analysis/{id}` | **Deprecated** |
| `/reference/get-recommendations` | `GET /recommendations` | **Deprecated** |
| `/reference/get-an-artists-related-artists` | — | **Deprecated** |
| `/reference/get-featured-playlists` | — | **Deprecated** |
| `/reference/get-a-categories-playlists` | `GET /browse/categories/{category_id}/playlists` | **Deprecated** |
| `/reference/get-several-tracks` | `GET /tracks` (batch) | **Deprecated** |
| `/reference/get-artists-top-tracks` | — | **HTTP 404** (page gone) |
| `/reference/add-tracks-to-playlist` | `POST /playlists/{playlist_id}/tracks` | **Deprecated** + "Deprecated: Use Add Items to Playlist instead." |
| `/reference/create-playlist-for-user` | `POST /users/{user_id}/playlists` | **Deprecated** + "Deprecated: Use Create Playlist instead." |
| `/reference/get-track` | `GET /tracks/{id}` | no endpoint badge; field `preview_url` = "string, Nullable, **Deprecated** — A link to a 30 second preview (MP3 format) of the track. Can be null" with policy note "Audio Preview Clips may not be offered as a standalone service or product." |
| `/reference/search` | `GET /search` | no endpoint badge; track/artist `popularity` fields and album `available_markets` marked **Deprecated** |

The left nav on every reference page literally lists: "Get Playlist Items [DEPRECATED], Update Playlist Items [DEPRECATED], Add Items to Playlist [DEPRECATED], Remove Playlist Items [DEPRECATED]" next to the new un-suffixed versions. Also visible in the nav: "Implicit grant [Deprecated]", "Migration: Insecure redirect URI", "Migration: February 2026 Dev Mode Changes", Changelog entries "July 2026, May 2026, March 2026, February 2026".

**Changelog Feb 2026** — `/documentation/web-api/references/changes/february-2026` (HTTP 200). Endpoint changes (quoted labels):
- `[REMOVED] Create Playlist for user (POST /users/{user_id}/playlists)` → "Use POST /me/playlists instead"
- `[REMOVED] Get Artist's Top Tracks (GET /artists/{id}/top-tracks)`
- `[REMOVED] Get Available Markets (GET /markets)`
- `[REMOVED] Get New Releases (GET /browse/new-releases)`, `Get Several Browse Categories (GET /browse/categories)`, `Get Single Browse Category (GET /browse/categories/{id})`
- `[REMOVED] Get Several Tracks (GET /tracks)`, `Get Several Albums (GET /albums)`, `Get Several Artists (GET /artists)`, `Get Several Episodes/Shows/Audiobooks/Chapters`
- `[REMOVED] Get User's Playlists (GET /users/{id}/playlists)`, `Get User's Profile (GET /users/{id})`
- `[REMOVED]` all `PUT/DELETE /me/{tracks,albums,episodes,shows,audiobooks,following}` and `PUT/DELETE /playlists/{id}/followers` → `[ADDED] PUT /me/library`, `DELETE /me/library`, `GET /me/library/contains` (take Spotify URIs)
- `[ADDED] Add Items to Playlist (POST /playlists/{id}/items)`, `Get Playlist Items (GET /playlists/{id}/items)`, `Remove Playlist Items (DELETE /playlists/{id}/items)`, `Update Playlist Items (PUT /playlists/{id}/items)`
- `[REMOVED] Add Items to Playlist (POST /playlists/{id}/tracks)` → "Use POST /playlists/{id}/items instead" (same for GET/DELETE/PUT `/tracks`)
- `[CHANGED] Search for Item (GET /search) – The limit parameter maximum value has been reduced from 50 to 10, and the default value has been changed from 20 to 5.`

Field changes: Track `[REMOVED] available_markets, linked_from, popularity` (`external_ids` removed then **Reverted** in March 2026); Album `[REMOVED] album_group, available_markets, label, popularity`; Artist `[REMOVED] followers, popularity`; User `[REMOVED] country, email, explicit_content, followers, product`; Playlist `[RENAMED] tracks → items, tracks.tracks → items.items, tracks.tracks.track → items.items.item` and "Will only return an items object for the user's playlist, other playlists will only provide metadata".

"Endpoints still available" (quoted): `PUT /playlists/{id}`, `POST /me/playlists`, `GET /me/playlists`, `GET /me/following`, `GET /me/{albums,audiobooks,episodes,shows,tracks}`, `PUT/DELETE /me/library`, `GET /albums/{id}`, `GET /albums/{id}/tracks`, `GET /artists/{id}`, `GET /artists/{id}/albums`, `GET /tracks/{id}`, `GET /search`, `GET /me`, `GET /me/top/{type}`, all `/me/player/*`, `GET /playlists/{id}`, playlist cover endpoints.

**Migration guide** — `/documentation/web-api/tutorials/february-2026-migration-guide` (HTTP 200):
> Timeline: **February 11, 2026** — New Development Mode apps are created with new restrictions. **March 9, 2026** — Existing Development Mode apps are migrated to new restrictions.
> **Premium Requirement** — All Development Mode apps require the app owner to have an active Spotify Premium subscription. If the owner's Premium subscription lapses, the app will stop working.
> App Limits (New apps): Client IDs per developer **1**; Users per app **5**. As of July 2026, the Client IDs per developer limit has been increased to 25.
> **Existing apps are grandfathered:** If you already have multiple Client IDs or more than 5 users, you will retain them.
> Playlist Endpoint Renames — The playlist track management endpoints have been renamed from `/tracks` to `/items`.
> Batch/Bulk Fetch Endpoints (Removed) — `GET /tracks` → `GET /tracks/{id}` (one request per track)
> Search Endpoint — `limit` maximum 50 → 10; `limit` default 20 → 5. "If your app relies on fetching more than 10 results per search request, you will need to paginate through results using the offset parameter."

**Changelogs Mar / May / Jul 2026** (HTTP 200): March 2026: `[REVERTED] external_ids` on Album and Track "will continue to be available". May 2026: `[ADDED] account_id` on User — "A public, immutable, pseudoanonymous identifier for the user's account... Use account_id rather than id when linking user accounts". July 2026: `[CHANGED] Client IDs per developer — Increased from 1 to 25.` "API quotas for development mode are now counted per developer account rather than per Client ID." 429 body for quota: `{"error":{"status":429,"message":"Too many requests","reason":"QUOTA_EXCEEDED"}}`.

#### Quota modes — `/documentation/web-api/concepts/quota-modes` (HTTP 200)
> Newly-created apps begin in **development mode**. This mode is perfect for apps that are under construction and apps that have been built for accessing or managing data in a single Spotify account.
> **Note:** The app owner must have a Spotify Premium account for apps in development mode to function.
> **Up to 5 authenticated Spotify users** can use an app that is in development mode — so you can share your app with beta testers, friends, or with fellow developers who are working on the app. Each Spotify user who installs your app will need to be added to your app's allowlist before they can use it.
> Users may be able to log into a development mode app without having been allowlisted by the developer. However, API requests with an access token associated to that user and app will receive a **403** status code error.
> Quota counting — Endpoints are grouped into quota buckets and requests to endpoints in the same bucket count toward a shared limit... When the quota has been exceeded, the Web API returns a 429 Too Many Requests response with `"reason": "QUOTA_EXCEEDED"`.
> Extended quota mode — Please note that as of May 15th 2025, Spotify only accepts applications from organizations (not individuals)... Maintaining a minimum of active users (at least 250k MAUs).

**The "25 users" figure in the task brief is stale — the page says 5.** For a single-user app this is fine: the owner (must be Premium) is the only user.

#### Rate limits — `/documentation/web-api/concepts/rate-limits` (HTTP 200)
> Spotify's API rate limit is calculated based on the number of calls that your app makes to Spotify in a **rolling 30 second window**... The limit varies depending on whether your app is in development mode or extended quota mode. [no number published]
> The header of the 429 response will normally include a **Retry-After** header with a value in seconds.

Observed on live 401 responses: **no** `x-ratelimit-*` headers at all; headers present were `www-authenticate`, `access-control-allow-origin: *`, `access-control-allow-methods: GET, POST, OPTIONS, PUT, DELETE, PATCH`, `access-control-allow-headers: Accept, App-Platform, Authorization, Content-Type, Origin, Retry-After, ...`, `access-control-max-age: 604800`.

#### Auth — what we observed

**Unauthenticated API call.** `GET https://api.spotify.com/v1/search?q=lovecats&type=track` → **401**, `content-type: application/json`, header `www-authenticate: Bearer realm="spotify", error="missing_token", error_description="No token provided"`, body:
```json
{
  "error": {
    "status": 401,
    "message": "Missing/invalid/expired access token"
  }
}
```
Same 401 body for `GET /v1/tracks/{id}` and `GET /v1/audio-features/{id}`. With a bogus `Authorization: Bearer notarealtoken` the body is identical and `www-authenticate` becomes `error="invalid_token", error_description="Invalid access token"`. **The JSON body does not distinguish missing vs invalid token — read `www-authenticate` if you need to.**

**Token endpoint with bogus credentials.** `POST https://accounts.spotify.com/api/token` (form `grant_type=client_credentials&client_id=...&client_secret=...`, or Basic auth) → **400** `application/json`:
```json
{"error":"invalid_client","error_description":"Invalid client"}
```
With no credentials at all: **400** `{"error":"invalid_client"}` (no `error_description`). Response sets cookies (`__Host-device_id`, `sp_tr`) — ignore them server-side.

**Authorize endpoint with bogus client_id (PKCE params).** `GET https://accounts.spotify.com/authorize?client_id=bogus...&response_type=code&redirect_uri=http%3A%2F%2F127.0.0.1%3A3000%2Fapi%2Fspotify%2Fcallback&scope=playlist-modify-private&code_challenge_method=S256&code_challenge=...` → **303** to `https://accounts.spotify.com/en/login?continue=<authorize URL>&client_id=bogus...`. Client-id/redirect validation happens after login, so a bad `client_id` is not detectable from the first hop.

**PKCE flow** — `/documentation/web-api/tutorials/code-pkce-flow` (HTTP 200), quoted:
- Code verifier: "a high-entropy cryptographic random string with a length between 43 and 128 characters... letters, digits, underscores, periods, hyphens, or tildes." Challenge = base64url(SHA-256(verifier)) with `=` stripped, `+`→`-`, `/`→`_`.
- `GET https://accounts.spotify.com/authorize` query params: `client_id` (Required), `response_type` = `code` (Required), `redirect_uri` (Required; "must exactly match one of the values you entered when you registered your application, including upper or lowercase, terminating slashes"), `state` (Optional, but strongly recommended), `scope` (Optional, space-separated), `code_challenge_method` = `S256` (Required), `code_challenge` (Required). The doc's own example uses `const redirectUri = 'http://127.0.0.1:8080';`.
- Callback query: `code`, `state`; on failure `error` (e.g. `access_denied`), `state`.
- `POST https://accounts.spotify.com/api/token` with `Content-Type: application/x-www-form-urlencoded`, body: `grant_type=authorization_code`, `code`, `redirect_uri`, `client_id`, `code_verifier`. Response 200 JSON: `access_token`, `token_type` ("always \"Bearer\""), `scope`, `expires_in` (seconds), `refresh_token` ("When refreshing an access token, the response might not include a new refresh token. If it does not, continue using the existing token.").

**Redirect URIs** — `/documentation/web-api/concepts/redirect_uri` (HTTP 200), quoted:
> Beginning on the 9th of April 2025 we will enforce the subsequent validations to all newly created apps. We expect all clients to migrate to the new redirect URI validation by November 2025.
> Use HTTPS for your redirect URI, unless you are using a loopback address, when HTTP is permitted.
> If you are using a loopback address, use the explicit IPv4 or IPv6, like `http://127.0.0.1:PORT` or `http://[::1]:PORT` as your redirect URI.
> **`localhost` is not allowed as redirect URI.**
> If you don't know the port number in advance, register your redirect URI with a loopback IP literal, but without any port number. You can add the dynamically assigned port number to the redirect URI in the authorization request.
> Examples: `https://example.com/callback`, `http://127.0.0.1:8000/callback`, `http://[::1]:8000/callback`

**Scopes** — `/documentation/web-api/concepts/scopes` (HTTP 200), quoted:
- `playlist-modify-private` — Description: "Write access to a user's private playlists." Visible to users: "Manage your private playlists." Endpoints that require it: Follow a Playlist, Unfollow a Playlist, **Add Items to a Playlist**, Change a Playlist's Details, **Create a Playlist**, Remove Items from a Playlist, Reorder a Playlist's Items, Replace a Playlist's Items, Upload a Custom Playlist Cover Image.
- `playlist-modify-public` — "Write access to a user's public playlists." (same endpoint list)
- `playlist-read-private` — endpoints: Check if Users Follow a Playlist, Get a List of Current User's Playlists, Get a List of a User's Playlists.
- Surprise: the page lists **"Search for an Item"** under "Endpoints that require the `user-read-private` scope" (alongside Get Current User's Profile). Untestable here; safest to request `playlist-modify-private user-read-private` (public-data search has historically worked without it, but the doc now says otherwise).

#### Playlist endpoints (current) — reference pages, quoted
**Create Playlist — `POST https://api.spotify.com/v1/me/playlists`** (`/reference/create-playlist`)
> Create a playlist for the current Spotify user. (The playlist will be empty until you add tracks.) Each user is generally limited to a maximum of 11000 playlists.
> Scopes: playlist-modify-public, playlist-modify-private.

Body (`application/json`): `name` string **Required**; `public` boolean "Defaults to true... To be able to create private playlists, the user must have granted the playlist-modify-private scope"; `collaborative` boolean (default false; requires `public:false` and both modify scopes); `description` string.
Response **201** playlist object: `collaborative, description (nullable), external_urls.spotify, href, id, images[{url,height,width}] ("temporary and will expire in less than a day"), name, owner{...}, public, snapshot_id, items{...}, type, uri`.
Old `POST /users/{user_id}/playlists` page: "Deprecated: Use Create Playlist instead." (still documented, `user_id` path param, example `smedjan`).

**Add Items to Playlist — `POST https://api.spotify.com/v1/playlists/{playlist_id}/items`** (`/reference/add-items-to-playlist`)
> Add one or more items to a user's playlist. Scopes: playlist-modify-public, playlist-modify-private.

Query params: `position` integer (zero-based; "If omitted, the items will be appended"); `uris` comma-separated Spotify URIs (track or episode). Body (`application/json`): `{"uris": ["spotify:track:4iV5W9uYEdYUVa79Axb7Rh", ...], "position": 3}`. "A maximum of 100 items can be added in one request." "if the uris parameter is present in the query string, any URIs listed here in the body will be ignored." Response **201**: `{"snapshot_id": "abc"}`. Errors documented: 401, 403, 429.
Old `POST /playlists/{playlist_id}/tracks` page: badge Deprecated + "Deprecated: Use Add Items to Playlist instead." (identical params).

**Get Playlist Items — `GET /playlists/{playlist_id}/items`**
> This endpoint is only accessible for playlists owned by the current user or playlists the user is a collaborator of. A 403 Forbidden status code will be returned if the user is neither the owner nor a collaborator of the playlist.

#### Search — `GET https://api.spotify.com/v1/search` (`/reference/search`, HTTP 200), quoted
- `q` string Required. Filters: `album`, `artist`, `track`, `year`, `upc`, `tag:hipster`, `tag:new`, `isrc`, `genre`. "The artist and year filters can be used while searching albums, artists and tracks. You can filter on a single year or a range (e.g. 1955-1960)." "The isrc and track filters can be used while searching tracks." Example `q=remaster%2520track%3ADoxy%2520artist%3AMiles%2520Davis`.
- `type` Required, comma-separated: `album, artist, playlist, track, show, episode, audiobook`.
- `market` ISO 3166-1 alpha-2. "If a valid user access token is specified in the request header, the country associated with the user account will take priority over this parameter. Note: If neither market or user country are provided, the content is considered unavailable for the client."
- `limit` integer — **Default: limit=5, Range: 0-10**. `offset` — Default 0, Range 0-1000. `include_external=audio`.
- Response: `tracks: { href, limit, next (nullable), offset, previous (nullable), total, items: TrackObject[] }`. TrackObject: `album{album_type,total_tracks,available_markets[Deprecated],external_urls.spotify,href,id,images[],name,release_date,release_date_precision,...}, artists[{external_urls,href,id,name,type,uri}], disc_number, duration_ms, explicit, external_ids{isrc,ean,upc}, external_urls.spotify, href, id, is_playable, name, popularity[Deprecated], preview_url[Deprecated, nullable], track_number, type, uri, is_local`.
- ISRC search (`q=isrc:XXXX&type=track`) is documented — the best deterministic bridge from MusicBrainz/Deezer data to a Spotify ID once a key exists. UNTESTED.

#### Keyless surfaces (all observed)

**oEmbed — `GET https://open.spotify.com/oembed?url=<open.spotify.com URL or spotify: URI>`**
- 200 `application/json`, `access-control-allow-origin: *` (also with an `Origin: http://127.0.0.1:3000` header), no rate-limit headers, no `cache-control`.
- Real track (`6q2T5xXao6mTS6LLE88L84`):
```json
{
  "html": "<iframe style=\"border-radius: 12px\" width=\"100%\" height=\"152\" title=\"Spotify Embed: The Lovecats\" frameborder=\"0\" allowfullscreen allow=\"autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture\" loading=\"lazy\" src=\"https://open.spotify.com/embed/track/6q2T5xXao6mTS6LLE88L84?utm_source=oembed\"></iframe>",
  "iframe_url": "https://open.spotify.com/embed/track/6q2T5xXao6mTS6LLE88L84?utm_source=oembed",
  "width": 456, "height": 152, "version": "1.0",
  "provider_name": "Spotify", "provider_url": "https://spotify.com", "type": "rich",
  "title": "The Lovecats",
  "thumbnail_url": "https://image-cdn-fa.spotifycdn.com/image/ab67616d00001e0248ead1ce9bee56c7e1d1f4c0",
  "thumbnail_width": 300, "thumbnail_height": 300
}
```
- `title` is the track title only (no artist). Artist URL works too (`height: 352`, `thumbnail 320x320`). Accepts `spotify:track:{id}` and `https://open.spotify.com/intl-de/track/{id}` forms.
- Nonexistent ID → **404 with empty body and no content-type**. Missing `url` param → **504** `text/plain` "upstream request timeout" (treat as bad request, don't retry).

**Embed iframe — `GET https://open.spotify.com/embed/track/{id}`**
- **200 `text/html; charset=utf-8` for BOTH real and nonexistent IDs.** Nonexistent renders a "Page not found" shell (`__NEXT_DATA__.props.pageProps.status: 404`). Do not use HTTP status to validate an ID; use oEmbed (404) instead.
- `cache-control: private, no-cache, no-store, max-age=0, must-revalidate`; no `x-frame-options` / CSP frame-ancestors header observed (embedding allowed).
- Server HTML contains **no** "log in"/"login"/"Premium" strings — playback UI is client-rendered, so the "log in to hear the full song / 30 s preview" behaviour could not be confirmed from HTML (UNTESTED).
- The page embeds `<script id="__NEXT_DATA__">` with `props.pageProps.state.data.entity`: `{type:"track", name, title, uri:"spotify:track:…", id, artists:[{name, uri:"spotify:artist:…"}], releaseDate:{isoString:"1983-01-01T00:00:00Z"}, duration:220093 (ms), isPlayable:true, playabilityReason:"PLAYABLE", isExplicit, isNineteenPlus, contentRatings, audioPreview:{url:"https://p.scdn.co/mp3-preview/ea067be9…"}, isMusicVideo, hasVideo, videoPreview, videoThumbnailImage, relatedEntityUri, visualIdentity:{backgroundBase{r,g,b,a},…}}` plus `data.embeded_entity_uri`, `data.defaultAudioFileObject:{passthrough:"NONE"}`.
- That `audioPreview.url` is fetchable: HEAD → 200 `audio/mpeg`, `Content-Length: 359956`, `Accept-Ranges: bytes`, `Access-Control-Allow-Origin: *`, `Cache-Control: max-age=604800, no-transform`; range GET → 206 (starts with ID3). **Policy caveat:** reference docs say "Audio Preview Clips may not be offered as a standalone service or product." and this is an undocumented page internal — usable for a local single-user hover-preview at most, not something to build on.

**Track page — `GET https://open.spotify.com/track/{id}`** → 200 (286 KB) with server-rendered meta: `<title>The Lovecats - song and lyrics by The Cure | Spotify</title>`, `og:title="The Lovecats"`, `og:description="The Cure · Japanese Whispers · Song · 1983"`, `og:image="https://i.scdn.co/image/ab67616d0000b27348ead1ce9bee56c7e1d1f4c0"` (640x640), `music:duration="220"`, `music:release_date="1983-01-01"`, `music:musician="https://open.spotify.com/artist/7bu3H8JO7d0UbMoVzbo70s"`. Keyless artist/album/year for a known ID, but it's HTML scraping (no CORS, no contract).

**Deep link — `GET https://open.spotify.com/search/The%20Cure%20The%20Lovecats`** → **200** `text/html` (no redirect), `<title>Search | Spotify</title>`, `og:url` echoes the path, `og:description="Looking for something? Find artists, songs, albums, playlists, and more."`. Body is a client-rendered shell (no `__NEXT_DATA__`, no results in HTML). **Valid "no ID known" fallback link**; the desktop app/web player opens it with the query prefilled.

**Dashboard** — `https://developer.spotify.com/dashboard` → 200 (client-rendered, empty `<title>`; login happens in-page).

#### Coverage over the sample set
Spotify `/v1/search` is **UNTESTED (needs key)** for all 15. As a keyless cross-check the probe resolved Spotify track IDs from **Wikidata property P2207 ("Spotify track ID")** and verified each with oEmbed. Wikidata's anonymous API throttled (**HTTP 429**) after ~40 requests at 1 req/s and again after 7 requests at 2.5 s spacing, so only the first rows were resolved; this is a Wikidata limitation, not a Spotify one.

| # | Artist — Title (year) | Spotify search | Keyless bridge (Wikidata P2207 → oEmbed) |
|---|---|---|---|
| 1 | The Cure — The Lovecats (1983) | UNTESTED (needs key) | **Found**: Q93960258 → `6q2T5xXao6mTS6LLE88L84`; oEmbed 200 title "The Lovecats"; embed entity: The Cure, 1983-01-01, 220093 ms |
| 2 | Louis Prima — Jump, Jive an' Wail (1956) | UNTESTED | Wikidata Q6311026 ("1956 song") has no P2207 |
| 3 | Cherry Poppin' Daddies — Zoot Suit Riot (1997) | UNTESTED | Q8074220 (album) / Q8074222 (single) have no P2207 |
| 4 | Caravan Palace — Lone Digger (2015) | UNTESTED | Q125447162 ("song by the Caravan Palace") has no P2207 |
| 5–15 | Squirrel Nut Zippers — Hell; Peggy Lee — Fever; Talking Heads — Psycho Killer; Billie Eilish — bad guy; Olivia Rodrigo — vampire; Sade — Smooth Operator; Parov Stelar — Booty Swing; The Stranglers — Golden Brown; Kali Uchis — telepatía; Big Bad Voodoo Daddy — Mr. Pinstripe Suit; Lawrence Arabia — Apple Pie Bed | UNTESTED | Not resolved — Wikidata returned 429 before these could be looked up |

Odesli/song.link (`https://api.song.link/v1-alpha.1/links?url=<apple music url>`), a former keyless ID bridge, now returns **401 `{"statusCode":401,"code":"PUBLIC_API_ACCESS_DEPRECATED"}`** — not usable.

#### What Phase 6 needs from the user
1. Spotify **Premium** on the account that owns the app (dev-mode apps stop working otherwise).
2. Create an app at **`https://developer.spotify.com/dashboard`** (login in-page). Copy the **Client ID**. Client secret is not needed for PKCE (keep the flow secret-free; if we prefer the classic auth-code flow server-side, the secret is required and must live in `.env.local` only).
3. Register the redirect URI **exactly** as the app will send it, e.g. `http://127.0.0.1:3000/api/spotify/callback` (loopback IPv4 literal; `localhost` is rejected; port may be omitted in the dashboard and supplied at request time for loopback only).
4. The owner is automatically an allowed user; nobody else needs allowlisting for a single-user app (cap is 5).
5. Set `SPOTIFY_CLIENT_ID` (+ optional `SPOTIFY_CLIENT_SECRET`) and `SPOTIFY_REDIRECT_URI` in `.env.local`; never expose them to the client bundle.

#### Recommended usage in It Stings
- **Auth:** PKCE via Next.js route handlers: `/api/spotify/login` (generate verifier, store in an httpOnly cookie or SQLite, redirect to `/authorize` with `scope=playlist-modify-private user-read-private`, `state`), `/api/spotify/callback` (exchange `code` at `/api/token` with `code_verifier`), store `access_token`/`refresh_token`/`expires_in` in SQLite; refresh with `grant_type=refresh_token&client_id=…&refresh_token=…` (keep old refresh token if none returned).
- **Resolve tracks:** `GET /v1/search?q=track:"<title>" artist:"<artist>"&type=track&limit=10` (max 10 in dev mode; paginate with `offset`); prefer `q=isrc:<ISRC>` when MusicBrainz/Deezer gives an ISRC. Cache `id`, `uri`, `name`, `artists[].name`, `album.name`, `album.release_date`, `duration_ms`, `external_ids.isrc`, `external_urls.spotify` in SQLite. Do **not** rely on `popularity`, `available_markets`, `preview_url`, batch `GET /tracks?ids=`, audio-features, or recommendations.
- **Create playlist:** `POST /v1/me/playlists` `{name, public:false, description}` → save `id`, `external_urls.spotify`, `snapshot_id`.
- **Add tracks:** `POST /v1/playlists/{id}/items` body `{uris:[…]}` in chunks of ≤100, sequentially; store returned `snapshot_id`.
- **Errors:** 401 → refresh then retry once; 403 → user not allowlisted / scope missing / Premium lapsed; 429 → honour `Retry-After` (seconds) and treat `reason:"QUOTA_EXCEEDED"` as a daily-ish stop, not a retry.
- **Keyless fallbacks in the UI:** when a Spotify ID is known → oEmbed for `title`/`thumbnail_url`/`iframe_url` (cacheable, CORS `*`) and the `/embed/track/{id}` iframe; when unknown → link to `https://open.spotify.com/search/<artist> <title>` (URL-encoded). Validate IDs with oEmbed's 404, never with the embed page's status.

---

### 3.6 Web-search APIs for Channel B (Tavily, Brave, Exa, Serper) + Reddit block + rateyourmusic

All statements are backed by real curl requests run on 2026-09-06 (default curl UA unless noted). No API keys were available; every search endpoint was called with a bogus key and with no key to capture the auth-error shape. No real search could be executed, so **coverage over the 15-track sample set is UNTESTED for all four providers**.

#### Reddit — block confirmed (do not scrape)
| Request | Observed |
|---|---|
| `GET https://www.reddit.com/r/ifyoulikeblank/search.json?q=lovecats&restrict_sr=1` (curl default UA) | **HTTP 403**, `content-type: text/html`, `content-length: 189908`, `retry-after: 0`, `server: snooserv`, `cache-control: private, no-store`. Body is an HTML block page, not JSON. First 200 chars: `<body class=theme-beta><div><style>.theme-light,:root{--rem360:22.5rem;--rem320:20rem;--rem192:12rem;--rem144:9rem;--rem128:8rem;--rem96:6rem;--rem90:5.625rem;--rem88:5.5rem;--rem64:4rem;--rem56:3.5re` |
| `GET https://old.reddit.com/r/ifyoulikeblank/` | **HTTP 302** → `Location: https://old.reddit.com/login/?reason=lor2&dest=https%3A%2F%2Fold.reddit.com%2Fr%2Fifyoulikeblank%2F` (login wall, `server: snooserv`). |
| `POST https://www.reddit.com/api/v1/access_token` with `grant_type=client_credentials`, no credentials | **HTTP 401**, `www-authenticate: Basic realm="reddit"`, body `{"message": "Unauthorized", "error": 401}`. Reachable, but requires a registered app's client id/secret via HTTP Basic. |
| `GET https://www.redditinc.com/policies/data-api-terms` (→ `https://redditinc.com/policies/data-api-terms`) | **HTTP 200**. Quotes: "If you are interested in using the Data APIs for commercial purposes, research in excess of rate limits, or for any use that is not expressly permitted under the Data API Terms, then you will need to enter into a separate agreement with Reddit." License is only "to copy and display the User Content using the Data API solely as necessary to develop, deploy, distribute, and run your App"; "no other rights or licenses are granted or implied, including any right to use User Content for other purposes, such as for training a machine learning or AI model". Also prohibits "sell, lease, or sublicense the Data APIs ... or derive revenues from the use or provision of the Data APIs ... unless there is express written approval from Reddit". |

Conclusion: no legal unauthenticated path; the OAuth path needs app registration and the terms are hostile to a recommendation product. The only legal route to Reddit thread text is a third-party search API's own content extraction (Tavily `raw_content`/`content`, Brave LLM Context `snippets`, Exa `text`/`highlights`). Per ground rules no UA spoofing or retries were attempted.

#### rateyourmusic.com — Cloudflare challenge
`GET https://rateyourmusic.com/release/single/the-cure/the-lovecats/` → **HTTP 403**, `server: cloudflare`, `cf-mitigated: challenge`, `cf-ray: a36cf495dbc111a9-MRS`, `content-type: text/html; charset=UTF-8`, 5,519-byte body titled "Just a moment..." containing `__cf_chl` (3×), `challenge-platform`. This is a Cloudflare JS challenge, not a plain 403; server-side curl cannot get RYM pages. Not circumvented. RYM evidence must also come via a search API's snippets/extraction.

#### Brave Search API
- **Endpoint**: `GET https://api.search.brave.com/res/v1/web/search` (base `https://api.search.brave.com/res`, path `/v1/web/search`). Auth header `X-Subscription-Token` (docs spell it `x-subscription-token`). Send `Accept: application/json`, `Accept-Encoding: gzip`.
- **Bogus key**: `HTTP 422` (not 401!) `{"error":{"code":"SUBSCRIPTION_TOKEN_INVALID","detail":"The provided subscription token is invalid.","meta":{"component":"authentication"},"status":422},"type":"ErrorResponse"}` (`server: awselb/2.0`). **No key**: `HTTP 422` `{"error":{"code":"VALIDATION","detail":"Unable to validate request parameter(s)","meta":{"errors":[{"input":null,"loc":["header","x-subscription-token"],"msg":"Field required","type":"missing"}]},"status":422},"type":"ErrorResponse"}`. Observed RTT ~0.8–1.0 s for the error path (no rate-limit headers on error responses).
- **Pricing as stated on https://brave.com/search/api/ (2026-09-06)**: plan **"Search"** — "$5 per 1,000 requests", "Includes $5 in free credits every month", special features "Goggles: Custom reranking & result filtering", "**Extra alternate snippets**", "Schema-enriched results + added metadata", capacity "**50 queries per second**". Plan "Answers" — "$4 per 1,000 requests + $5 per million input/output tokens", 2 QPS. Enterprise: contact. Help page (`/documentation/resources/help-feedback/index.html.md`): "We do not offer a standalone free plan. However, each plan receives $5 in free credits that renew every single month ... This $5 in free credit is equivalent to (for example) **1,000 queries per month on the Search plan**." "Free monthly credits ... are replaced each month rather than carried over." **Credit card required** ("$0 or $1 charge hold ... immediately refunded"); "set your prepay amount to $0" to stay free. Prepaid balance exhausted → "service pauses". Up to 10 keys per plan. So: `extra_snippets` IS on the only Search plan, i.e. available on the free $5 credits.
- **Rate limiting doc** (`/documentation/guides/rate-limiting/index.html.md`): 1-second sliding window; exceed → **429**. Response headers on every call: `X-RateLimit-Limit` (e.g. `1, 15000` = per-second, per-month; `0` = unlimited), `X-RateLimit-Policy` (`1;w=1, 15000;w=2592000`), `X-RateLimit-Remaining`, `X-RateLimit-Reset` (seconds). "Only successful requests (non-error responses) are counted against your quota and billed." (Could not observe live values without a key.)
- **Query params** (API reference `api-reference/web/search/get/index.html.md`): `q` (required; max 400 chars / 50 words), `country` (default `US`, `ALL` allowed), `search_lang` (default `en`), `ui_lang`, **`count` 1–20 (default 20; web results only)**, `offset` 0–9, `safesearch` off|moderate|strict, `spellcheck` (default true; altered query in `query.altered`), **`freshness`** `pd|pw|pm|py|YYYY-MM-DDtoYYYY-MM-DD`, `text_decorations` (default true — set false to avoid highlight markers in snippets), `result_filter` comma list of `discussions,faq,infobox,news,query,summarizer,videos,web,locations`, `goggles`, **`extra_snippets`** ("up to 5 additional, alternative excerpts"), `summary`, `enable_rich_callback` (Search plan), `include_fetch_metadata`, `operators` (bool, default true).
- **Operators** (`/documentation/resources/search-operators/index.html.md` + web-search page): `site:` ("`site:example.com` will include all subdomains"), quotes for exact phrase (`"climate change solutions"`), `-term`, `intitle:`, `inbody:`, `inpage:`, `lang:`, `loc:`, `ext:`/`filetype:`, combinable with AND/OR/NOT. Response echoes `query.search_operators.applied`, `.cleaned_query`, `.sites[]`.
- **Response fields** (200): `type`, `query{original, altered, cleaned, more_results_available, reddit_cluster, search_operators{applied,cleaned_query,sites}, ...}`, **`web.results[]{title, url, description, page_age, page_fetched, fetched_content_timestamp, profile{name,url,long_name,img}, language, family_friendly, type:"search_result", subtype, extra_snippets: string[], deep_results{news,buttons,videos}}`**, **`discussions{type:"search", results[]{title,url,description,page_age,extra_snippets,...}}`** ("Discussions clusters aggregated from forum posts"), `mixed` (ranking order), `news`, `videos`, `faq`, `infobox`, `locations`, `summarizer`. Errors 404/422/429: `{type, error{id,status,detail,meta,code}, time}`.
- **Content extraction**: web search gives `description` + up to 5 `extra_snippets` per result (query-dependent excerpts, not full text). For real page text use **LLM Context**: `GET|POST https://api.search.brave.com/res/v1/llm/context` (same `X-Subscription-Token`), docs say it is for "extracting forum discussions (e.g. from Reddit)". Params: `q`, `count` 1–50, `freshness`, `maximum_number_of_urls` (1–50, default 20), `maximum_number_of_tokens` (1024–32768, default 8192), `maximum_number_of_snippets` (1–256), `maximum_number_of_tokens_per_url` (512–8192), `maximum_number_of_snippets_per_url`, `context_threshold_mode` strict|balanced|lenient|disabled, `goggles`, `enable_source_metadata`. Response: `grounding.generic[]{url, title, snippets[]}` + `sources{<url>:{title, hostname, age[4], description}}`. Help page: "The Search plan covers web, news, image, and video search with local enrichments, rich data and LLM context"; whether an LLM Context call bills at the same $5/1k was not separately stated (UNVERIFIED).
- **Terms (SEARCH API TERMS OF USE, "Last updated: 1 Sep, 2026")**: "Customer shall not and shall not permit End Users or others to: (i) **store, cache, or create a database of Search Results, in whole or in part, other than transient storage required for operation of Customer Applications** ...; (ii) create derivative works of ... Search Results". FAQ: "It is prohibited to retain any and all data received through the Brave Search API. If you need to store the results or train an LLM, please reach out to ... searchapi-support@brave.com". Pricing page: "If you would like to store the API results ... you will need to subscribe to a plan that explicitly grants storage rights."
- Signup/dashboard: https://api-dashboard.search.brave.com/app/plans (login at /login). Docs index for machines: https://api-dashboard.search.brave.com/llms.txt (every page has an `index.html.md` twin; the `/app/documentation/...` HTML routes are a client-rendered SPA that returns the same shell for every path).

#### Tavily
- **Endpoint**: `POST https://api.tavily.com/search`, JSON body. Auth: `Authorization: Bearer <key>` (a bogus `api_key` in the body produced the identical 401, so the body form is also parsed).
- **Bogus key / no key**: `HTTP 401` `{"detail": {"error": "Unauthorized: missing or invalid API key."}}` (`server: awselb/2.0`). RTT 0.7–1.5 s on the error path.
- **Free tier / pricing** (`docs.tavily.com/documentation/api-credits`): "You get **1,000 free API Credits every month. No credit card required.**" Plans: Researcher 1,000/mo Free; Project 4,000 $30; Bootstrap 15,000 $100; Startup 38,000 $220; Growth 100,000 $500; Pay-as-you-go $0.008/credit; Enterprise custom. Search cost: `basic`, `fast`, `ultra-fast` = **1 credit**; `advanced` = **2 credits**; `auto_parameters` may silently pick advanced (2). Extract endpoint: 5 URLs per credit (basic).
- **Rate limits** (`/documentation/rate-limits`): Development key **100 RPM**; Production key 1,000 RPM ("Access to production keys requires either an active Paid Plan or PAYGO enabled"). 429 returns `retry-after: <seconds>` and `{"error": "Your request has been blocked due to excessive requests. Please reduce the rate of requests."}`. Also 432 "Key limit or Plan Limit exceeded", 433 "PayGo limit exceeded".
- **Request params** (OpenAPI at `.../endpoint/search.md`): `query` (required), **`search_depth`** `advanced|basic|fast|ultra-fast` (default basic; controls how `results[].content` is built), `chunks_per_source` 1–3 (default 3; "Chunks are short content snippets (maximum 500 characters each) pulled directly from the source ... appear in the content field as `<chunk 1> [...] <chunk 2>`"), **`max_results`** 0–20 (default 10), `topic` general|news|finance, `time_range` day|week|month|year|d|w|m|y, `start_date`/`end_date` YYYY-MM-DD, `include_answer` false|true|basic|advanced, **`include_raw_content`** false|true|markdown|text ("Include the cleaned and parsed HTML content of each search result. `markdown` or `true` returns ... markdown format. `text` returns the plain text ... may increase latency"), `include_images`, `include_image_descriptions`, `include_favicon`, **`include_domains`** (max 300), `exclude_domains` (max 150), `include_domains_mode` filter|boost, `country`, `language`, `filter_by_language`, `auto_parameters`, **`exact_match`** (bool; "only search results containing the exact quoted phrase(s) in the query are returned ... Wrap target phrases in quotes"), `include_usage`, `safe_search` (not for fast/ultra-fast).
- **Response**: `query`, `answer` (only with include_answer), `images[]`, **`results[]{title, url, content, score (float, e.g. 0.81025416), raw_content (only if include_raw_content), favicon, images[], id}`**, `auto_parameters`, `response_time` (seconds), `usage{credits}` (with include_usage), `request_id`. Required keys: query, results, images, response_time, answer.
- **Reddit content**: `content` = up to 3 query-relevant ≤500-char chunks of the page from Tavily's index; `raw_content` = full cleaned page in markdown/text — both produced by Tavily, so thread text arrives without the app touching reddit.com. Best-practices page recommends two-step search → Extract (`/extract`, 5 URLs per credit) for comprehensive text. No plan gating on `include_raw_content` appears anywhere in the search OpenAPI.
- **Terms** (Platform Terms of Service, "Last updated: May 4, 2026", https://www.tavily.com/terms): no clause found prohibiting caching/storing/creating a database of results (searched for retain/store/cache/database). Restrictions (3.2) target the Services, and 1.7 states the term "Services" does not include Output. Note 6.5: Tavily "may use, process, analyze, and retain Customer Input ... for purposes of training".
- Latency claim (homepage): "180 ms p50 on Tavily /search". Signup: https://app.tavily.com (playground at /playground, billing at /billing).

#### Exa
- **Endpoint**: `POST https://api.exa.ai/search`, header `x-api-key` (OpenAPI also lists bearer). `server: cloudflare`; responses carry `x-request-id` (also `x-exa-queued`, `x-exa-queue-ms`, `Retry-After` exposed via CORS).
- **Bogus key**: `HTTP 401` `{"requestId":"1ec121dbc47b44a39828cc8506d190b5","error":"Invalid API key","tag":"INVALID_API_KEY"}`. **No key**: `HTTP 402` `{"tag":"X402_PAYMENT_REQUIRED","x402Version":2,...}` — an x402 crypto payment challenge offering the search for 7000 base units USDC (`totalUsd: 0.007`) on Base (`eip155:8453`) or Solana, plus an "agentkit" wallet-signature free trial (`"mode":{"type":"free-trial","uses":100}`). Its embedded schema says `numResults` "max 10 for x402" and lists `type: auto, keyword, neural, deep-lite, deep, deep-reasoning` and `contents: text, highlights, summary`. RTT ~1.1 s on the error path.
- **Pricing** (https://exa.ai/pricing, served as markdown): "New accounts get **$20 in free credits (around 2,800 searches)** and the Free Tier adds **$10 in credits every month**." `/search` **$7 / 1k requests** (base includes up to 10 results) + $1 / 1k results above 10 + $1 / 1k AI page summaries; `/contents` $1 / 1k pages per content type; deep types $12–15 / 1k. `costDollars.contents.{text,highlights,summary}` are "billed outside the bundled search price" — the exact per-page rate for `text`/`highlights` attached to `/search` is not stated on the pricing page (UNVERIFIED). Pay-as-you-go, no subscription.
- **Rate limits** (`/docs/reference/rate-limits`, "Last modified on July 20, 2026"): `/search` **10 QPS**, `/contents` 100 QPS, `/answer` 10 QPS. 429 body: `{"requestId":..., "error":"You've exceeded the Exa rate limit for your network...", "tag":"RATE_LIMIT_EXCEEDED"}`.
- **Request params** (OpenAPI 2.0.0 at `/docs/reference/search.md`): `query` (required), **`type`** enum `instant|fast|auto|deep-lite|deep|deep-reasoning` (default `auto`; guide latencies: auto ~1 s, instant ~250 ms, fast ~450 ms, deep-lite 4 s, deep 4–15 s, deep-reasoning 12–40 s). **`neural` and `keyword` are NOT in the current enum**; `resolvedSearchType` is "Deprecated legacy field. Current production responses may return an empty string; clients should not branch on this value" (only `costDollars.search.neural/keyword` remain). `category` (company|publication|news|personal site|financial report|people), `numResults` 1–100 (default 10), **`includeDomains`/`excludeDomains`** (max 1200; hostnames, path prefixes like `reddit.com/r/ifyoulikeblank`, wildcards `*.example.com`; docs: "Use this parameter for domain or path filtering instead of adding a `site:` operator to the query"), `startPublishedDate`/`endPublishedDate` (ISO 8601), `moderation`, `userLocation`, `outputSchema`, `additionalQueries` (deep only), **`contents{ text: true | {maxCharacters ≤10000, includeHtmlTags, verbosity compact|standard|full, includeSections[], excludeSections[]}, highlights: true | {query, maxCharacters, numSentences, highlightsPerUrl}, summary{query, schema}, maxAgeHours (-1..720; 0 = fetch fresh), livecrawl (deprecated: never|always|fallback|preferred), livecrawlTimeout, subpages, subpageTarget }`**. Quoted-phrase exact matching is not documented on `/search` (UNVERIFIED).
- **Response**: `requestId`, **`results[]{title, url, publishedDate, author, id, image, favicon, text, highlights[], highlightScores[], summary, subpages[]}`**, `resolvedSearchType` (deprecated), `costDollars{total, search{neural,keyword}, summary, contents{text,highlights,summary}}`; optional `text/event-stream` streaming.
- **Terms** (PDF https://exa.ai/assets/Exa_Labs_Terms_of_Service.pdf, extracted with pypdf): 4.2(a) "You may not ... download, modify, copy, distribute, transmit, display, perform, reproduce, duplicate, publish, license, create derivative works from, or offer for sale any information contained on, or obtained from or through, the Services, **except for temporary files that are automatically cached by your web browser for display purposes, or as otherwise expressly permitted in these Terms or by us in writing**." Read literally this restricts a persistent SQLite cache of Exa results.
- API key: https://dashboard.exa.ai/api-keys.

#### Serper
- **Endpoint**: `POST https://google.serper.dev/search`, header `X-API-KEY`, JSON body. `server: Google Frontend`, `access-control-allow-origin: *`.
- **Bogus key**: `HTTP 403` `{"message":"Unauthorized.","statusCode":403}`. **No key**: `HTTP 403` `{"message":"Unauthorized. Sign up for a free account.","statusCode":403}`. `GET https://google.serper.dev/` and `/openapi.json` → 403 (72-byte JSON); `https://scrape.serper.dev/` → 403 (a scrape host exists but is keyed).
- **Pricing as stated on https://serper.dev (2026-09-06)**: "**Get 2,500 free queries** No credit card required" (one-time signup credits; no monthly refill is mentioned). Top-up packs: Starter $50 = 50k credits ($1.00/1k), 50 QPS; Standard $375 = 500k ($0.75/1k), 100 QPS; Scale $1,250 = 2.5M ($0.50/1k), 200 QPS; Ultimate $3,750 = 12.5M ($0.30/1k), 300 QPS; "Credits valid for 6 months"; "all queries are returned in 1 to 2 seconds" (occasionally 2–4 s). `/pricing` and `/docs` URLs 404; the playground is a client-rendered Next.js page with no parameter docs in HTML.
- **Request shape**: public request docs are behind login. The only publicly observable fields are the homepage playground form inputs `q`, `gl` (default `us`), `hl` (default `en`). `num`/`page`/`tbs` exist per common usage but were NOT observed in any fetched page (UNVERIFIED).
- **Response** (homepage example JSON): `knowledgeGraph{title,type,website,imageUrl,description,descriptionSource,descriptionLink,attributes{}}`, **`organic[]{title, link, snippet, sitelinks[]{title,link}, position, date, source}`**, plus vertical-specific keys (`images[]`, `places[]`, `shopping[]`, scholar `publicationInfo`). **Snippets only — no page content**; getting Reddit text would require the separate scrape host, i.e. proxied scraping of reddit.com HTML, which is exactly what this app must not do. Google query syntax (`site:`, quotes) passes through `q` but could not be tested.

#### Coverage over the sample set
| # | Track | Brave | Tavily | Exa | Serper |
|---|---|---|---|---|---|
| 1–15 | The Cure — The Lovecats … Lawrence Arabia — Apple Pie Bed | UNTESTED (needs key) | UNTESTED (needs key) | UNTESTED (needs key) | UNTESTED (needs key) |

No provider accepted a request without a valid key, so zero searches ran; only auth-error shapes were observed. Coverage must be re-probed once a key is provisioned (suggested first query: `"The Lovecats" "The Cure" songs like OR similar OR "sounds like"` with a reddit.com domain filter, then the same for the 1950s/swing tracks which are the likeliest to have thin forum evidence). Per-track notes from the probe: single-word titles (Hell) and ambiguous ones (Fever, vampire) need the artist in quotes plus `exact_match` (Tavily) / quoted phrases (Brave); telepatía needs UTF-8 in the JSON body (Tavily/Exa/Serper) or percent-encoding in `q` (Brave); Apple Pie Bed is the likeliest to have thin forum evidence and is a good test of fallback behaviour.

#### Recommendation for It Stings (Channel B)
Weighting: legal Reddit thread content > free-tier size > site:/quoted-phrase support > latency.

1. **PRIMARY — Tavily** (`TAVILY_API_KEY`). 1,000 free credits/month with no card; `include_domains: ["reddit.com"]` (or `["reddit.com","rateyourmusic.com"]`) replaces `site:`; `exact_match: true` honors quoted phrases; `results[].content` (3 chunks × ≤500 chars) plus optional `raw_content` give thread text produced by Tavily's own crawler; 100 RPM on the dev key; 180 ms p50 claimed; and its platform terms contain no result-retention prohibition, so the SQLite cache is unproblematic. Budget: 1 credit per `basic` call — about 33 queries/day, or 2 queries × 15 tracks × basic = 30 credits per full sample run. Use `search_depth: "advanced"` (2 credits) only when basic returns fewer than ~3 reddit hits.
2. **FALLBACK — Brave Search API** (`BRAVE_SEARCH_API_KEY`). $5 free credits/month ≈ 1,000 web searches, 50 QPS, native `site:reddit.com` + quotes, `extra_snippets=true` (≤5 excerpts/result), a dedicated `discussions` result cluster, and `/v1/llm/context` which returns extracted Reddit `snippets[]`. Two costs: a credit card is required to activate, and the ToS forbids storing/caching Search Results beyond "transient storage" — so Brave-sourced evidence must not be persisted in SQLite beyond a short operational TTL (or at all), which is why it is the fallback rather than primary. Use `text_decorations=false`, `count=10`, `result_filter=web,discussions`.
3. **Optional — Exa** (`EXA_API_KEY`). Best extraction (`contents.text` ≤10k chars, `highlights`) and the largest free allowance ($20 signup + $10/month ≈ 1,400 searches/month at $7/1k), 10 QPS; `includeDomains` scopes to reddit.com. But its ToS 4.2(a) bars copying/storing information obtained through the Services except browser cache, quoted-phrase matching is undocumented, `neural`/`keyword` types are gone, and a missing key yields an x402 crypto challenge instead of a plain 401. Wire it only if Tavily+Brave prove thin.
4. **Skip — Serper** (`SERPER_API_KEY`). 2,500 one-time free queries, snippets only, no content extraction, no monthly refill; its scrape host would mean proxied scraping of Reddit.

Server route should pick the first provider whose key is set, in that order, and tag each stored evidence row with `provider` so Brave rows can be expired per its transient-storage rule.

---

### 3.7 GetSongBPM (api.getsong.co) + tunebat / songbpm viability

#### TL;DR
- Live host: `https://api.getsong.co/` (docs changelog 1.2, 25/09/2024). Old host `api.getsongbpm.com` does NOT redirect for curl; it returns a Cloudflare managed challenge (403, `cf-mitigated: challenge`). Do not use the old host.
- Free, but key-gated; key issuance requires an email AND a backlink URL that already exists.
- Without a key: HTTP 401 + `{"error":"API Key is missing."}`; with a bad/inactive key: HTTP 401 + `{"error":"Invalid API Key, or inactive."}`. Bodies are JSON but `Content-Type: text/html; charset=UTF-8`.
- Documented limit: 3000 requests/hour per key; exceeding blocks the key for one hour. No rate-limit headers observed on any response.
- Sample-set coverage: UNTESTED (needs key).

#### Where the documentation came from (important caveat)
- `https://getsongbpm.com/api` (and `/`, `/robots.txt`) → HTTP 403 with `cf-mitigated: challenge` ("Just a moment...") for a plain curl GET AND for the WebFetch tool. Not circumvented.
- `https://getsong.co/api` → HTTP 200 but it is an OVHcloud "Site en construction" placeholder page, not docs.
- Docs text below is quoted from the Internet Archive snapshot dated **Mon, 24 Aug 2026 15:13:51 GMT** (`http://web.archive.org/web/20260824151351id_/https://getsongbpm.com/api`, 200, 39,898 bytes). CDX lists 200-status snapshots on 2025-06-05, 2025-08-29, 2026-03-12, 2026-06-28, 2026-08-24, so the page is stable and 13 days old at time of probe.

#### Signup (verbatim from docs)
Signup URL: `https://getsongbpm.com/api` (form `<form action="/api" method="post" id="form">` on that page; browser required because of the Cloudflare challenge). Fields:
- `getKey` — label "Website URL or App ID/Package Name:" — "Prepend Android Package name with android-app:// and iOS App ID with ios-app://. (ex. android-app://com.package_name, ios-app://app_id)."
- `getBl` — label "Backlink URL:" — "**A backlink is mandatory**, please add it before requesting access."
- `getEmail` — label "Email:" — "A valid email is required to activate your API Key."
- submit `getapikey` value "Get API Key".

Intro text: "Any application can access our API endpoints, but must first be registered with a valid email address. To register your application, fill in the form on the left (or top on mobiles) of this page."

#### Attribution / backlink requirement (verbatim)
Callout box: "Using our API is free but a link back to GetSongBPM.com is REQUIRED (website or store listing), or we will suspend your account without notice."

Introduction paragraph: "Whether your project is under development, for private use, educational or commercial purposes, adding a backling [sic] to getsongbpm.com is mandatory. We have no way of getting around this restriction. We're sorry for the inconvenience, but there's been way too much abuse. The API is free, the only thing we ask in return is a link to support us. Thank you for your understanding."

Observations: the docs prescribe NO specific anchor text, NO specific href beyond "GetSongBPM.com"/"getsongbpm.com", and contain NO HTML snippet. The requirement is simply a visible link to `https://getsongbpm.com` on the website or store listing, and that URL must be given on the signup form. Note "private use" is explicitly NOT exempt.

#### Base, auth, rate limits (verbatim)
- Web API Base URL: `https://api.getsong.co/`
- Method: `GET`
- Authorization: "A valid API Key must be sent with all client requests, either via URL_PARAM (`api_key`), or a `X-API-KEY` header parameter."
- "**Unauthenticated requests are not allowed and a limit of 3000 requests per hour is applied.** (If you exceed this number, your key will be blocked for one hour.)"
- Observed: both `?api_key=` and `X-API-KEY:` header paths are honoured (same 401 "Invalid API Key, or inactive." body for a bogus value via either route). No `x-ratelimit-*` / `retry-after` headers on any response. 429 behaviour: UNTESTED (needs key).

#### Endpoint reference (from docs)
| Endpoint | Params | Returns |
|---|---|---|
| `/search/` | `type` (required): "song", "artist" or "both". `lookup` (required): song title (urlencoded) or artist name, depending on type. For "both", prepend terms: `lookup=song:enter+sandman artist:metallica`. `limit` (optional; default 10 for "both", 20 for "artist", 30 for "song") | Array of song(s) or artist(s) matching your query, wrapped as `{"search":[...]}` |
| `/artist/` | `id` (required): artist ID | Artist infos |
| `/song/` | `id` (required): song ID | Details about a song, wrapped as `{"song":{...}}` |
| `/tempo/` | `bpm` (required): target BPM (allowed range 40–220). `limit` (optional; by default limited to the 250 most viewed songs in the last 30 days) | Songs in the defined BPM or BPM range |
| `/key/` | `key_of` (required): Key to find (0: C, 1: C♯, etc.). `mode` (required): Major (1) or Minor (0). `type` (optional): notation "flat" or "sharp" (default). `limit` (optional; default 250 most viewed in last 30 days) | Songs in the specified Key |

Correction to the brief: the key endpoint's parameter is `key_of` + required `mode`, not `key=`.

Error contract (docs): "On success, the HTTP status code in the response header is 200 OK and the response body contains an array of values in JSON format. On error, the header status code is an error code and the response body contains an error." Observed error shape is `{"error":"<message>"}`. An unknown path (e.g. `/nonexistent/`) returns an Apache-style HTML 404 (`text/html; charset=iso-8859-1`), not JSON.

#### Response objects (field names copied from docs tables and the docs' example JSON)
**Search object, "both"/"song" type** — list of Song objects. **"artist" type** — list of Artist objects.

**Song object** (`/song/` returns `{"song": {...}}`; `/search/` returns `{"search": [ {...}, ... ]}`):
- `id` String — "The GetSong ID for the song."
- `title` String
- `uri` String — e.g. `https://getsongbpm.com/song/master-of-puppets/o2r0L`
- `tempo` — table says "Integrer" but the docs' own example shows **`"tempo":"220"` (a STRING)**. Coerce with `Number()`.
- `time_sig` — table says "Integrer (beta)" but example shows **`"time_sig":"4/4"` (a STRING)**.
- `key_of` String — "Original published key of the song." e.g. `"Em"`
- `open_key` String — "Key name in open key notation (Traktor)." e.g. `"2m"`
- `danceability` Integer 0–100 (example `55`; changelog says "via acousticbrainz")
- `acousticness` Integer 0–100 (example `0`)
- `artist` object — same as Artist object minus `similar`: `id`, `name`, `uri`, `genres` (array of strings, e.g. `["heavy metal","rock"]`), `from` (e.g. `"US"`), `mbid` (MusicBrainz artist id)
- `album` object `{ title: string, uri: string, year: integer }` — listed in the table but ABSENT from the `/song/` example response; treat as optional.

**Artist object**: `id`, `name`, `uri`, `genres` (array), `from` ("Country or region/city of origin"), `mbid` ("MusicBrainz ID"), `similar` (array of 5 artist objects without `similar`).

**Tempo object** (`/tempo/`): `song_id`, `song_title`, `song_uri`, `tempo`, `artist`, `album`.

**Key object** (`/key/`): `song_id`, `song_title`, `song_uri`, `music_key` `{ raw: input query, key_of: English name of the Key, mode: "major" | "minor" }`, `artist`, `album`.

Docs example (verbatim):
```
curl -X GET "https://api.getsong.co/song/?api_key=YOUR_API_KEY_HERE&id=o2r0L"
{"song":{"id":"o2r0L","title":"Master of Puppets","uri":"https://getsongbpm.com/song/master-of-puppets/o2r0L","tempo":"220","time_sig":"4/4","key_of":"Em","open_key":"2m","danceability":55,"acousticness":0,"artist":{"id":"nZR","name":"Metallica","uri":"https://getsongbpm.com/artist/metallica/nZR","genres":["heavy metal","rock"],"from":"US","mbid":"65f4f0c5-ef9e-490c-aee3-909e7ae6b2ab"}}}
```

Changelog (docs): 1.3 (11/12/2024) added `danceability`/`acousticness` and `similar`; 1.2 (25/09/2024) new domain `https://api.getsong.co`, "Api calls using the old base url are automatically redirected" (NOT what curl observes today), removed album cover / artist photo links; 1.1.2 (23/03/2022) `limit` param; 1.1.1 (12/11/2019) `/key/`; 1.1 (01/08/2019) `/tempo/`; 1.0 (02/02/2017).

#### Observed HTTP behaviour (all real requests)
| Request | Observed |
|---|---|
| `GET https://api.getsong.co/search/?api_key=INVALID&type=both&lookup=song:the%20lovecats%20artist:the%20cure` | 401, `text/html; charset=UTF-8`, body `{"error":"Invalid API Key, or inactive."}`, `access-control-allow-origin: *` |
| `GET https://api.getsong.co/search/?type=both&lookup=...` (no key) | 401, body `{"error":"API Key is missing."}` |
| `GET https://api.getsong.co/search/?type=song&lookup=fever` with `X-API-KEY: INVALID` | 401, body `{"error":"Invalid API Key, or inactive."}` |
| `/song/?api_key=INVALID&id=983pJ`, `/tempo/?api_key=INVALID&bpm=120`, `/key/?api_key=INVALID&key=1&mode=1`, `/artist/?api_key=INVALID&id=abc`, `/` | all 401 with the same `{"error":"Invalid API Key, or inactive."}` (root without key: `{"error":"API Key is missing."}`) |
| `GET https://api.getsong.co/nonexistent/?api_key=INVALID` | 404, Apache HTML "404 Not Found", `text/html; charset=iso-8859-1` |
| `OPTIONS https://api.getsong.co/search/...` with `Origin: http://localhost:3000` | 401, `access-control-allow-origin: *`, no `access-control-allow-headers` |
| `GET https://api.getsongbpm.com/search/?api_key=INVALID&...` | 403, `cf-mitigated: challenge`, HTML "Just a moment..." |
| `GET http://api.getsongbpm.com/...` (plain http) | 301 → `https://api.getsongbpm.com/...` (same host, which then challenges) |
| DNS | `api.getsongbpm.com` → 104.26.0.33 / 172.67.74.170 / 104.26.1.33; `api.getsong.co` → 104.21.11.90 / 172.67.165.179 (both Cloudflare) |

Other headers on api.getsong.co responses: `server: cloudflare`, `cf-cache-status: DYNAMIC`, `content-security-policy: block-all-mixed-content; default-src 'self';`, `strict-transport-security: max-age=16000000`, `set-cookie: HttpOnly;Secure` (empty cookie), `vary: X-FORWARDED-PROTO`.

#### Coverage over the sample set
| # | Track | Result |
|---|---|---|
| 1–15 | The Cure — The Lovecats … Lawrence Arabia — Apple Pie Bed | UNTESTED (needs key). Every search returns 401 without a valid key; the public website that would show the same data is behind a Cloudflare challenge. |

#### Auth / CORS
- Auth: `api_key` query param OR `X-API-KEY` header. Prefer the header so the key never appears in URLs, logs, or cache keys.
- CORS: `access-control-allow-origin: *` on every response, but no `access-control-allow-headers`, so a browser call using the `X-API-KEY` header would likely fail preflight. Irrelevant for It Stings (server-side proxy).

#### Alternatives checked (facts only)
- **tunebat.com**: `GET https://tunebat.com/Search?q=lovecats` → 403 `cf-mitigated: challenge`; `/robots.txt` → 403 challenge; `api.tunebat.com` resolves (104.26.2.91 / 172.67.72.16 / 104.26.3.91) but `GET https://api.tunebat.com/api/tracks/search?term=lovecats` → 403 challenge. HTML-only behind Cloudflare managed challenge; no keyless JSON API reachable. Not viable.
- **songbpm.com**: `GET https://songbpm.com/` → 200 `text/html`, Astro v6.4.8 site (server: cloudflare, no challenge). Search is `<form id="search-form" action="/searches" method="POST">`; `GET /searches?q=lovecats` with `Accept: application/json` → 404 HTML. The only "api_host" string in the page is PostHog analytics (`https://us.i.posthog.com`). `https://songbpm.com/api` is a 200 HTML artist page ("songs by Api"), not an API. robots.txt carries Cloudflare Content-Signal `search=yes, ai-train=no, use=reference`. No JSON API; HTML-only. Not viable keyless.
- npm registry search for "getsongbpm" → `total: 0`; PyPI `getsongbpm` → 404 (PyPI `getsong` is an unrelated YouTube downloader). No maintained wrapper to crib types from; hand-write the client.

#### Recommended usage in It Stings
1. Wire as an OPTIONAL fallback gated on `GETSONGBPM_API_KEY` (env). If unset, the tempo provider is simply not registered; never call the API without a key (it is a guaranteed 401 and the docs say unauthenticated requests are not allowed).
2. Server route only (`/api/tempo/...`), send `X-API-KEY` header, base `https://api.getsong.co/`. Never touch `api.getsongbpm.com`.
3. Lookup: `GET /search/?type=both&lookup=song:<title> artist:<artist>&limit=5` (URL-encode the whole `lookup` value; the docs' own example keeps a literal space between the `song:` and `artist:` parts). Pick the best `search[]` entry by normalized title + `artist.name` match; read `tempo`, `key_of`, `open_key`, `time_sig`, `artist.mbid`, `id`, `uri`.
4. Parse the body with `JSON.parse` regardless of `Content-Type` (it is `text/html`). Treat any non-200 as failure; specifically map `401` + `error` in {"API Key is missing.", "Invalid API Key, or inactive."} to a `keyMissing` state, log once, and disable the provider for the process lifetime rather than retrying per track.
5. Coerce `tempo` with `Number(String(tempo))`; guard `time_sig` as a string like "4/4"; treat `album` as optional.
6. Cache in SQLite by normalized (artist, title) with a long TTL (BPM does not change) and cache negatives for ~30 days; this keeps well inside 3000 req/hour. Add a local limiter anyway (e.g. ≤ 2 req/s).
7. Attribution: render a persistent, visible link to https://getsongbpm.com (footer or Settings/About page). Provide that page's public URL (or the project's public README/repo page) in the `getBl` "Backlink URL" field at signup, since the form requires an existing backlink before a key is issued. Suggested snippet:

```html
<a href="https://getsongbpm.com" target="_blank" rel="noopener">BPM &amp; key data provided by GetSongBPM.com</a>
```

Optionally, when showing a tempo from this provider, link the track to the returned `uri` (e.g. `https://getsongbpm.com/song/<slug>/<id>`) so the backlink is contextual as well as global.

---

### 3.8 Toolchain
The Node/Next/better-sqlite3/SDK probe is not an HTTP API; its full findings are in section 8.

---

## 4. Join keys — how a track flows between services

There is **no ISRC on iTunes**, so the chain the brief assumed (iTunes → ISRC → Deezer → MusicBrainz → AcousticBrainz) does not exist as written. The observed working chain is:

```
user query ("artist title")
   ├─► iTunes /search ............ trackId + country, previewUrl, artworkUrl100, trackTimeMillis   (no ISRC; join back by artist+title+duration only)
   └─► Deezer /search ............ id, isrc, duration, preview (15-min), md5_image
            └─► Deezer /track/{id} ... bpm, gain, release_date, available_countries
                  └─► MusicBrainz /isrc/{isrc} ... recording MBID(s), first-release-date, length
                        ├─► MusicBrainz /recording/{mbid}?inc=tags+genres+isrcs ... tags[], genres[], all isrcs[]
                        └─► AcousticBrainz /count → /low-level → /high-level ... rhythm.bpm, tonal.key_*, classifiers
   (optional, needs key) Spotify /v1/search?q=isrc:<isrc>&type=track ... Spotify id/uri (documented, UNTESTED)
```

### Observed hit rate at each hop (15-track sample)

| Hop | Hit rate | Evidence / caveats |
|---|---|---|
| query → iTunes `/search` (US and GB) | **15/15** in both storefronts; 30/30 matches have `previewUrl` + `artworkUrl100` | Top hit is frequently a compilation or variant (Sade "(Single Version)", Golden Brown "(Slowed Down Version)" at rank 1, Prima "(1996 Remaster)" at rank 1). 7/15 have different `trackId` in GB vs US. |
| query → Deezer `/search` (plain `"artist title"`) | **15/15 found**; 12/15 top hit = correct studio recording, 2/15 remaster/edit of it (Psycho Killer, Smooth Operator), 1/15 wrong version (Lone Digger → 2025 "(Mixed)") | Partial-word typeahead works (`loveca` → The Lovecats). Advanced `artist:"" track:""` syntax was worse in 5/15, better in 1/15 (rescued Lone Digger). |
| Deezer item → ISRC | **24/24** ids carried `isrc` (also present in search items — no `/track` call needed for the ISRC) | The ISRC identifies the *edition* Deezer returned: remasters (USCA29900213, GBARL1100319, USLQB1500001), live (ATE611500048, US3P60477013) and regional duplicates (HB0NZ0900003) carry different ISRCs than the original. |
| iTunes ⟷ ISRC | **0/2** — `/lookup?isrc=` returned 0 for USUM71900764 and GBALB8300001 | Join iTunes to Deezer/MB by normalized artist+title and `trackTimeMillis` within ~2 s of Deezer `duration`×1000 / MB `length`. |
| ISRC → Deezer `/track/isrc:{isrc}` | 5/5 round-trips | Returns an *arbitrary* duplicate (GBALB8300001 → 1126164 with 64 countries, not search's 1143631 with 188). |
| ISRC → MusicBrainz recording MBID | **13/15** (ISRCs from Deezer's *advanced-syntax* top hits) | Misses: USCA29900213 (Prima 1999 remaster) and HB0NZ0900003 (Apple Pie Bed NZ dup) → 404. The plain-search ISRCs for those tracks (NLG620480565, GBBRP0922203) were **not tested**. One ISRC can map to several recordings (bad guy → 3, Golden Brown → 2). 12 of ~45 MB requests needed a retry after 503. |
| MB search fallback (`recording:"…" AND artist:"…"`) | recovered both 404s and the canonical recordings for Zoot Suit Riot (1997), Booty Swing (studio), Mr. Pinstripe Suit (studio 1998) | Search returns multiple score-100 recordings; needs duration / `first-release-date` / `status:"Official"` tie-breaks. Search results carry no `isrcs`/`tags`/`genres`. |
| MBID → MB tags/genres | **3/3 tested** (Lovecats 17 tags / 11 genres; Psycho Killer 11 / 6; vampire 2023: 3 / 3) | `genres[]` populated even for the 2023 track. |
| MBID → AcousticBrainz data | **10/15 via the ISRC-resolved MBIDs alone; 14/15 after trying all MB-search candidates** through bulk `/count` | AB coverage is per *recording*: the ISRC MBID for Zoot Suit Riot (20th-anniversary remix) has 0 submissions while the 1997 recording has 63; Booty Swing's adv-syntax ISRC hits the live recording (2 subs) — but its plain-search ISRC ATE611000013 maps to studio recording 123f59a2 with 48 subs [corrected in verification]; the 1958 Fever original has 0 (only a 1987 re-recording has data). Always check every candidate MBID. |
| ISRC → Spotify id | documented (`q=isrc:` filter) — **UNTESTED (needs key)** | Keyless bridges: Wikidata P2207 resolved 1/4 attempted before 429; Odesli is dead (401 `PUBLIC_API_ACCESS_DEPRECATED`). |

### Where the chain breaks for post-2022 tracks
- **Olivia Rodrigo — vampire (2023)**: iTunes ✔ (but `cleaned` edit only from this IP) → Deezer ✔ (`bpm: 0` on both ids 2440763155 / 2713054981) → ISRC USUG12304091 → MB ✔ (0c846a8e-debd-4a63-bb93-6c57f5178b45, tags `ballad`, `pop`, `pop rock`) → **AcousticBrainz: count 0, low-level 404, high-level 404**. The chain ends at AB; there is no BPM/key from any keyless source for this track.
- **Kali Uchis — telepatía (Nov 2020)**: Deezer `bpm: 0`, but AB still has 8 submissions (bpm 84.0, B minor). Late-2020 is inside the AB window; expect coverage to fade for anything released after ~2021.
- AcousticBrainz's homepage states data collection stopped in 2022; treat AB as a frozen archive and plan a non-AB tempo path (Deezer `bpm`, GetSongBPM, or a local analyser) for new releases.

### Practical join rules (derived from the observations above)
1. Pick the Deezer hit with empty/absent `title_version` (reject `(Live…)`, `(Mixed)`, `(Remaster…)`, `(Anniversary…)`, `Karaoke`), then highest `rank`; keep its `isrc` and `duration`.
2. Resolve the ISRC in MB; if 404 or the returned recording's `disambiguation`/`first-release-date` looks like a remaster/live edition, fall back to MB search and choose by `length` ≈ duration and earliest `first-release-date` on an Official release.
3. Collect *all* candidate MBIDs (ISRC hits + search hits) and send them to AB bulk `/count` (≤25 per call) before fetching features.
4. Join iTunes separately by artist+title+duration; persist `(trackId, country)` together.
5. Use MB `first-release-date` for the song's year — iTunes `releaseDate` (5/15 wrong) and Deezer `release_date` (both track and album level) are edition dates.

---

## 5. Preview audio

| Source | URL / how obtained | Signed / expiring? | Cacheable? | CORS / Range evidence | Format |
|---|---|---|---|---|---|
| **Deezer** `preview` (search item or `/track/{id}`) | `https://cdnt-preview.dzcdn.net/api/1/1/<hash>.mp3?hdnea=exp=<epoch>~acl=<path>*~data=user_id=0,application_id=42~hmac=<64 hex>` | **Yes** — `exp` = response `Date` + exactly 900 s (measured on three mints; `hmac` differs per mint, path hash stable). Tampered `exp` → 403; stripped query → 403. | **URL: no** (never persist beyond ~14 min; store the Deezer id and re-mint via `/track/{id}` or a fresh search). **Bytes: yes** — `cache-control: public, max-age=12960000`, ~480 KB per track, so a server-side blob cache is possible. | `access-control-allow-origin: *`, `access-control-allow-headers: Range`, `accept-ranges: bytes`; `Range: bytes=0-1000` → **206** `content-range: bytes 0-1000/479827`; `server: Google Frontend` | `audio/mpeg`, 479,827 bytes (30 s @ 128 kbps), ID3v2.4 header `49 44 33 04` |
| **iTunes** `previewUrl` | `https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview…/mzaf_<id>.plus.aac.p.m4a` | **No** signature or expiry parameter observed in the URL | **Yes** — `cache-control: public, max-age=30761274`; URL is storefront-specific (different `mzaf_` ids for US vs GB) | `access-control-allow-origin: *`, `access-control-allow-headers: range`, `access-control-allow-methods: HEAD, GET, PUT`, `accept-ranges: bytes`; `Range: bytes=0-1023` with `Origin: http://localhost:3000` → **206** `content-range: bytes 0-1023/974850` | labelled `audio/x-m4p` but bytes are `ftypM4A` (plain AAC in M4A), ~0.97–1.06 MB (30 s). From this IP explicit songs are the **clean** edit. |
| **Spotify** `audioPreview.url` from the embed page's `__NEXT_DATA__` | `https://p.scdn.co/mp3-preview/<hash>` | Not observed as signed (URL has no token) | Bytes: `Cache-Control: max-age=604800, no-transform`; but this is an **undocumented page internal** and the API reference says "Audio Preview Clips may not be offered as a standalone service or product." `preview_url` in the Web API is **Deprecated**. | `Access-Control-Allow-Origin: *`, `Accept-Ranges: bytes`; HEAD 200, range GET → 206 (ID3) | `audio/mpeg`, 359,956 bytes |
| **Spotify embed iframe** | `https://open.spotify.com/embed/track/{id}` (also `iframe_url`/`html` from `open.spotify.com/oembed?url=…`) | n/a | oEmbed JSON is CORS `*` and cacheable by us (no `cache-control` sent); embed page is `cache-control: private, no-cache, no-store` | No `x-frame-options` / frame-ancestors observed → embedding allowed | Player UI is client-rendered; whether it plays 30 s or full song / needs login is **UNTESTED**. Returns 200 even for bogus IDs — validate the id via oEmbed first. |

**Browser playback:** none of the previews was played in an actual browser during recon; the CORS/Range headers above are the evidence that `<audio src>` from `http://localhost:3000` (or `127.0.0.1`) can fetch and seek them.

**Fallback order (as specified by the orchestrator): Deezer → iTunes → Spotify embed → none.**
- Deezer first: MP3, 128 kbps, browser-fetchable straight from the signed URL; the server must hand the client a URL minted <14 min ago (or proxy/blob-cache the bytes).
- iTunes second: the only preview whose URL can be stored long-term; AAC/M4A; keep `(trackId, country)` because the URL differs per storefront; explicit songs will be clean edits when the app runs from SA.
- Spotify embed third: keyless iframe when a Spotify id is known (from Wikidata P2207, a keyed `/v1/search`, or a stored id); no data contract, no confirmed playback behaviour.
- None: show the `https://open.spotify.com/search/<artist> <title>` deep link (200, client-rendered shell, valid link target only).

---

## 6. Tempo (BPM)

**Never fabricate a tempo.** If no source below returns a nonzero BPM for a track, the app stores `bpm = null` / "unknown" and shows nothing — it must not estimate, average across unrelated editions, or let the model guess.

### Where BPM can come from

| Source | Field | Keyless? | Coverage on the sample | Caveats |
|---|---|---|---|---|
| Deezer `GET /track/{id}` | `bpm` (float or int; `0` = unknown; never null/absent in 24/24) | yes | plain top hit: **12/15** nonzero; best available id: **13/15**; all 24 ids fetched: 17 nonzero / 7 zero | Attached to the Deezer **track id**, not the recording: same ISRC USEM39700073 is 106.8 on 2184700 and 0 on 1761439787; Apple Pie Bed 126.8 vs 0. Try sibling ids with the same `isrc` when 0. Not in search items, `/artist/{id}/top` or `/album/{id}` tracks. |
| AcousticBrainz `low-level` | `rhythm.bpm` (float), plus `tonal.key_key`, `tonal.key_scale`, `tonal.key_strength`, `rhythm.danceability` | yes (frozen since 2022) | **10/15** via ISRC-resolved MBIDs; **14/15** with MB-search candidates | Multiple submissions per MBID disagree by ~0.1 bpm (Lovecats n=0..251: 91.677 / 91.753 / 91.678 / 91.732); use `n=0` or vote. Coverage is per recording — the 1958 Fever original has 0 (a 1987 re-recording has 136.2); studio Booty Swing has 0 (live has 113.1). Nothing post-2022. |
| GetSongBPM `GET /search/` → `tempo` | `tempo` (**string**, e.g. `"220"`), `key_of`, `open_key`, `time_sig` (string `"4/4"`), `danceability`, `acousticness` | **no** — key + mandatory backlink | **UNTESTED (needs key)** | Coerce with `Number()`. 3000 req/hour documented, no headers. Host `api.getsong.co`. |
| Spotify `GET /v1/audio-features/{id}` (`tempo`, `key`, `danceability`, `energy`, …) | — | no | **Deprecated** badge on the reference page; unauthenticated call → 401 | Not available to Development Mode apps created after 2024-11-27; do not build on it. |
| tunebat / songbpm | — | no API | not reachable (Cloudflare challenge / HTML only) | — |

### Cross-source agreement (Deezer `bpm` vs AcousticBrainz `rhythm.bpm`, values as observed)

| # | Track | Deezer bpm (id) | AB rhythm.bpm (MBID) | Note |
|---|---|---|---|---|
| 1 | The Lovecats | 91.9 (1143631) | 91.7 (1c19fbb9) | agree |
| 2 | Jump, Jive an' Wail | 102.1 (14719906) | 101.5 (b89ccfb7, via MB search) | agree |
| 3 | Zoot Suit Riot | 91.9 (69256670) | 91.9 (b944f19c, via MB search) | agree |
| 4 | Lone Digger | 124.2 (109590416, adv-syntax id) / **0** (plain top hit 3392254691 "(Mixed)") | 123.7 (5f926e49) | agree once the right Deezer id is chosen |
| 5 | Hell | 100.11 (129634398) | 102.0 (d61f5090) | ~2 bpm apart |
| 6 | Fever | 137.4 (3124340, 1958 recording) | 136.2 (a38234ef, 1987 re-recording) | different recordings; 1958 original absent from AB |
| 7 | Psycho Killer | 123 (747527, 2003 remaster) | 123.5 (e66ea0ae) | agree |
| 8 | bad guy | 135.11 (655095912) | 135.1 (694da04d) | agree |
| 9 | vampire | **0** (both ids) | **none** (AB count 0) | **no BPM from any keyless source** |
| 10 | Smooth Operator | 119.2 (10686127) / 119.8 (1030591232) | 119.2 (34f59f6d) | agree |
| 11 | Booty Swing | 113 (13851424) / 0 (live 3677797302) | 113.1 (676b97c5, live recording) | agree across editions |
| 12 | Golden Brown | 187.1 (3152622) | 184.6 (c7d0bf6e) | both report the double-time (waltz) figure |
| 13 | telepatía | **0** (1148585682) | 84.0 (2fc3283f) | AB only |
| 14 | Mr. Pinstripe Suit | 106.8 (2184700) / 0 (1761439787) | 107.6 (05f63c90 studio) / 104.6 (79955480 live) | agree for the studio recording |
| 15 | Apple Pie Bed | 126.8 (69002469) / 0 (3049462741) | 126.9 (ebdbf232, via MB search) | agree |

**Combined keyless coverage: 14/15 tracks have a BPM from at least one of Deezer or AcousticBrainz; only vampire (2023) has none.** Where both sources exist they agree within ~0.5 bpm in 11 cases, within ~2.5 bpm for Hell and Golden Brown, and Fever differs because AB only has a different recording.

### Recommended resolution order
1. Deezer `bpm` from the chosen id; if `0`, try other Deezer ids sharing the `isrc` (from search results).
2. AcousticBrainz `rhythm.bpm` (n=0) for any MBID with `count > 0`, preferring the MBID whose `length` matches the Deezer duration; record which MBID/recording the value came from (it may be a re-recording, as with Fever).
3. GetSongBPM only when `GETSONGBPM_API_KEY` is set (UNTESTED).
4. Otherwise `null`. Persist the source name alongside the value so the UI can attribute it (GetSongBPM requires a backlink anyway).

---

## 7. Channel B (forum evidence)

**Reddit block — confirmed on every unauthenticated path**
- `GET https://www.reddit.com/r/ifyoulikeblank/search.json?q=lovecats&restrict_sr=1` → **HTTP 403**, `content-type: text/html`, 189,908-byte HTML block page (not JSON), `retry-after: 0`, `server: snooserv`, `cache-control: private, no-store`.
- `GET https://old.reddit.com/r/ifyoulikeblank/` → **HTTP 302** → `https://old.reddit.com/login/?reason=lor2&dest=…` (login wall).
- `POST https://www.reddit.com/api/v1/access_token` (`grant_type=client_credentials`, no creds) → **HTTP 401** `{"message": "Unauthorized", "error": 401}`, `www-authenticate: Basic realm="reddit"` — reachable but needs a registered app.
- Reddit Data API terms (HTTP 200): commercial use, research beyond rate limits, or anything not expressly permitted "will need to enter into a separate agreement with Reddit"; the licence is only to copy/display User Content "solely as necessary to develop, deploy, distribute, and run your App"; no ML/AI training use; no deriving revenue without written approval.
- One plain request per path, no UA spoofing, no retries (ground rules).

**rateyourmusic.com** → HTTP 403, `server: cloudflare`, `cf-mitigated: challenge`, "Just a moment..." JS challenge. Not fetchable server-side either.

**Chosen search provider and fallback**
1. **Tavily** (primary, `TAVILY_API_KEY`) — `POST https://api.tavily.com/search`, `Authorization: Bearer <key>`, body `{"query": "\"<title>\" \"<artist>\" songs like OR similar OR \"sounds like\"", "include_domains": ["reddit.com"], "exact_match": true, "search_depth": "basic", "max_results": 10, "include_raw_content": "markdown"}`. 1,000 credits/month free, no card; `basic` = 1 credit; 100 RPM dev key; 429 carries `retry-after`; 432/433 = plan/PayGo limits. Terms (May 4, 2026) contain no retention clause → results may be cached in SQLite.
2. **Brave Search API** (fallback, `BRAVE_SEARCH_API_KEY`) — `GET https://api.search.brave.com/res/v1/web/search?q=site:reddit.com "<title>" "<artist>"…&count=10&extra_snippets=true&text_decorations=false&result_filter=web,discussions`, header `X-Subscription-Token`. $5/month free credits ≈ 1,000 queries but a card is required; 50 QPS; auth errors are HTTP 422. ToS forbids storing/caching results beyond transient storage → Brave evidence rows must be short-lived (tag rows with `provider` and expire them).
3. **Exa** (optional, `EXA_API_KEY`) — best extraction (`contents.text` ≤10k chars, `highlights`) and $20 signup + $10/month credits, but ToS 4.2(a) bars storing results and a missing key returns HTTP 402 (x402 challenge).
4. **Serper** — skip (snippets only; scrape host = proxied Reddit scraping).

**What each provider returns for reddit.com URLs (documented; UNTESTED without keys)**
- Tavily: `results[].content` — up to `chunks_per_source` (≤3) query-relevant chunks of ≤500 chars each, formatted `<chunk 1> [...] <chunk 2>`; `results[].raw_content` — full cleaned page as markdown/text when `include_raw_content` is set; plus `title`, `url`, `score`, `favicon`, `id`. Both are produced by Tavily's crawler/index; the app never touches reddit.com. `/extract` (5 URLs per credit) for full threads.
- Brave: `web.results[].description` + `extra_snippets[]` (≤5 excerpts), `discussions.results[]` ("Discussions clusters aggregated from forum posts") and `query.reddit_cluster`; full extracted text only via `/res/v1/llm/context` → `grounding.generic[].snippets[]` ("extracting forum discussions (e.g. from Reddit)"; billing for that endpoint UNVERIFIED).
- Exa: `results[].text`, `highlights[]`, `highlightScores[]`, `summary`, `publishedDate`, `author` with `includeDomains: ["reddit.com"]` (path prefixes like `reddit.com/r/ifyoulikeblank` allowed).
- Serper: `organic[].snippet` only.

**Legal boundary**
- No Reddit HTML scraping, ever — not directly (403/302 anyway), not through Serper's `scrape.serper.dev`, not through any proxy. Reddit thread text enters the app only as a search provider's own extraction output.
- No rateyourmusic scraping (Cloudflare challenge; same rule).
- No www.last.fm HTML scraping (Last.fm ToS 2.6).
- Brave and Exa results may not be persisted beyond transient use per their terms; Tavily's may.
- Sample-set coverage for Channel B is **UNTESTED** for every provider until a key exists.

---

## 8. Toolchain

Probed on macOS 15.5 (24F74) arm64, Xcode CLT at `/Library/Developer/CommandLineTools`, Python 3.13.5, **Node v24.20.0, npm 11.19.0** at `~/.local/bin`. Probe app left at `/private/tmp/claude-501/-Users-aalomrani-Desktop-Side-Chicks-It-Stings/d1c2d915-622a-4a26-95b1-706b30e6c6b0/scratchpad/toolchain-probe/probe-app` (574 MB; no server running). The project directory was not touched.

### Versions observed (`npm view … version`, 2026-09-06)
| package | latest | installed in probe | notes |
|---|---|---|---|
| next | **16.3.4** | 16.3.4 | dist-tags `latest=16.3.4`, `canary=16.4.0-canary.19`, `backport=15.5.25`, `next-15-3=15.3.9`. `engines.node >=20.9.0`. peerDeps: `react ^18.2.0 || 19.0.0-rc-de68d2f4-20241204 || ^19.0.0` (same for react-dom); optional `sass ^1.3.0`, `@playwright/test ^1.51.1`, `@opentelemetry/api ^1.1.0`, `babel-plugin-react-compiler *`. |
| react / react-dom | 19.2.8 | 19.2.8 | |
| better-sqlite3 | **13.0.3** | 13.0.3 | `engines.node >=22`; dep `node-addon-api ^8.0.0`; ships prebuilds; no bundled TS types. |
| @anthropic-ai/sdk | **0.124.0** | 0.124.0 | `type: commonjs` (also ships `.mjs`); optional peer `zod: ^3.25.0 || ^4.0.0`. |
| typescript | 7.0.2 (latest) | **5.9.3** | create-next-app template pins `^5`; TS 7 UNTESTED. |
| tailwindcss | 4.3.3 | 4.3.3 | template uses `@tailwindcss/postcss` + `postcss.config.mjs`. |
| zod | 4.5.4 | 4.5.4 | SDK's zod helper imports `zod/v4`; tsc passed. |
| vitest | 5.0.0 | not installed | UNTESTED. |
| @types/better-sqlite3 | 9.6.0 | 9.6.0 | required for tsc / next build. |
| eslint | 9.39.5 | 9.39.5 | npm warns "deprecated eslint@9.39.5: no longer supported"; still works. |
| @types/node | 20.19.43 | 20.19.43 | template pins `^20` even on Node 24. |

### create-next-app (worked exactly as given, exit 0, 47 s)
```
npx --yes create-next-app@latest probe-app --ts --app --eslint --tailwind --src-dir --import-alias "@/*" --use-npm --yes
```
Observed: template `app-tw`, `added 359 packages ... in 42s`, "Generating route types... Types generated successfully", **"Initialized a git repository."** (create-next-app runs `git init` + "Initial commit from Create Next App" inside the app dir — the project dir is currently not a git repo, so expect a nested `.git` to appear), 0 vulnerabilities. Generated: `AGENTS.md` ("<!-- BEGIN:nextjs-agent-rules --> # This is NOT the Next.js you know ... read node_modules/next/dist/docs/ ... re-added by `next dev`"), `CLAUDE.md` containing `@AGENTS.md`, `eslint.config.mjs` (flat config with `nextVitals`, `nextTs`, `globalIgnores([".next/**","out/**","build/**","next-env.d.ts"])`), `next.config.ts` (empty `NextConfig` object), `postcss.config.mjs`, `tsconfig.json` (strict, `moduleResolution "bundler"`, `paths "@/*": ["./src/*"]`, includes `.next/types/**/*.ts` and `.next/dev/types/**/*.ts`), `src/app/{favicon.ico, globals.css, layout.tsx, page.tsx}`, scripts `dev="next dev"`, `build="next build"`, `start="next start"`, `lint="eslint"`. **Turbopack is the default** for both `next dev` and `next build` (`▲ Next.js 16.3.4 (Turbopack)`), no flag needed.

### better-sqlite3 13.0.3 — prebuilt status
- `npm install better-sqlite3 @anthropic-ai/sdk zod --foreground-scripts`: exit 0, 3 s, "added 9 packages". **No prebuild-install and no node-gyp output**, `build/Release/` absent, because npm 11.19's new **`allowScripts` gate** skipped the install script with only `npm warn install-scripts …`. `npm install-scripts ls` reported `better-sqlite3@13.0.3 (install: node-gyp rebuild)` and `unrs-resolver@1.12.2 (postinstall: node postinstall.js)` "not yet covered by allowScripts". `npm config get ignore-scripts` = false (separate mechanism).
- Package layout: `prebuilds/{darwin-arm64,darwin-x64,linux-x64,linux-arm64,linuxmusl-x64,linuxmusl-arm64,win32-x64,win32-arm64}.node` inside the npm tarball; `prebuilds/darwin-arm64.node` is a 1,980,736-byte Mach-O 64-bit bundle arm64. No `prebuild-install` dependency. `lib/binding.js#getPrebuildPath()` returns `prebuilds/${platform}-${arch}.node`; `binding.gyp` sets `force_build%: 0` and `prebuild_exists%: <!(node lib/binding.js)` so the implicit `node-gyp rebuild` is a no-op when a prebuild exists.
- After `npm install-scripts approve better-sqlite3` (writes `"allowScripts": {"better-sqlite3@13.0.3": true}` to package.json; `--no-allow-scripts-pin` to unpin), `npm rebuild better-sqlite3 --foreground-scripts` took 3 s: node-gyp@12.4.0 downloaded `node-v24.20.0-headers.tar.gz` (200), make only `TOUCH`ed `.stamp` files — **no C++ compilation**, still no `build/Release/better_sqlite3.node`. **The prebuilt binary is what loads**; a compile only happens with `--force_build=1` or on an unsupported platform.
- Binding loads **lazily** at `new Database()`. `process.report.getReport().sharedObjects` lists `./node_modules/better-sqlite3/prebuilds/darwin-arm64.node`. Bundled SQLite **3.53.4**.
- Proof: `node sqlite-proof.cjs` → `{"node":"v24.20.0","arch":"arm64","row":{"id":1,"artist":"The Cure","title":"The Lovecats","year":1983,"sqlite":"3.53.4"}}` in 431 ms. ESM `import Database from 'better-sqlite3'` → `esm ok { one: 1 }`. Running the script from outside the app dir fails with MODULE_NOT_FOUND (normal resolution).
- Types: `npx tsc --noEmit` **failed** before `@types/better-sqlite3` with `error TS7016: Could not find a declaration file for module 'better-sqlite3'`; after `npm i -D @types/better-sqlite3` (9.6.0) → exit 0.

### Next.js route handler with better-sqlite3 + SDK import
`src/app/api/ping/route.ts`:
```ts
import Database from "better-sqlite3";
import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
export async function GET() {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)");
  db.prepare("INSERT INTO t (name) VALUES (?)").run("sting");
  const row = db.prepare("SELECT id, name, sqlite_version() AS sqlite FROM t").get();
  db.close();
  const sdkIsClass = typeof Anthropic === "function";
  return NextResponse.json({ ok: true, row, sdkIsClass, node: process.version, arch: process.arch });
}
```
- `npm run build`: exit 0, 5 s ("Compiled successfully in 2.6s", "Finished TypeScript in 658ms"; **no ESLint step during build in Next 16**). Routes: `○ /`, `○ /_not-found`, `ƒ /api/ping` (Dynamic — the GET handler is NOT prerendered, so the DB is not opened at build time). Zero native-module warnings.
- **Exact `next.config` needed: none.** `next.config.ts` stayed the scaffolded empty `const nextConfig: NextConfig = {};` — better-sqlite3 is already in Next's built-in `serverExternalPackages` list (`node_modules/next/dist/lib/server-external-packages.jsonc`, 79 entries, also `sqlite3`, `libsql`, `@libsql/client`, `prisma`, `@prisma/client`, `pg`, `sharp`). Adding `serverExternalPackages: ["better-sqlite3"]` is harmless but unnecessary in 16.3.4. `@anthropic-ai/sdk` and `zod` are NOT in that list and are bundled by Turbopack (route trace: 0 `@anthropic-ai` files, 26 `better-sqlite3` files); the built chunk externalizes as `require("better-sqlite3-90e2652d1716b047")`.
- Output file tracing (`route.js.nft.json`, 129 files) includes `node_modules/better-sqlite3/prebuilds/darwin-arm64.node` (so `output: "standalone"` would carry the binary; standalone itself UNTESTED).
- `PORT=3999 npm run dev`: "Ready in 234ms"; first `GET /api/ping` → 200 after 2 s (`GET /api/ping 200 in 321ms (next.js: 301ms, application-code: 20ms)`), later requests 2–3 ms; body `{"ok":true,"row":{"id":1,"name":"sting","sqlite":"3.53.4"},"sdkIsClass":true,"node":"v24.20.0","arch":"arm64"}`; `GET /` → 200 in 1.7 s. Server killed; `lsof -ti :3999` empty afterwards. `next dev` (re)writes the AGENTS.md block.

### @anthropic-ai/sdk 0.124.0 — structured output (from installed types; no API call made)
- `import Anthropic from '@anthropic-ai/sdk'` type-checks and bundles in a route handler (`typeof Anthropic === "function"` at runtime).
- `resources/messages/messages.d.ts`: `parse<Params extends MessageCreateParamsNonStreaming>(params, options?): APIPromise<ParsedMessage<…>>` — "along with an expected `output_config.format` and the response will be automatically parsed and available in the `parsed_output` property of the message." `stream(...)` → `MessageStream`; `await stream.finalMessage()` also carries `parsed_output`.
- `export interface OutputConfig { effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max' | null; format?: JSONOutputFormat | null; }`; `export interface JSONOutputFormat { schema: { [key: string]: unknown }; type: 'json_schema'; }`; `MessageCreateParams.output_config?: OutputConfig`. **No `output_format` / `response_format` top-level param exists.** Tools carry `strict?: boolean`.
- `export type Model = 'claude-fable-5-1' | 'claude-mythos-5-1' | 'claude-sonnet-5' | 'claude-fable-5' | 'claude-mythos-5' | 'claude-opus-5' | 'claude-opus-4-8' | 'claude-opus-4-7' | 'claude-mythos-preview' | 'claude-opus-4-6' | 'claude-sonnet-4-6' | 'claude-haiku-4-5' | ... | (string & {})`. `ThinkingConfigAdaptive { type: 'adaptive'; display?: … }` exists.
- `helpers/zod.d.ts`: `import * as z from 'zod/v4'`; `export declare function zodOutputFormat<ZodInput extends z.ZodType>(zodObject: ZodInput): AutoParseableOutputFormat<z.infer<ZodInput>>` (import path `@anthropic-ai/sdk/helpers/zod`). Beta variants `betaZodOutputFormat`, `betaZodTool` in `helpers/beta/zod.d.ts`. `lib/parser.d.ts`: `AutoParseableOutputFormat<ParsedT> = JSONOutputFormat & { parse(content: string): ParsedT }`; `ParsedMessage<ParsedT> = Message & { content: Array<ParsedContentBlock<ParsedT>>; parsed_output: ParsedT | null }`.
- **Approach for It Stings:** `client.messages.parse({ model, max_tokens, messages, output_config: { format: zodOutputFormat(MySchema) } })` and read `.parsed_output`; keep every SDK call inside server route handlers. The README (60 lines) does not document structured outputs; the types are the source of truth. Network behaviour UNTESTED (no key).

### Bonus: Node 24 built-in `node:sqlite`
`node -e "const {DatabaseSync}=require('node:sqlite'); …"` → `node:sqlite OK { a: 42, v: '3.53.4' }` — zero-native-dependency alternative at the same SQLite version. Its behaviour inside a Next/Turbopack route and its typings under @types/node 20 are UNTESTED.

### Timings
| step | time |
|---|---|
| npm view (9 packages + peerDeps + versions) | 10 s |
| create-next-app (incl. 359-package install) | 47 s |
| npm install better-sqlite3 @anthropic-ai/sdk zod | 3 s (install script skipped by allowScripts) |
| npm install-scripts approve + npm rebuild better-sqlite3 | 3 s (headers download + gyp no-op; no compile) |
| node sqlite-proof.cjs | 0.43 s |
| npm i -D @types/better-sqlite3 | 2 s |
| npx tsc --noEmit | 1 s |
| npm run build | 5 s |
| npm run dev → first 200 on /api/ping | 2 s |
| npm run lint | 2 s (only error: the probe's own `.cjs` file, `@typescript-eslint/no-require-imports`) |

Disk: `probe-app` 574 MB (node_modules 502 MB, .next 71 MB, 295 top-level packages).

### Recommended stack config (verified pieces only)
- `package.json`: `next 16.3.4`, `react`/`react-dom 19.2.8`, `better-sqlite3 ^13.0.3`, `@anthropic-ai/sdk ^0.124.0`, `zod ^4.5.4`, dev `@types/better-sqlite3 ^9.6.0`, `typescript ^5` (5.9.3), plus `"allowScripts": { "better-sqlite3@13.0.3": true }` (or run `npm install-scripts approve better-sqlite3`).
- `next.config.ts`: can stay empty; `serverExternalPackages: ["better-sqlite3"]` optional.
- Route handlers: default Node runtime; GET handlers are dynamic by default in Next 16 (no `force-dynamic` needed to avoid build-time DB access).
- Keep helper scripts ESM or outside ESLint's scope (`.cjs` files trip `@typescript-eslint/no-require-imports`). The gated `unrs-resolver` postinstall did not break ESLint (`@unrs/resolver-binding-darwin-arm64` is an optional dep).

---

## 9. Verified commands appendix

Every `verified_commands` entry from the eight probes, grouped by API, so anyone can re-run them. Format: command → what was observed on 2026-09-06. Replace `INVALID`/`BOGUS_…` with a real key to test success paths.

### 9.1 iTunes Search API
- `curl -s -D - "https://itunes.apple.com/search?term=the+cure+the+lovecats&entity=song&limit=3&country=US"` → 200 in 0.75 s; content-type text/javascript; charset=utf-8; access-control-allow-origin: *; cache-control: max-age=86400; content-disposition: attachment; filename=1.txt; body {resultCount:3, results:[31-key track objects]}; no isrc field; first result trackId 1288102536 The Cure - The Lovecats [Greatest Hits] trackTimeMillis 220093 releaseDate 1983-10-18T12:00:00Z
- `curl -s "https://itunes.apple.com/lookup?id=1288102536&entity=song"` → 200 in 0.57 s; resultCount 1; identical 31 keys to /search; no isrc field
- `curl -s "https://itunes.apple.com/lookup?isrc=USUM71900764"` (ISRC obtained live from https://api.deezer.com/track/655095912) → 200; {"resultCount":0,"results":[]} — also 0 with &country=GB, &entity=song, &entity=musicTrack&country=US
- `curl -s "https://itunes.apple.com/lookup?isrc=GBALB8300001"` (Lovecats ISRC from Deezer) → 200; resultCount 0
- `curl -s "https://itunes.apple.com/lookup?isrc=ZZZZZ9999999"` → 200; resultCount 0 (bogus ISRC indistinguishable from real one)
- `curl -s "https://itunes.apple.com/lookup?upc=603497862962"` → 200; resultCount 1; wrapperType collection, collectionType Album, The Cure - Greatest Hits, collectionId 1288102355
- `curl -s "https://itunes.apple.com/lookup?id=1288102536,1450695739,1541731262"` → 200 in 0.60 s; resultCount 3 (Lovecats, bad guy, telepatía) — comma-separated multi-id works
- `curl -s "https://itunes.apple.com/lookup?id=1288102536&country=GB"` → 200; resultCount 0 — US trackId does not resolve in GB storefront (GB Lovecats is trackId 1440932670)
- `curl -s -o art600.jpg -w "%{http_code} %{content_type} %{size_download}" "https://is1-ssl.mzstatic.com/image/thumb/Music124/v4/2c/6b/bb/2c6bbbb2-ae5c-57ac-55e9-d49efea7039e/603497862962.jpg/600x600bb.jpg"` → 200 image/jpeg 117267 bytes; JPEG SOF decoded to 600x600; headers access-control-allow-origin: *, cache-control: max-age=15167638, no-transform
- `curl -I ".../603497862962.jpg/1000x1000bb.jpg" ; curl -I ".../3000x3000bb.jpg" ; curl -I ".../600x600bb.webp"` → 200 image/jpeg 280688; 200 image/jpeg 946089 (ACAO * present on GET with Origin); 200 image/webp 33226
- `curl -I "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview221/v4/73/32/f4/7332f416-da6a-df1a-790a-fcb16ce5f28f/mzaf_2699192809001880041.plus.aac.p.m4a"` → 200; content-type audio/x-m4p; content-length 974850; accept-ranges: bytes; access-control-allow-origin: *; access-control-allow-headers: range; access-control-allow-methods: HEAD, GET, PUT; access-control-allow-credentials: false; cache-control: public, max-age=30761274
- `curl -s -H "Origin: http://localhost:3000" -H "Range: bytes=0-1023" -D - -o preview_head.bin <same previewUrl>` → 206; content-range: bytes 0-1023/974850; content-length 1024; access-control-allow-origin: *; first 12 bytes 00000018 66747970 4d344120 (ftypM4A)
- `curl -I -H "Origin: http://localhost:3000" <previewUrl of bad guy 1450695739> ; <previewUrl of telepatía 1541731262>` → 200 audio/x-m4p 1060807 bytes ACAO *; 200 audio/x-m4p 1040881 bytes ACAO *
- `curl -s -o /dev/null -D - -X OPTIONS -H "Origin: http://localhost:3000" -H "Access-Control-Request-Method: GET" "https://itunes.apple.com/search?term=psycho+killer&entity=song&limit=1"` → 200; access-control-allow-methods: GET,POST,HEAD,OPTIONS; access-control-allow-origin: *; access-control-allow-headers: *; access-control-max-age: 86400
- `curl -s -w "%{time_total}" "https://itunes.apple.com/search?term=loveca&entity=song&limit=5&country=US"` → 200 in 0.72 s; 5 results: Taylor Swift Lover / Cruel Summer / You Need To Calm Down, Adele Send My Love, Taylor Swift The Man — The Cure absent
- `curl -s -w "%{time_total}" "https://itunes.apple.com/search?term=jump+jive&entity=song&limit=5&country=US"` → 200 in 0.68 s; #1 The Brian Setzer Orchestra - Jump, Jive an' Wail, #2 Louis Prima - Jump, Jive, An' Wail
- `curl -s -w "%{time_total}" "https://itunes.apple.com/search?term=psycho+k&entity=song&limit=5&country=US"` (run 3 times) → 200 in 6.26 s (first), 0.56 s, 0.44 s; results are 'Psycho' by Eddie Noack, Red Velvet, BAEKHYUN, SOYEON, HISTORY — Talking Heads absent
- `curl -s "https://itunes.apple.com/search?term=telepat%C3%ADa&entity=song&limit=5&country=US" ; curl -s "https://itunes.apple.com/search?term=telepatia&entity=song&limit=5&country=US"` → 200 in 0.66 s / 0.67 s; identical 5 results, #1 Kali Uchis - telepatía notExplicit — diacritics folded
- `curl -s "https://itunes.apple.com/search?term=cardi+b+wap&entity=song&limit=3&country=US"` ; same with `&explicit=Yes` → 200; 3 results all Cardi B - WAP (feat. Megan Thee Stallion) with trackExplicitness=cleaned, collectionExplicitness=cleaned, in both runs (ids 1526747167, 1822585609, 1841742329)
- `curl -s "https://itunes.apple.com/search?term=olivia+rodrigo+vampire&entity=song&limit=3&country=US&explicit=Yes"` → 200; vampire [GUTS (spilled)] 1736995100 cleaned; vampire [GUTS] 1694768031 cleaned; explicit=Yes had no effect
- `curl -s "https://itunes.apple.com/lookup?id=1694767605&entity=song&country=US"` → 200; resultCount 12; collection GUTS collectionExplicitness=cleaned; tracks 'bad idea right?' and 'vampire' trackExplicitness=cleaned, others notExplicit
- `curl -s https://ifconfig.co/country-iso` → SA (caller IP geolocates to Saudi Arabia)
- `curl -s -w "%{size_download} %{time_total}" "https://itunes.apple.com/search?term=fever&entity=song&limit=200&country=US"` ; same with limit=500 → 200; resultCount 200, 302111 bytes, 2.63 s; limit=500 → still resultCount 200, 302111 bytes (cap is 200)
- `curl -s "https://itunes.apple.com/search?term=golden+brown&media=music&entity=song&attribute=songTerm&limit=5&country=US"` → 200 in 0.64 s; #1 The Stranglers - Golden Brown, #2 (Slowed Down Version), then Luke Muzzic loops
- `curl -s "https://itunes.apple.com/search?entity=song&limit=1"` (no term) → 200; {"resultCount":0,"results":[]} (no error status)
- `curl -s "https://itunes.apple.com/search?term=hell+squirrel+nut+zippers&entity=song&limit=1&country=US" | head -c 60 | xxd` → body begins 0a0a0a7b — three newlines before the JSON object
- 25× `curl -s -D burst_NN.h "https://itunes.apple.com/search?term=<unique>+cb<ms>&entity=song&limit=1&country=US"` back-to-back (python loop, no sleep) → 25/25 HTTP 200 in 18.5 s total (0.61–1.37 s each); all 25 x-cache: TCP_MISS; no retry-after / ratelimit headers; request 5 s after burst → 200 in 0.74 s
- 30× `curl -s "https://itunes.apple.com/search?term=<artist>+<title>&entity=song&limit=10&country={US,GB}"` with 3 s sleeps (coverage sweep, saved as cov_US_NN.json / cov_GB_NN.json) → 30/30 HTTP 200, 0.67–1.31 s each; all 15 tracks matched in both storefronts, every match has previewUrl and artworkUrl100 and isStreamable true; 7 tracks have different trackId in GB vs US

### 9.2 Deezer
- `curl -s -D - 'https://api.deezer.com/search?q=the%20cure%20lovecats'` → 200 application/json; {data:[24 items], total:24}; top hit id 1143631 'The Lovecats' (Greatest Hits, rank 759227, isrc GBALB8300001); headers include access-control-allow-headers/methods/credentials/max-age but NO access-control-allow-origin; no rate-limit headers
- `curl -s -G 'https://api.deezer.com/search' --data-urlencode 'q=artist:"The Cure" track:"The Lovecats"'` → 200; total 4; ids 1143631, 2887368212 (Acoustic), 490397642 (TC & Benny Mix), 67310084 (BONUS TRACK)
- `curl -s 'https://api.deezer.com/search/track?q=the%20cure%20lovecats&limit=3'` → 200; keys data,total,next; next=https://api.deezer.com/search/track?q=...&limit=3&index=3; same items/order as /search
- `curl -s 'https://api.deezer.com/track/1143631'` → 200; adds available_countries(188), bpm 91.9, contributors[{role:'Main'}], disk_number 1, gain -8.8, release_date '2001-11-12', share, track_position 5, track_token vs search item
- `curl -s 'https://api.deezer.com/track/isrc:GBALB8300001'` → 200; returns id 1126164 (NOT the search hit 1143631), same title/album/ISRC, bpm 91.9, only 64 available_countries
- `curl -s 'https://api.deezer.com/track/isrc:gbalb8300001' ; curl -s 'https://api.deezer.com/track/isrc:GB-ALB-83-00001'` → lowercase → 200 track 1126164; dashed → 200 {error:{type:DataException,message:'no data',code:800}}
- `curl -s 'https://api.deezer.com/artist/381/top?limit=5'` → 200; {data:[5], total:29, next:...index=5}; items have contributors but no isrc/bpm; top = Boys Don't Cry rank 983791
- `curl -s 'https://api.deezer.com/album/122552'` → 200; upc '731458943228', label 'Polydor Records', record_type 'album', nb_tracks 18, genres.data[{id:85,name:'Alternative'}], tracks.data[18] items without isrc/bpm
- `curl -s 'https://api.deezer.com/infos'` → 200; country_iso 'SA', open true, pop 'fr', user_token null, hosts.images 'http://cdn-images.dzcdn.net/images'
- `curl -s -D - -o /dev/null -H 'Origin: http://localhost:3000' 'https://api.deezer.com/track/1143631' ; curl -s -D - -o /dev/null -X OPTIONS -H 'Origin: http://localhost:3000' -H 'Access-Control-Request-Method: GET' 'https://api.deezer.com/track/1143631'` → both 200; no access-control-allow-origin header in either (allow-headers/methods/credentials/max-age present)
- `curl -s -D - 'https://api.deezer.com/track/1143631?output=jsonp&callback=cb'` → 200 text/javascript; body cb({"id":1143631,...}); without callback param body is ({...}); output=xml → application/xml
- `curl -s 'https://api.deezer.com/track/0' ; .../track/999999999999 ; .../album/0 ; .../search ; .../search?q= ; .../nonexistent ; .../search?q=zzqxjvkwpl` → all HTTP 200: DataException/800 'no data' ×3; MissingParameterException/501; ParameterException/500 'empty parameter'; InvalidQueryException/600; {data:[],total:0}
- `curl -s -D - -o prev.bin -H 'Range: bytes=0-1000' -H 'Origin: http://localhost:3000' '<preview url from search for 1143631>'` (repeated for 909884 and 628550022) → 206 audio/mpeg; content-range bytes 0-1000/479827; content-length 1001; accept-ranges bytes; access-control-allow-origin *; access-control-allow-headers Range; cache-control public, max-age=12960000; server Google Frontend; bytes start 49 44 33 04 (ID3v2.4)
- `curl -s -I '<preview url>'` → 200 audio/mpeg content-length 479827 accept-ranges bytes access-control-allow-origin *
- `curl -s -o /dev/null -w '%{http_code}' -H 'Range: bytes=0-1000' '<preview url with exp bumped by 999999>'` ; same with query string stripped → 403 text/html (282 B) ; 403 text/html (280 B)
- `curl -s -D h.txt 'https://api.deezer.com/track/1143631'` (×3, compare preview hdnea exp to Date header) → exp − Date = 900 s on every mint (11:01:09 → exp 11:16:09; 11:01:11 → 11:16:11); hmac differs per mint; path hash constant
- `curl -s -I 'https://cdn-images.dzcdn.net/images/cover/21d780d99cbe7eb5e1d8b5d31fce28c8/250x250-000000-80-0-0.jpg' ; curl -s -I 'https://api.deezer.com/album/122552/image'` → 200 image/jpeg 23274 B, access-control-allow-origin *, cache-control public ; 302 → .../120x120-000000-80-0-0.jpg
- `curl -s 'https://api.deezer.com/search?q=loveca&limit=5'` ; q=lovec ; q=the%20cure%20loveca ; q=zoot%20su ; q=psycho%20kil → all 200; top hits: The Cure 'The Lovecats' 1143631 (×3), 'Zoot Suit Riot' 69256670, 'Psycho Killer (2003 Remaster)' 747527
- `curl -s 'https://api.deezer.com/search?q=love&limit=N'` for N in 50,100,200,500 → data length 50,100,100,100; next index=50,100,100,100 (limit silently clamped to 100); total 237/235 (fuzzy)
- `curl -s 'https://api.deezer.com/search?q=the%20cure%20lovecats&limit=2&index=2'` → 200; next ...index=4, prev ...index=0; items 628550022, 2929726781
- 15× `curl -s -G 'https://api.deezer.com/search' --data-urlencode 'q=<artist> <title>' --data-urlencode limit=5` ; 15× with `q=artist:"<artist>" track:"<title>"` (0.35 s apart) → 30× 200; per-track top hits recorded in coverage table; plain search for 'Caravan Palace Lone Digger' returned total 2 without the original 109590416; adv 'Parov Stelar'/'Booty Swing' returned only the live version
- 24× `curl -s 'https://api.deezer.com/track/{id}'` (0.3 s apart) for ids 1143631 1126164 14719906 3093592 69256670 137903747 3392254691 109590416 129634398 3124340 747527 655095912 2440763155 2713054981 10686127 1030591232 13851424 3677797302 3152622 1148585682 2184700 1761439787 69002469 3049462741 → 24× 200; bpm 0 on 3392254691 2440763155 2713054981 3677797302 1148585682 1761439787 3049462741 (7 ids; the probe's summary said "6/24"); title_version key absent on 14719906, 137903747, 13851424; gain and isrc present on all 24
- `curl -s 'https://api.deezer.com/track/isrc:USUM71900764'` ; isrc:FR89R1500001 ; isrc:USUG12304091 ; isrc:GBBBM8400006 ; isrc:USEM39700073 → 200 each: 655095912 bad guy bpm 135.11; 109590416 Lone Digger bpm 124.2; 2440763155 vampire bpm 0; 13132245 Smooth Operator on 'Love Affair' (not the Diamond Life id 1030591232) bpm 119.8; 2184700 Mr. Pinstripe Suit bpm 106.8
- `curl -s -G 'https://api.deezer.com/search' --data-urlencode 'q=artist:"Talking Heads" album:"Talking Heads: 77" track:"Psycho Killer"'` ; same for Squirrel Nut Zippers album:"Hot" track:"Hell" → 200 total 4, first 6587351 'Psycho Killer' album "Talking Heads '77" isrc USWB19900858 ; 200 total 0
- `seq 1 60 | xargs -P 30 -I{} curl -s -D h_{}.txt -o b_{}.json -w '{} %{http_code}' 'https://api.deezer.com/track/1143631?burst={}'` → 60 requests in 0.90 s: 60× HTTP 200, 60 valid track bodies, no throttle, no rate headers
- `seq 1 70 | xargs -P 35 -I{} curl -s -D h_{}.txt -o b_{}.json -w '{} %{http_code}' 'https://api.deezer.com/search?q=song{}&limit=1'` → 70 requests in 1.25 s: 70× HTTP 200; 55 valid, 15 bodies {"error":{"type":"Exception","message":"Quota limit exceeded","code":4}}; first error at request ~37; no Retry-After/X-RateLimit headers
- `sleep 1; curl -s 'https://api.deezer.com/search?q=the%20cure%20lovecats&limit=1'` ; then 1 req/s probes → +1 s: still {error code 4 Quota limit exceeded} HTTP 200; next probe a few seconds later (next tool call): 200 {data:[],total:0} normal
- `curl -s -D - 'https://itunes.apple.com/search?term=the+cure+lovecats&entity=song&limit=3'` → 200 text/javascript, access-control-allow-origin *; resultCount 3; trackId 1288102536 'The Lovecats' releaseDate 1983-10-18T12:00:00Z; NO isrc key in results
- `curl -s 'https://itunes.apple.com/lookup?isrc=GBALB8300001&entity=song' ; curl -s 'https://itunes.apple.com/lookup?id=1288102536&entity=song'` → resultCount 0 ; resultCount 1 with no isrc key

### 9.3 MusicBrainz + AcousticBrainz
- `curl -s -A "ItStings/0.1 (local dev)" -G "https://musicbrainz.org/ws/2/recording" --data-urlencode 'query=recording:"The Lovecats" AND artist:"The Cure"' --data-urlencode fmt=json --data-urlencode limit=5` → 200 in 0.40 s; {created,count:36,offset:0,recordings[5]} each {id,score,artist-credit-id,title,length,video,artist-credit[],releases[],(first-release-date),(disambiguation)}; no isrcs/tags/genres; headers x-ratelimit-limit:360, access-control-allow-origin:*
- `curl -s -H "User-Agent:" "https://musicbrainz.org/ws/2/recording?query=recording%3A%22The%20Lovecats%22%20AND%20artist%3A%22The%20Cure%22&fmt=json&limit=1"` → 403; {"error":"Your requests are being throttled by MusicBrainz because the application you are using has not identified itself..."}; headers x-ratelimit-who: ua-missing, x-mb-rate-limiter: lua
- `curl -s "https://api.deezer.com/search?q=artist%3A%22The%20Cure%22%20track%3A%22The%20Lovecats%22&limit=3" ; curl -s https://api.deezer.com/track/1143631` → 200; search data[0].id=1143631; /track → isrc:"GBALB8300001", bpm:91.9, release_date:"2001-11-12" (15/15 sample tracks yielded an ISRC; Deezer bpm was 0 for 4 of 15 on the ids this probe chose)
- `curl -s -A "ItStings/0.1 (local dev)" "https://musicbrainz.org/ws/2/isrc/GBALB8300001?fmt=json&inc=artists+releases"` → 200; {isrc, recordings:[{id:"1c19fbb9-edce-49e1-a934-de6071dd7964",title,disambiguation:"album original mix",length:220000,video,first-release-date:"1983-11-28",artist-credit[]}]} — no releases key despite inc=releases; headers x-ratelimit-limit:1200
- `curl -s -A "ItStings/0.1 (local dev)" "https://musicbrainz.org/ws/2/isrc/USCA29900213?fmt=json&inc=artists+releases"` → 404; {"help":"For usage, please see: https://musicbrainz.org/development/mmd","error":"Not Found"} (also HB0NZ0900003 → 404). Overall 13/15 ISRCs resolved.
- (same /isrc lookup at 1.1 s spacing, e.g. USLQB1500001, USWB10302417, ATE611500048, GBAYE8100053, HB0NZ0900003) → 503 on first attempt for 12 of ~45 MB requests; body {"error": "The MusicBrainz web server is currently busy. Please try again later."}; headers x-ratelimit-zone: global, x-ratelimit-who: global, x-ratelimit-limit: 15, retry-after: 0, x-mb-rate-limiter: lua; all succeeded on retry (max 3 attempts)
- `curl -s -A "ItStings/0.1 (local dev)" "https://musicbrainz.org/ws/2/recording/1c19fbb9-edce-49e1-a934-de6071dd7964?fmt=json&inc=isrcs+artist-credits+releases+tags+genres"` → 200; keys artist-credit,disambiguation,first-release-date,genres[11],id,isrcs[3],length,releases[25],tags[17],title,video; tags[]={name,count}; genres[]={id,name,count,disambiguation}; releases[] have date,country,status,barcode,release-events[{date,area{name,iso-3166-1-codes}}]
- `curl -s -A "ItStings/0.1 (local dev)" "https://musicbrainz.org/ws/2/recording/0c846a8e-debd-4a63-bb93-6c57f5178b45?fmt=json&inc=isrcs+artist-credits+releases+tags+genres"` → 200; vampire (2023): isrcs [USUG12304091], tags [ballad,pop,pop rock], genres 3, releases 25
- `curl -s -A "ItStings/0.1 (local dev)" "https://musicbrainz.org/ws/2/isrc/GBALB8300001?fmt=json&inc=releases+isrcs+artist-credits"` → 200; recording keys artist-credit,disambiguation,first-release-date,id,isrcs,length,title,video — isrcs works, releases silently ignored on /isrc
- 3× concurrent: `curl -s -A "ItStings/0.1 (local dev)" "https://musicbrainz.org/ws/2/recording/1c19fbb9-edce-49e1-a934-de6071dd7964?fmt=json"` (burst test, once) → all 3 → 200 but time_total 12.77 s / 13.65 s / 5.66 s (queued, no 503); headers x-ratelimit-limit:1200 remaining 736/737/735
- `curl -s https://acousticbrainz.org/` → 200 nginx/1.31.3; page text: 'In 2022, the decision was made to stop collecting data. For now, the website and its API will continue to be available.'
- `curl -s https://acousticbrainz.org/api/v1/count` → 400; {"message":"Missing `recording_ids` parameter"}; headers x-ratelimit-limit:100, x-ratelimit-remaining:99, x-ratelimit-reset-in:10
- `curl -s https://acousticbrainz.org/api/v1/1c19fbb9-edce-49e1-a934-de6071dd7964/count` → 200; {"count":252,"mbid":"1c19fbb9-edce-49e1-a934-de6071dd7964"}; vampire 0c846a8e → 200 {"count":0,...}
- `curl -s "https://acousticbrainz.org/api/v1/count?recording_ids=1c19fbb9-edce-49e1-a934-de6071dd7964;e66ea0ae-72e9-4471-a3ab-964b6c25696b"` → 200; {"1c19fbb9-...":{"count":252},"e66ea0ae-...":{"count":262},"mbid_mapping":{}}; MBIDs with 0 submissions are omitted
- `curl -s https://acousticbrainz.org/api/v1/1c19fbb9-edce-49e1-a934-de6071dd7964/low-level` → 200 (51,715 bytes, 0.52 s); {lowlevel,metadata,rhythm,tonal}; rhythm.bpm=91.677, rhythm.danceability=1.2195, tonal.key_key="F", tonal.key_scale="major", tonal.key_strength=0.504, lowlevel.average_loudness=0.873, metadata.tags.musicbrainz_recordingid=[mbid], metadata.audio_properties.length=219.7
- `curl -s https://acousticbrainz.org/api/v1/1c19fbb9-edce-49e1-a934-de6071dd7964/high-level` → 200 (9,065 bytes); {highlevel,metadata}; highlevel.{danceability,gender,genre_dortmund,genre_electronic,genre_rosamerica,genre_tzanetakis,ismir04_rhythm,mood_acoustic,mood_aggressive,mood_electronic,mood_happy,mood_party,mood_relaxed,mood_sad,moods_mirex,timbre,tonal_atonal,voice_instrumental} each {value,probability,all{},version{}}; e.g. mood_happy.value=not_happy p=0.665, danceability.value=not_danceable, genre_dortmund.value=electronic
- `curl -s "https://acousticbrainz.org/api/v1/1c19fbb9-edce-49e1-a934-de6071dd7964/low-level?n=251"` / n=252 / n=-1 / n=abc → n=251 → 200 bpm 91.732 (count is 252 so max n=251); n=252 and n=100000 → 404 {"message":"Not found"}; n=-1 and n=abc → 200 same as n=0
- `curl -s https://acousticbrainz.org/api/v1/0c846a8e-debd-4a63-bb93-6c57f5178b45/low-level` (vampire, 2023) → 404; {"message":"Not found"} (high-level also 404)
- `curl -s "https://acousticbrainz.org/api/v1/low-level?recording_ids=<32 ids joined by ;>"` → 400; {"message":"More than 25 recordings not allowed per request"} (same message on /count with 32 ids)
- `curl -s "https://acousticbrainz.org/api/v1/low-level?recording_ids=<25 ids>"` → 200 (541,432 bytes, 1.26 s); {"<mbid>":{"0":{lowlevel,metadata,rhythm,tonal}},...,"mbid_mapping":{}}; only 11 of 25 requested MBIDs present; headers access-control-allow-origin:*, access-control-allow-methods: HEAD, GET, access-control-expose-headers: X-RateLimit-*
- `curl -s "https://acousticbrainz.org/api/v1/high-level?recording_ids=<25 ids>"` → 200 (101,767 bytes); {"<mbid>":{"0":{highlevel,metadata}},...,"mbid_mapping":{}}
- `curl -s "https://acousticbrainz.org/api/v1/low-level?recording_ids=1c19fbb9-edce-49e1-a934-de6071dd7964;e66ea0ae-72e9-4471-a3ab-964b6c25696b&features=rhythm.bpm;tonal.key_key;tonal.key_scale;rhythm.danceability;lowlevel.average_loudness"` → 200; per mbid {"0":{lowlevel:{average_loudness},metadata:{audio_properties,version},rhythm:{bpm,danceability},tonal:{key_key,key_scale}}} — metadata.tags dropped when features= is used
- `curl -s "https://acousticbrainz.org/api/v1/low-level?recording_ids=1c19fbb9-edce-49e1-a934-de6071dd7964:0;1c19fbb9-edce-49e1-a934-de6071dd7964:1;1c19fbb9-edce-49e1-a934-de6071dd7964:2&features=rhythm.bpm"` → 200; {"1c19fbb9-...":{"0":{rhythm.bpm 91.677},"1":{91.753},"2":{91.741}},"mbid_mapping":{}}
- `curl -s "https://acousticbrainz.org/api/v1/1c19fbb9-edce-49e1-a934-de6071dd7964/high-level?map_classes=true"` → 200; genre_rosamerica.value="Rhythm and Blues" (was "rhy"), genre_tzanetakis.value="Jazz", moods_mirex.value="aggressive, fiery, tense/anxious, intense, volatile, visceral"; bulk high-level with :0;:1 offsets + map_classes → mood_happy "Not happy" at 0 vs "Happy" at 1
- `curl -s https://acousticbrainz.org/api/v1/not-a-uuid/low-level ; curl -s "https://acousticbrainz.org/api/v1/low-level?recording_ids=not-a-uuid;1c19fbb9-edce-49e1-a934-de6071dd7964"` → path form → 404 Flask HTML 'The requested URL was not found'; bulk form → 400 {"message":"'not-a-uuid' is not a valid UUID"}
- `curl -s "https://acousticbrainz.org/api/v1/count?recording_ids=<25 Fever MBIDs from MB search>"` (and 17 Zoot Suit Riot, 25 Louis Prima) → 200; Fever hits: a38234ef (2), 5d4c0e31 (1), f7bdc771 (1) — none is the 1958 original; Zoot Suit Riot: b944f19c (63); Louis Prima: b89ccfb7 (35), 4c53eb0c (7, remix), d43ea802 (1)

### 9.4 Last.fm
- `curl -sS -D - "https://ws.audioscrobbler.com/2.0/?method=track.getSimilar&artist=The%20Cure&track=The%20Lovecats&format=json"` → HTTP/2 400, content-type application/json, access-control-allow-origin: *, body {"message":"Invalid parameters - Your request is missing a required parameter","error":6} (NO api_key). No rate-limit or cache headers present.
- `curl -sS -D - "https://ws.audioscrobbler.com/2.0/?method=track.getSimilar&artist=The%20Cure&track=The%20Lovecats&api_key=INVALID&format=json"` → HTTP/2 403, body {"message":"Invalid API key - You must be granted a valid key by last.fm","error":10}. Headers: server: openresty, access-control-allow-methods: POST, GET, OPTIONS, access-control-allow-origin: *, access-control-max-age: 86400. No X-RateLimit-*/Retry-After/Cache-Control.
- `curl -sS "https://ws.audioscrobbler.com/2.0/?method=track.getTopTags&artist=The%20Cure&track=The%20Lovecats&format=json"` (then same with &api_key=INVALID) → no key: 400 error 6; INVALID key: 403 error 10
- `curl -sS "https://ws.audioscrobbler.com/2.0/?method=tag.getTopTracks&tag=swing&format=json"` (then same with &api_key=INVALID) → no key: 400 error 6; INVALID key: 403 error 10
- `curl -sS "https://ws.audioscrobbler.com/2.0/?method=track.getInfo&artist=The%20Cure&track=The%20Lovecats&format=json"` (then same with &api_key=INVALID) → no key: 400 error 6; INVALID key: 403 error 10
- `curl -sS "https://ws.audioscrobbler.com/2.0/?method=artist.getSimilar&artist=The%20Cure&format=json"` (then same with &api_key=INVALID) → no key: 400 error 6; INVALID key: 403 error 10
- `curl -sS "https://ws.audioscrobbler.com/2.0/?method=track.search&track=Lovecats&format=json"` (then same with &api_key=INVALID) → no key: 400 error 6; INVALID key: 403 error 10
- `curl -sS "https://ws.audioscrobbler.com/2.0/?method=track.getSimilar&artist=The%20Cure&track=The%20Lovecats&api_key=&format=json"` → 400 error 6 (empty api_key= is treated as missing, not invalid)
- `curl -sS "https://ws.audioscrobbler.com/2.0/?method=track.getSimilar&artist=The%20Cure&track=The%20Lovecats&api_key=00000000000000000000000000000000&format=json"` → 403 error 10 (a 32-hex-shaped but unissued key is still 'Invalid API key')
- `curl -sS "https://ws.audioscrobbler.com/2.0/?method=track.doesNotExist&format=json"` → 400 error 6 (missing api_key is checked BEFORE method existence)
- `curl -sS "https://ws.audioscrobbler.com/2.0/?method=track.doesNotExist&api_key=INVALID&format=json"` → 400 {"message":"Invalid Method - No method with that name in this package","error":3} (method existence is checked BEFORE key validity)
- `curl -sS "https://ws.audioscrobbler.com/2.0/?format=json"` → 400 error 6
- `curl -sS "https://ws.audioscrobbler.com/2.0/?method=track.getSimilar&artist=The%20Cure&track=The%20Lovecats&api_key=INVALID"` (no format=json) → 403, XML: <?xml version="1.0" encoding="UTF-8"?><lfm status="failed"><error code="10">Invalid API key - You must be granted a valid key by last.fm</error></lfm>
- `curl -sS -X POST https://ws.audioscrobbler.com/2.0/ -d "method=track.getSimilar&artist=The%20Cure&track=The%20Lovecats&api_key=INVALID&format=json"` → 403 error 10 (POST form body accepted for read methods too)
- `curl -sS -I -X OPTIONS "https://ws.audioscrobbler.com/2.0/?method=track.getSimilar&api_key=INVALID&format=json" -H "Origin: http://localhost:3000" -H "Access-Control-Request-Method: GET"` → HTTP/2 200, access-control-allow-origin: *, access-control-allow-methods: POST, GET, OPTIONS, access-control-max-age: 86400 (CORS open; app still proxies to hide key)
- `curl -sS "https://ws.audioscrobbler.com/2.0/?method=track.getSimilar&artist=The%20Cure&track=The%20Lovecats&api_key=INVALID&format=json&callback=cb"` → 403, body cb({"message":"Invalid API key - You must be granted a valid key by last.fm","error":10}); (JSONP wrapper works even on errors)
- `curl -sS -I "http://ws.audioscrobbler.com/2.0/?method=track.getSimilar&artist=x&track=y&api_key=INVALID&format=json"` → HTTP/1.1 403 Forbidden, content-type: application/json (plain http is served directly, NOT redirected to https; use https explicitly)
- `curl -sS -L -A "ItStings/0.1 (local dev)" https://www.last.fm/api/show/track.getSimilar` → 200, 72517 bytes; Params: track (Required unless mbid), artist (Required unless mbid), mbid (Optional), autocorrect[0|1] (Optional), limit (Optional), api_key (Required). Sample XML <similartracks track artist><track><name><mbid><match>10.95</match><url><streamable fulltrack><artist><name><mbid><url></artist><image size=small|medium|large>
- `curl -sS -L -A "ItStings/0.1 (local dev)" https://www.last.fm/api/show/track.getTopTags` → 200; Params: track, artist (Required unless mbid), mbid, autocorrect[0|1], api_key. Sample XML <toptags artist track><tag><name>pop</name><count>97</count><url>www.last.fm/tag/pop</url></tag>
- `curl -sS -L -A "ItStings/0.1 (local dev)" https://www.last.fm/api/show/tag.getTopTracks` → 200; Params: tag (Required), limit (Optional, 'Defaults to 50'), page (Optional, 'Defaults to first page'), api_key. Sample XML <toptracks tag><track rank=""><name><mbid><url><streamable fulltrack><artist><name><mbid><url></artist><image size=...>
- `curl -sS -L -A "ItStings/0.1 (local dev)" https://www.last.fm/api/show/track.getInfo` → 200; Params: mbid, track, artist (Required unless mbid), username (Optional: adds user's playcount and loved), autocorrect[0|1], api_key. Sample XML <track><id><name><mbid><url><duration>240000</duration><streamable fulltrack><listeners><playcount><artist><name><mbid><url></artist><album position><artist><title><mbid><url><image size></album><toptags><tag><name><url></tag></toptags><wiki><published><summary><content></wiki></track>; Attributes: duration in milliseconds
- `curl -sS -L -A "ItStings/0.1 (local dev)" https://www.last.fm/api/show/track.search` → 200; Params: limit (Optional, 'Defaults to 30'), page (Optional), track (Required), artist (Optional: 'Narrow your search by specifying an artist'), api_key. Sample XML <results for xmlns:opensearch><opensearch:totalResults><opensearch:startIndex><opensearch:itemsPerPage><trackmatches><track><name><artist>Disturbed</artist><url><streamable><listeners><image></track></trackmatches></results> (note: artist is a plain string here, not an object)
- `curl -sS -L -A "ItStings/0.1 (local dev)" https://www.last.fm/api/show/artist.getSimilar` → 200; Params: limit, artist (Required unless mbid), autocorrect[0|1], mbid, api_key. Sample XML <similarartists artist><artist><name><mbid><match>1</match><url><image size=small|medium|large|extralarge|mega><streamable></artist>; Attributes: 'match : A similarity value between 0 (not similar) and 1 (very similar)'
- `curl -sS -L -A "ItStings/0.1 (local dev)" https://www.last.fm/api/rest` → 200; documents format=json, callback, JSON translation rules (attributes → string members keyed by attribute name; text with attributes → '#text'; repeated nodes → arrays), success example shows numbers as strings ("count": "55483"), JSON error form {"error": 10, "message": "Invalid API Key"}, raw=true strips the <lfm> wrapper (XML only)
- `curl -sS -L -A "ItStings/0.1 (local dev)" https://www.last.fm/api/errorcodes` → 200; full error list 1-29. 29 = 'Rate Limit Exceded - Your IP has made too many requests in a short period, exceeding our API guidelines'; 26 = 'API Key Suspended'; 6 = 'Invalid parameters - Your request is missing a required parameter'; 10 = 'Invalid API key'
- `curl -sS -L -A "ItStings/0.1 (local dev)" https://www.last.fm/api/intro` → 200; quotes: 'Please use an identifiable User-Agent header on all requests.' and 'Your account may be suspended if your application is continuously making several calls per second or if you're making excessive calls.' and 'try not to hit the API on page load'
- `curl -sS -L -A "ItStings/0.1 (local dev)" https://www.last.fm/api/tos` → 200, 83947 bytes; API Terms of Service, clauses 1-10.8. No numeric rate limit in 4.4; 100 MB Reasonable Usage Cap in 4.3.4; non-commercial 3.1; credit/link 2.7 and 4.2.2; API-only data gathering 2.6
- `curl -sS -I -A "ItStings/0.1 (local dev)" https://www.last.fm/api/account/create` → HTTP/2 302, location: /login?next=/api/account/create (with -L: final https://www.last.fm/login?next=/api/account/create, 200, page title 'Log In')
- `curl -sS -I -A "ItStings/0.1 (local dev)" https://www.last.fm/join` → HTTP/2 200 (user signup page exists)
- `curl -sS -I -A "ItStings/0.1 (local dev)" https://www.last.fm/api/accounts` → HTTP/2 302, location: /login?next=/api/accounts
- `curl -sS -I -A "ItStings/0.1 (local dev)" https://www.last.fm/api/account` → HTTP/2 404
- `curl -sS -I -A "ItStings/0.1 (local dev)" "https://www.last.fm/music/The+Cure/_/The+Lovecats/+similar"` → HTTP/2 302, location: /music/The+Cure/_/The+Lovecats (with -L final URL https://www.last.fm/music/The+Cure/_/The+Lovecats, 200, 472218 bytes HTML, canonical https://www.last.fm/music/The+Cure/_/The+Lovecats, h1 'The Lovecats')
- `curl -sS -L -A "ItStings/0.1 (local dev)" "https://www.last.fm/music/The+Cure/_/The+Love+Cats/+similar"` → 302 → 200 at https://www.last.fm/music/The+Cure/_/The+Love+Cats, 462901 bytes, canonical https://www.last.fm/music/The+Cure/_/The+Love+Cats, h1 'The Love Cats' (a SEPARATE entry from 'The Lovecats'; recon-only parse shows 116,006 listeners / 624,195 scrobbles vs 943,363 / 6,481,777 for 'The Lovecats')
- `curl -sS -I -A "ItStings/0.1 (local dev)" https://www.last.fm/music/<Artist>/_/<Track>` for each of the 15 sample tracks + 1 nonsense control, 1.5 s apart → 14/15 HTTP 200; Louis Prima 'Jump, Jive an' Wail' HTTP 301 → /music/Louis+Prima/_/Jump,+Jive+An'+Wail (canonical capitalisation differs); control 'Zzxqv Nonexistent Artist / Qwertyuiop Nonsense Track 98765' HTTP 404 (so 200 is a real existence signal)

### 9.5 Spotify
- `curl -sS -L -w "status=%{http_code} ct=%{content_type}" https://developer.spotify.com/blog/2024-11-27-changes-to-the-web-api` → 200 text/html (104 KB). Body lists deprecated: Related Artists, Recommendations, Audio Features, Audio Analysis, Get Featured Playlists, Get Category's Playlists, 30-second preview URLs in multi-get responses (SimpleTrack object), Algorithmic and Spotify-owned editorial playlists; applies to dev-mode apps without pending extension and apps registered on/after 2024-11-27.
- `curl -sS -L https://developer.spotify.com/blog/2026-02-06-update-on-developer-access-and-platform-security` → 200 text/html. From Feb 11 2026 new dev-mode client IDs: Premium required, 1 client ID per developer, 5 authorized users, reduced endpoint set; Mar 9 update: endpoint restrictions for existing apps postponed, Premium/5-user/1-client-ID limits proceed.
- `curl -sS -L -o /dev/null -w "%{http_code}" https://developer.spotify.com/blog` → 404 (also /blog/, /community/news, /news → 404). No blog index page.
- `curl -sS -L https://developer.spotify.com/documentation/web-api/reference/get-audio-features` → 200. Page has tag <span data-encore-id="tag" class="e-10202-tag encore-negative-subdued-set…">Deprecated</span> next to the OAuth 2.0 badge; endpoint GET /audio-features/{id}; no prose notice; schema still documented.
- `for p in get-several-audio-features get-audio-analysis get-recommendations get-an-artists-related-artists get-featured-playlists get-a-categories-playlists get-several-tracks get-track get-artists-top-tracks; do curl -sS -L -o ref_$p.html -w "$p %{http_code}" https://developer.spotify.com/documentation/web-api/reference/$p; done` → All 200 except get-artists-top-tracks → 404. Text after 'OAuth 2.0' is 'Deprecated' for several-audio-features, audio-analysis, recommendations, related-artists, featured-playlists, categories-playlists, several-tracks; get-track has no endpoint badge but preview_url field is 'Nullable Deprecated'.
- `curl -sS -L https://developer.spotify.com/documentation/web-api/reference/add-tracks-to-playlist` → 200. 'Add Items to Playlist [DEPRECATED] — OAuth 2.0 — Deprecated — Deprecated: Use Add Items to Playlist instead.' POST /playlists/{playlist_id}/tracks.
- `curl -sS -L https://developer.spotify.com/documentation/web-api/reference/add-items-to-playlist` → 200. POST /playlists/{playlist_id}/items; scopes playlist-modify-public / playlist-modify-private; body {"uris":[...],"position":0}; max 100; response 201 {"snapshot_id":"abc"}.
- `curl -sS -L https://developer.spotify.com/documentation/web-api/reference/create-playlist` → 200. POST /me/playlists; body name (required), public (default true; private needs playlist-modify-private), collaborative, description; 201 playlist object; 'maximum of 11000 playlists'.
- `curl -sS -L https://developer.spotify.com/documentation/web-api/reference/create-playlist-for-user` → 200. 'Create Playlist for user — Deprecated — Deprecated: Use Create Playlist instead.' POST /users/{user_id}/playlists.
- `curl -sS -L https://developer.spotify.com/documentation/web-api/concepts/quota-modes` → 200. 'Up to 5 authenticated Spotify users can use an app that is in development mode'; 'The app owner must have a Spotify Premium account for apps in development mode to function'; 429 body reason QUOTA_EXCEEDED; extension only for organizations since May 15 2025, 250k MAU.
- `curl -sS -L https://developer.spotify.com/documentation/web-api/concepts/redirect_uri` → 200. 'Use HTTPS … unless you are using a loopback address, when HTTP is permitted. … use the explicit IPv4 or IPv6, like http://127.0.0.1:PORT or http://[::1]:PORT … localhost is not allowed as redirect URI.' Enforced for new apps from 2025-04-09; all clients by Nov 2025; port may be omitted for loopback.
- `curl -sS -L https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow` → 200. /authorize params client_id, response_type=code, redirect_uri, state, scope, code_challenge_method=S256, code_challenge; POST /api/token form grant_type=authorization_code, code, redirect_uri, client_id, code_verifier; response access_token, token_type, scope, expires_in, refresh_token. Example redirectUri 'http://127.0.0.1:8080'.
- `curl -sS -L https://developer.spotify.com/documentation/web-api/concepts/scopes` → 200. playlist-modify-private = 'Write access to a user's private playlists.' required by Create a Playlist and Add Items to a Playlist; page also lists 'Search for an Item' under endpoints requiring user-read-private.
- `curl -sS -L https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide` → 200. Timeline Feb 11 2026 (new apps) / Mar 9 2026 (existing); Premium required; 1 client ID (25 since July 2026), 5 users per app; /tracks → /items renames; batch GET /tracks etc removed; browse + top-tracks removed; POST /users/{id}/playlists → POST /me/playlists; search limit max 50→10 default 20→5; removed fields incl. track popularity/available_markets/linked_from, user email/country/product.
- `curl -sS -L https://developer.spotify.com/documentation/web-api/references/changes/february-2026` (+ march-2026, may-2026, july-2026) → All 200. Feb: [REMOVED]/[ADDED]/[CHANGED] lists as quoted; 'Endpoints still available' includes GET /search, GET /tracks/{id}, POST /me/playlists, GET /me, player endpoints. Mar: external_ids reverted. May: User.account_id added. Jul: client IDs 1→25, per-account quota, 429 QUOTA_EXCEEDED body.
- `curl -sS -L https://developer.spotify.com/documentation/web-api/reference/search` → 200. GET /search; q filters album/artist/track/year/upc/tag:hipster/tag:new/isrc/genre; type album|artist|playlist|track|show|episode|audiobook; market; limit Default 5 Range 0-10; offset 0-1000; include_external=audio; response tracks{href,limit,next,offset,previous,total,items[TrackObject]}; popularity and preview_url marked Deprecated.
- `curl -sS -L https://developer.spotify.com/documentation/web-api/concepts/rate-limits` → 200. Rolling 30-second window, no number published; 429 with Retry-After (seconds); dev-mode quota is separate.
- `curl -sS -D - "https://api.spotify.com/v1/search?q=lovecats&type=track"` → 401 application/json {"error":{"status":401,"message":"Missing/invalid/expired access token"}}; www-authenticate: Bearer realm="spotify", error="missing_token", error_description="No token provided"; access-control-allow-origin: *; no rate-limit headers.
- `curl -sS -H "Authorization: Bearer notarealtoken" "https://api.spotify.com/v1/search?q=lovecats&type=track"` → 401 same JSON body; www-authenticate error="invalid_token", error_description="Invalid access token".
- `curl -sS "https://api.spotify.com/v1/tracks/2yiFjR1gN6rG3jMd4YeYxA" ; curl -sS "https://api.spotify.com/v1/audio-features/2yiFjR1gN6rG3jMd4YeYxA"` → Both 401 {"error":{"status":401,"message":"Missing/invalid/expired access token"}} (auth checked before existence/deprecation).
- `curl -sS -X POST https://accounts.spotify.com/api/token -H "Content-Type: application/x-www-form-urlencoded" -d "grant_type=client_credentials&client_id=bogus…&client_secret=bogus…"` → 400 application/json {"error":"invalid_client","error_description":"Invalid client"}; same with -u Basic auth; with no creds at all: 400 {"error":"invalid_client"}.
- `curl -sS -D - "https://accounts.spotify.com/authorize?client_id=bogus…&response_type=code&redirect_uri=http%3A%2F%2F127.0.0.1%3A3000%2Fapi%2Fspotify%2Fcallback&scope=playlist-modify-private&code_challenge_method=S256&code_challenge=…"` → 303 → https://accounts.spotify.com/en/login?continue=<authorize url>&client_id=bogus… (login first; client_id not validated on first hop).
- `curl -sS -D - "https://open.spotify.com/oembed?url=https://open.spotify.com/track/2yiFjR1gN6rG3jMd4YeYxA"` → 404, empty body, no content-type (ID from brief is not a real track).
- `curl -sS -A "ItStings/0.1 (local dev)" "https://www.wikidata.org/w/api.php?action=wbgetclaims&entity=Q93960258&property=P2207&format=json"` → 200; P2207 (Spotify track ID) = 6q2T5xXao6mTS6LLE88L84 for 'The Lovecats — vocal track by The Cure; 1983 studio recording'. Later Wikidata calls → 429 after ~40 req @1/s and after 7 req @2.5 s.
- `curl -sS -D - "https://open.spotify.com/oembed?url=https://open.spotify.com/track/6q2T5xXao6mTS6LLE88L84"` → 200 application/json, access-control-allow-origin: *; fields html (iframe), iframe_url, width 456, height 152, version "1.0", provider_name "Spotify", provider_url, type "rich", title "The Lovecats", thumbnail_url (image-cdn-fa.spotifycdn.com …), thumbnail_width 300, thumbnail_height 300.
- `curl -sS "https://open.spotify.com/oembed?url=spotify:track:6q2T5xXao6mTS6LLE88L84" ; curl -sS "https://open.spotify.com/oembed?url=https://open.spotify.com/artist/7bu3H8JO7d0UbMoVzbo70s" ; curl -sS "https://open.spotify.com/oembed?url=https://open.spotify.com/intl-de/track/6q2T5xXao6mTS6LLE88L84" ; curl -sS https://open.spotify.com/oembed` → URI form 200; artist 200 (height 352, thumbnail 320x320, title 'The Cure'); intl path 200; no url param → 504 text/plain 'upstream request timeout'.
- `curl -sS -D - "https://open.spotify.com/embed/track/6q2T5xXao6mTS6LLE88L84"` → 200 text/html (10.4 KB), cache-control private/no-store; __NEXT_DATA__ pageProps.state.data.entity {type, name, uri, id, artists[{name,uri}], releaseDate.isoString 1983-01-01, duration 220093, isPlayable true, audioPreview.url https://p.scdn.co/mp3-preview/…, visualIdentity…}; no 'log in'/'Premium' strings in server HTML.
- `curl -sS -D - "https://open.spotify.com/embed/track/2yiFjR1gN6rG3jMd4YeYxA"` → 200 text/html (6.4 KB) even though the ID does not exist — renders 'Page not found' shell, __NEXT_DATA__ pageProps.status 404.
- `curl -sS -I https://p.scdn.co/mp3-preview/ea067be9983cc719c166481f0a3bd2d884967ec8 ; curl -sS -r 0-1 -o - <same url>` → HEAD 200 audio/mpeg Content-Length 359956, Accept-Ranges bytes, Access-Control-Allow-Origin *, Cache-Control max-age=604800; range GET 206 (ID3 header).
- `curl -sS "https://open.spotify.com/track/6q2T5xXao6mTS6LLE88L84"` → 200 text/html (287 KB): <title>The Lovecats - song and lyrics by The Cure | Spotify</title>, og:description 'The Cure · Japanese Whispers · Song · 1983', og:image 640x640 i.scdn.co, music:duration 220, music:release_date 1983-01-01, music:musician artist URL.
- `curl -sS -D - "https://open.spotify.com/search/The%20Cure%20The%20Lovecats"` → 200 text/html (165 KB), no redirect; <title>Search | Spotify</title>; og:url echoes path; body is client-rendered shell without results.
- `curl -sS -L -w "%{http_code} %{url_effective}" https://developer.spotify.com/dashboard` → 200 https://developer.spotify.com/dashboard (client-rendered, empty <title>).
- `curl -sS "https://itunes.apple.com/search?term=The+Cure+The+Lovecats&entity=song&limit=3"` → 200 text/javascript; results[0] The Cure | The Lovecats | Greatest Hits | 1983-10-18 | trackId 1288102536 (used only to feed Odesli).
- `curl -sS -G https://api.song.link/v1-alpha.1/links --data-urlencode "url=https://music.apple.com/us/album/the-lovecats/1288102355?i=1288102536"` → 401 application/json {"statusCode":401,"code":"PUBLIC_API_ACCESS_DEPRECATED"} — Odesli keyless bridge is gone.

### 9.6 Web search (Channel B): Reddit, rateyourmusic, Brave, Tavily, Exa, Serper
- `curl -sS -o reddit_search.body -w 'STATUS=%{http_code} CT=%{content_type}' -D reddit_search.headers 'https://www.reddit.com/r/ifyoulikeblank/search.json?q=lovecats&restrict_sr=1'` → 403, content-type text/html, content-length 189908, retry-after: 0, server: snooserv; body is an HTML block page starting '<body class=theme-beta><div><style>.theme-light,:root{--rem360:22.5rem;...' (not JSON)
- `curl -sS -o old_reddit.body -w 'STATUS=%{http_code}' -D old_reddit.headers 'https://old.reddit.com/r/ifyoulikeblank/'` → 302 → location: https://old.reddit.com/login/?reason=lor2&dest=https%3A%2F%2Fold.reddit.com%2Fr%2Fifyoulikeblank%2F (login wall), server: snooserv, empty body
- `curl -sS -X POST -w 'STATUS=%{http_code}' 'https://www.reddit.com/api/v1/access_token' -d 'grant_type=client_credentials'` → 401 application/json {"message": "Unauthorized", "error": 401}; www-authenticate: Basic realm="reddit"
- `curl -sSL -o reddit_terms.html -w 'STATUS=%{http_code}' 'https://www.redditinc.com/policies/data-api-terms'` → 200 (final https://redditinc.com/policies/data-api-terms); terms require 'a separate agreement with Reddit' for commercial use and grant only a display license for User Content
- `curl -sS -o rym.body -w 'STATUS=%{http_code} CT=%{content_type}' -D rym.headers 'https://rateyourmusic.com/release/single/the-cure/the-lovecats/'` → 403, server: cloudflare, cf-mitigated: challenge, cf-ray: a36cf495dbc111a9-MRS; 5519-byte 'Just a moment...' page with __cf_chl / challenge-platform markers (Cloudflare JS challenge)
- `curl -sS -H 'X-Subscription-Token: BOGUS_KEY_NOT_REAL_0000' -H 'Accept: application/json' 'https://api.search.brave.com/res/v1/web/search?q=%22The%20Lovecats%22%20%22The%20Cure%22%20songs%20like&count=5'` → 422 application/json {"error":{"code":"SUBSCRIPTION_TOKEN_INVALID","detail":"The provided subscription token is invalid.","meta":{"component":"authentication"},"status":422},"type":"ErrorResponse"} (server awselb/2.0, ~1.0 s)
- `curl -sS -H 'Accept: application/json' 'https://api.search.brave.com/res/v1/web/search?q=lovecats'` → 422 {"error":{"code":"VALIDATION","detail":"Unable to validate request parameter(s)","meta":{"errors":[{"input":null,"loc":["header","x-subscription-token"],"msg":"Field required","type":"missing"}]},"status":422},"type":"ErrorResponse"}
- `curl -sSL 'https://brave.com/search/api/' | (strip tags)` → 200; plan 'Search': '$5 per 1,000 requests', 'Includes $5 in free credits every month', 'Extra alternate snippets', '50 queries per second'; 'Answers': '$4 per 1,000 requests + $5 per million input/output tokens', '2 queries per second'; FAQ 'Why is a credit card required to subscribe to a free plan?'
- `curl -sS 'https://api-dashboard.search.brave.com/llms.txt'` → 200 text/plain 7570 bytes; index of markdown docs (each page at .../index.html.md). The /app/documentation/... HTML routes (get-started, query, responses) all returned byte-identical SPA shells (md5 301bf6ae...)
- `curl -sS 'https://api-dashboard.search.brave.com/api-reference/web/search/get/index.html.md'` → 200 text/plain 245657 bytes; GET /v1/web/search params q, country, search_lang, ui_lang, count (1-20 default 20), offset (0-9), safesearch, spellcheck, freshness (pd|pw|pm|py|range), text_decorations, result_filter, goggles, extra_snippets, summary, enable_rich_callback, include_fetch_metadata, operators; response web.results[].{title,url,description,page_age,extra_snippets[]...}, discussions.results[], query.reddit_cluster, query.search_operators.sites
- `curl -sS 'https://api-dashboard.search.brave.com/documentation/guides/rate-limiting/index.html.md'` → 200; 1-second sliding window, 429 on exceed; headers X-RateLimit-Limit / X-RateLimit-Policy / X-RateLimit-Remaining / X-RateLimit-Reset in 'per-second, per-month' pairs; only successful requests counted
- `curl -sS 'https://api-dashboard.search.brave.com/documentation/resources/help-feedback/index.html.md'` → 200; 'We do not offer a standalone free plan. However, each plan receives $5 in free credits ... equivalent to (for example) 1,000 queries per month on the Search plan'; 'It is prohibited to retain any and all data received through the Brave Search API'; card check is a $0/$1 hold
- `curl -sSL 'https://api-dashboard.search.brave.com/documentation/resources/terms-of-service' | (strip tags)` → 200; 'SEARCH API TERMS OF USE Last updated: 1 Sep, 2026' — 'Customer shall not ... (i) store, cache, or create a database of Search Results, in whole or in part, other than transient storage required for operation of Customer Applications'
- `curl -sS 'https://api-dashboard.search.brave.com/documentation/services/llm-context/index.html.md'` → 200 15905 bytes; GET/POST https://api.search.brave.com/res/v1/llm/context, X-Subscription-Token; mentions 'extracting forum discussions (e.g. from Reddit)'; response grounding.generic[]{url,title,snippets[]} + sources{url:{title,hostname,age[],description}}; params count 1-50, maximum_number_of_tokens 1024-32768, context_threshold_mode, freshness
- `curl -sS -X POST 'https://api.tavily.com/search' -H 'Authorization: Bearer BOGUS_KEY_NOT_REAL_0000' -H 'Content-Type: application/json' -d '{"query":"\"The Lovecats\" \"The Cure\" songs like","include_domains":["reddit.com"],"include_raw_content":true,"search_depth":"advanced","max_results":5}'` → 401 application/json {"detail": {"error": "Unauthorized: missing or invalid API key."}} (server awselb/2.0, 0.69 s). Same body with api_key in JSON body and with no key at all.
- `curl -sS 'https://docs.tavily.com/documentation/api-reference/endpoint/search.md'` → 200 text/markdown 28417 bytes; OpenAPI for POST /search: search_depth advanced|basic|fast|ultra-fast, chunks_per_source 1-3, max_results 0-20, include_raw_content false|true|markdown|text, include_domains (max 300), exclude_domains (max 150), include_domains_mode filter|boost, exact_match, time_range, start_date/end_date, auto_parameters; response results[]{title,url,content,score,raw_content,favicon,images,id}, response_time, usage.credits, request_id; 429/432/433 shapes
- `curl -sSL 'https://docs.tavily.com/documentation/api-credits' | (strip tags)` → 200; 'You get 1,000 free API Credits every month. No credit card required.'; Researcher 1,000 Free / Project 4,000 $30 / Bootstrap 15,000 $100 / Startup 38,000 $220 / Growth 100,000 $500 / PAYG $0.008 per credit; basic|fast|ultra-fast = 1 credit, advanced = 2 credits
- `curl -sSL 'https://docs.tavily.com/documentation/rate-limits' | (strip tags)` → 200; Development 100 RPM, Production 1,000 RPM; 429 with retry-after header and body {"error": "Your request has been blocked due to excessive requests..."}; production keys require a Paid Plan or PAYGO
- `curl -sSL 'https://www.tavily.com/terms' | (strip tags) | grep -iE 'retain|store|cache|database'` → 200 'Tavily – Platform Terms of Service Last updated: May 4, 2026'; no clause prohibiting caching/storing/database of results found; 6.5 says Tavily may retain Customer Input for training
- `curl -sS -X POST 'https://api.exa.ai/search' -H 'x-api-key: BOGUS_KEY_NOT_REAL_0000' -H 'Content-Type: application/json' -d '{"query":"...","type":"auto","includeDomains":["reddit.com"],"numResults":5,"contents":{"text":true,"highlights":true}}'` → 401 {"requestId":"1ec121dbc47b44a39828cc8506d190b5","error":"Invalid API key","tag":"INVALID_API_KEY"} (server cloudflare, x-request-id header, 1.08 s)
- `curl -sS -X POST 'https://api.exa.ai/search' -H 'Content-Type: application/json' -d '{"query":"lovecats"}'` → 402 {"tag":"X402_PAYMENT_REQUIRED","x402Version":2,...} — x402 crypto payment challenge: 7000 USDC base units ($0.007) per search on Base/Solana; embedded schema says numResults max 10 for x402, type 'auto, keyword, neural, deep-lite, deep, deep-reasoning', contents 'text, highlights, summary'; agentkit free-trial uses:100
- `curl -sS 'https://docs.exa.ai/reference/search.md'` (→ https://exa.ai/docs/reference/search.md) → 200 text/markdown 100999 bytes; type enum instant|fast|auto|deep-lite|deep|deep-reasoning (default auto; no neural/keyword), includeDomains/excludeDomains max 1200 with path prefixes and wildcards ('instead of adding a site: operator'), numResults 1-100, contents.text{maxCharacters<=10000,...}, contents.highlights{query,...}, maxAgeHours -1..720, livecrawl deprecated; results[]{title,url,publishedDate,author,id,image,favicon,text,highlights[],highlightScores[],summary}; resolvedSearchType deprecated; costDollars{total,search{neural,keyword},contents{text,highlights,summary}}; 429 tag RATE_LIMIT_EXCEEDED
- `curl -sSL 'https://exa.ai/pricing'` → 200 text/markdown 7687 bytes; 'New accounts get $20 in free credits (around 2,800 searches) and the Free Tier adds $10 in credits every month'; /search $7/1k requests (up to 10 results) + $1/1k extra results + $1/1k AI summaries; /contents $1/1k pages per content type; deep-lite/deep $12/1k, deep-reasoning $15/1k
- `curl -sSL 'https://docs.exa.ai/reference/rate-limits' | (strip tags)` → 200; '/search 10 QPS, /contents 100 QPS, /answer 10 QPS' (Last modified July 20, 2026)
- `curl -sSL 'https://exa.ai/terms'` (→ https://exa.ai/assets/Exa_Labs_Terms_of_Service.pdf) + pypdf extract → 200 PDF 213895 bytes; 4.2(a): may not 'download, modify, copy, ... reproduce, duplicate ... any information ... obtained from or through the Services, except for temporary files that are automatically cached by your web browser for display purposes, or as otherwise expressly permitted'
- `curl -sS -X POST 'https://google.serper.dev/search' -H 'X-API-KEY: BOGUS_KEY_NOT_REAL_0000' -H 'Content-Type: application/json' -d '{"q":"site:reddit.com \"The Lovecats\" recommendations","num":5}'` → 403 {"message":"Unauthorized.","statusCode":403} (server Google Frontend, access-control-allow-origin: *, 1.04 s)
- `curl -sS -X POST 'https://google.serper.dev/search' -H 'Content-Type: application/json' -d '{"q":"lovecats"}'` → 403 {"message":"Unauthorized. Sign up for a free account.","statusCode":403}
- `curl -sSL 'https://serper.dev' | (strip tags)` → 200 1.04 MB; 'Get 2,500 free queries No credit card required'; Starter $50 = 50k credits ($1.00/1k) 50 QPS; Standard $375 = 500k ($0.75/1k) 100 QPS; Scale $1250 = 2.5M ($0.50/1k) 200 QPS; Ultimate $3750 = 12.5M ($0.30/1k) 300 QPS; credits valid 6 months; 'all queries are returned in 1 to 2 seconds'; example JSON organic[]{title,link,snippet,sitelinks,position,date,source}, knowledgeGraph{...}; only form fields q, gl, hl present
- `curl -sS -o /dev/null -w '%{http_code}' -L https://serper.dev/docs ; .../playground ; https://google.serper.dev/ ; https://google.serper.dev/openapi.json ; https://scrape.serper.dev/` → 404 (docs), 200 (playground, client-rendered Next.js shell with no param docs), 403, 403, 403 (scrape host exists, keyed)

### 9.7 GetSongBPM (+ tunebat, songbpm)
- `curl -sS -L -D - -o /dev/null -w "HTTP %{http_code}\n" "https://getsongbpm.com/api"` → 403; headers cf-mitigated: challenge, server: cloudflare; 5371-byte HTML 'Just a moment...' Cloudflare managed challenge (docs page not readable by curl)
- WebFetch https://getsongbpm.com/api → HTTP 403 Forbidden, body not retrieved (also blocked)
- `curl -sS -L -o /dev/null -w "HTTP %{http_code}" "https://getsongbpm.com/"` ; `curl ... "https://getsongbpm.com/robots.txt"` → 403 cf-mitigated: challenge for both; entire getsongbpm.com origin challenges curl
- `curl -sS -L -w "HTTP %{http_code} ct=%{content_type} size=%{size_download}" "https://getsong.co/api"` → 200, text/html, 13862 bytes, but content is an OVHcloud 'Site en construction' placeholder (not docs)
- `curl -sS "https://archive.org/wayback/available?url=getsongbpm.com/api"` → 200; closest snapshot status 200, timestamp 20260824151351, url http://web.archive.org/web/20260824151351/https://getsongbpm.com/api
- `curl -sS "https://web.archive.org/cdx/search/cdx?url=getsongbpm.com/api&output=json&limit=-5&filter=statuscode:200"` → 200; five 200-status snapshots: 20250605100413, 20250829084145, 20260312032305, 20260628043723, 20260824151351
- `curl -sS -L -D wb_docs.hdr -o wb_docs.html "http://web.archive.org/web/20260824151351id_/https://getsongbpm.com/api"` → 200, text/html, 39898 bytes, memento-datetime: Mon, 24 Aug 2026 15:13:51 GMT; full docs HTML with signup form (getKey/getBl/getEmail), base URL https://api.getsong.co/, 3000 req/hour, endpoint tables, and example JSON where "tempo":"220" and "time_sig":"4/4" are strings
- `dig +short api.getsongbpm.com ; dig +short api.getsong.co` → api.getsongbpm.com → 104.26.0.33, 172.67.74.170, 104.26.1.33 ; api.getsong.co → 104.21.11.90, 172.67.165.179 (both resolve; both Cloudflare)
- `curl -sS -D - -w "HTTP %{http_code} ct=%{content_type}" "https://api.getsongbpm.com/search/?api_key=INVALID&type=both&lookup=song:the%20lovecats%20artist:the%20cure"` → 403, text/html, cf-mitigated: challenge, Cloudflare 'Just a moment...' HTML (cZone: api.getsongbpm.com) — old host is challenge-blocked, not a JSON error
- `curl -sS -o /dev/null -D - "http://api.getsongbpm.com/search/?api_key=INVALID&type=song&lookup=fever"` → 301 Moved Permanently, Location: https://api.getsongbpm.com/search/?... (redirects to https on the SAME old host, not to api.getsong.co)
- `curl -sS -D - -w "HTTP %{http_code} ct=%{content_type} size=%{size_download}" "https://api.getsong.co/search/?api_key=INVALID&type=both&lookup=song:the%20lovecats%20artist:the%20cure"` → 401, Content-Type text/html; charset=UTF-8, 41 bytes, body {"error":"Invalid API Key, or inactive."}, access-control-allow-origin: *, server: cloudflare, cf-cache-status: DYNAMIC, no rate-limit headers
- `curl -sS -w "HTTP %{http_code}" "https://api.getsong.co/search/?type=both&lookup=song:the%20lovecats%20artist:the%20cure"` → 401, 31 bytes, body {"error":"API Key is missing."}, access-control-allow-origin: *
- `curl -sS -H "X-API-KEY: INVALID" -w "HTTP %{http_code}" "https://api.getsong.co/search/?type=song&lookup=fever"` → 401, body {"error":"Invalid API Key, or inactive."} (header auth path is honoured)
- `curl -sS "https://api.getsong.co/song/?api_key=INVALID&id=983pJ"` ; .../tempo/?api_key=INVALID&bpm=120 ; .../key/?api_key=INVALID&key=1&mode=1 ; .../artist/?api_key=INVALID&id=abc ; https://api.getsong.co/ → all 401 with {"error":"Invalid API Key, or inactive."}; root without key 401 {"error":"API Key is missing."}; endpoints exist (key is checked before params)
- `curl -sS -w "HTTP %{http_code} ct=%{content_type}" "https://api.getsong.co/nonexistent/?api_key=INVALID"` → 404, text/html; charset=iso-8859-1, Apache-style HTML '404 Not Found' (not JSON)
- `curl -sS -X OPTIONS -D - -H "Origin: http://localhost:3000" -H "Access-Control-Request-Method: GET" "https://api.getsong.co/search/?api_key=INVALID&type=song&lookup=fever"` → 401, access-control-allow-origin: *, no access-control-allow-headers / allow-methods
- `curl -sS -D - -w "HTTP %{http_code} ct=%{content_type}" "https://tunebat.com/Search?q=lovecats"` → 403, text/html, cf-mitigated: challenge, 5425-byte Cloudflare 'Just a moment...' page
- `curl -sS -D - "https://tunebat.com/robots.txt" ; dig +short api.tunebat.com ; curl -sS -D - "https://api.tunebat.com/api/tracks/search?term=lovecats"` → robots.txt 403 cf-mitigated: challenge; api.tunebat.com resolves to 104.26.2.91/172.67.72.16/104.26.3.91; API URL 403 cf-mitigated: challenge (no keyless JSON reachable)
- `curl -sS -L -D - -w "HTTP %{http_code} ct=%{content_type} size=%{size_download}" "https://songbpm.com"` → 200, text/html, 176078 bytes, Astro v6.4.8 site, server: cloudflare, no challenge; page contains <form id="search-form" action="/searches" method="POST">; no /api/, fetch( or JSON references (only PostHog api_host https://us.i.posthog.com)
- `curl -sS -w "HTTP %{http_code} ct=%{content_type}" "https://songbpm.com/api" ; curl -sS -H "Accept: application/json" -w "HTTP %{http_code} ct=%{content_type}" "https://songbpm.com/searches?q=lovecats" ; curl -sS "https://songbpm.com/robots.txt"` → /api → 200 text/html (an artist page titled 'BPM and key for songs by Api', not an API); /searches?q= GET → 404 text/html; robots.txt 200 with Cloudflare Content-Signal: search=yes,ai-train=no,use=reference
- `curl -sS "https://registry.npmjs.org/-/v1/search?text=getsongbpm&size=10" ; curl -sS -w "%{http_code}" "https://pypi.org/pypi/getsongbpm/json" ; "https://pypi.org/pypi/getsong/json"` → npm total=0 packages; PyPI getsongbpm 404; PyPI getsong 200 but is an unrelated YouTube song downloader (blha303)

### 9.8 Toolchain
- `node --version && npm --version && uname -m && sw_vers && xcode-select -p && python3 --version` → v24.20.0 / 11.19.0 / arm64 / macOS 15.5 (24F74) / /Library/Developer/CommandLineTools / Python 3.13.5
- `npm view next version; npm view react version; npm view react-dom version; npm view better-sqlite3 version; npm view @anthropic-ai/sdk version; npm view typescript version; npm view tailwindcss version; npm view zod version; npm view vitest version` → next 16.3.4; react 19.2.8; react-dom 19.2.8; better-sqlite3 13.0.3; @anthropic-ai/sdk 0.124.0; typescript 7.0.2; tailwindcss 4.3.3; zod 4.5.4; vitest 5.0.0 (10 s total)
- `npm view next@latest peerDependencies --json` → {sass ^1.3.0, react ^18.2.0 || 19.0.0-rc-de68d2f4-20241204 || ^19.0.0, react-dom (same), @playwright/test ^1.51.1, @opentelemetry/api ^1.1.0, babel-plugin-react-compiler *}; engines node >=20.9.0
- `npm view next versions --json | tail -40; npm view next dist-tags --json` → stable tail 16.3.1..16.3.4 then 16.4.0-canary.0..19; dist-tags latest=16.3.4, canary=16.4.0-canary.19, backport=15.5.25, next-15-3=15.3.9; last 15.x stable = 15.5.25
- `npx --yes create-next-app@latest probe-app --ts --app --eslint --tailwind --src-dir --import-alias "@/*" --use-npm --yes` → exit 0 in 47 s; template app-tw; added 359 packages in 42 s; generated route types; initialized a git repo; installed next 16.3.4 / react 19.2.8; scripts dev=next dev, build=next build (Turbopack default, no flag)
- `npm install better-sqlite3 @anthropic-ai/sdk zod --foreground-scripts` → exit 0 in 3 s; added 9 packages; no prebuild-install/node-gyp output; 'npm warn install-scripts ... not yet covered by allowScripts'; build/Release absent; npm install-scripts ls → better-sqlite3@13.0.3 (install: node-gyp rebuild) and unrs-resolver@1.12.2 (postinstall) gated
- `npm install-scripts approve better-sqlite3 && npm rebuild better-sqlite3 --foreground-scripts` → approve wrote package.json "allowScripts": {"better-sqlite3@13.0.3": true}; rebuild 3 s: node-gyp@12.4.0 fetched node-v24.20.0 headers (HTTP 200), make only TOUCHed .stamp files (no compile, binding.gyp prebuild_exists=1); still no build/Release/*.node
- `node sqlite-proof.cjs` (inside probe-app) → exit 0 in 431 ms: {"node":"v24.20.0","arch":"arm64","row":{"id":1,"artist":"The Cure","title":"The Lovecats","year":1983,"sqlite":"3.53.4"}}
- `node -e "const D=require('better-sqlite3'); new D(':memory:'); console.log(process.report.getReport().sharedObjects.filter(s=>/sqlite/i.test(s)))"` → ['/usr/lib/libsqlite3.dylib', './node_modules/better-sqlite3/prebuilds/darwin-arm64.node'] → prebuilt Mach-O arm64 bundle (1,980,736 bytes) is what loads; binding loads lazily on new Database()
- `node --input-type=module -e "import Database from 'better-sqlite3'; ..."` → esm ok { one: 1 }
- `node -e "const {DatabaseSync}=require('node:sqlite'); ..."` → node:sqlite OK { a: 42, v: '3.53.4' } (built-in, no native dep)
- `npx tsc --noEmit` (before @types/better-sqlite3) → exit 2 in 1 s: src/app/api/ping/route.ts(1,22): error TS7016: Could not find a declaration file for module 'better-sqlite3'
- `npm install -D @types/better-sqlite3 && npx tsc --noEmit` → @types/better-sqlite3 9.6.0 installed in 2 s; tsc exit 0 in 1 s (import Anthropic from '@anthropic-ai/sdk' type-checks)
- `npm run build` → exit 0 in 5 s: '▲ Next.js 16.3.4 (Turbopack)', Compiled successfully in 2.6s, Finished TypeScript in 658ms, routes ○ / , ○ /_not-found, ƒ /api/ping (Dynamic); no native-module warnings; next.config.ts empty
- `node -e "...parse node_modules/next/dist/lib/server-external-packages.jsonc..."` → 79 entries; includes better-sqlite3 (also sqlite3, libsql, @libsql/client, prisma, @prisma/client, pg, sharp); does NOT include @anthropic-ai/sdk or zod
- `grep better-sqlite3 .next/server/chunks/*.js; node -e "...route.js.nft.json..."` → externalized as require("better-sqlite3-90e2652d1716b047") in [root-of-the-server]__20sl4ra._.js; trace has 129 files incl. 26 better-sqlite3 files and node_modules/better-sqlite3/prebuilds/darwin-arm64.node; 0 @anthropic-ai files (SDK bundled)
- `PORT=3999 npm run dev` (background) ; `curl -s -i http://127.0.0.1:3999/api/ping` → '▲ Next.js 16.3.4 (Turbopack)' Ready in 234ms; 200 after 2 s; content-type application/json; body {"ok":true,"row":{"id":1,"name":"sting","sqlite":"3.53.4"},"sdkIsClass":true,"node":"v24.20.0","arch":"arm64"}; 2nd request 200 in 2.8 ms; GET / 200 in 1.73 s
- `kill_tree <npm pid>; lsof -ti :3999; pgrep -fl toolchain-probe` → port 3999 free; no toolchain-probe processes remain (verified twice)
- `npm run lint` → exit 1 in 2 s: only error is sqlite-proof.cjs 1:18 @typescript-eslint/no-require-imports (the probe's own file); eslint 9.39.5 runs fine; @unrs/resolver-binding-darwin-arm64 present despite gated postinstall
- `du -sh probe-app probe-app/node_modules probe-app/.next` → 574M total; node_modules 502M; .next 71M; 295 top-level packages
- `sed -n '30,75p;1845,1885p;2060,2085p' node_modules/@anthropic-ai/sdk/resources/messages/messages.d.ts; cat helpers/zod.d.ts lib/parser.d.ts` → messages.parse() + output_config.format; interface OutputConfig { effort?: 'low'|'medium'|'high'|'xhigh'|'max'|null; format?: JSONOutputFormat|null }; interface JSONOutputFormat { schema: {[key:string]:unknown}; type: 'json_schema' }; zodOutputFormat<ZodInput extends z.ZodType>(zodObject) from '@anthropic-ai/sdk/helpers/zod' (imports 'zod/v4'); ParsedMessage has parsed_output; Tool.strict?: boolean; no output_format/response_format param

---

## 10. Open questions / untested

**Needs a key (nothing observed beyond error shapes)**
1. Last.fm: every success JSON shape (`similartracks`, `toptags`, `toptracks`/`tracks` container key, `@attr` nesting, whether `playcount` appears on similar tracks, `match` range for tracks, autocorrect mapping "The Love Cats" → "The Lovecats", "Track not found" message text, presence of Cache-Control on success responses), and sample-set coverage 0/15 measured.
2. Spotify: `/v1/search` (incl. `q=isrc:`) results, `POST /v1/me/playlists`, `POST /v1/playlists/{id}/items`, PKCE token exchange, whether `user-read-private` is really required for search, 429/`Retry-After` behaviour, whether the embed iframe plays 30 s or full song / needs login, and sample-set coverage 0/15 (keyless Wikidata bridge resolved only The Lovecats before 429).
3. Tavily / Brave / Exa / Serper: any real search; real latency; sample-set coverage 0/15 for each; what Tavily `content`/`raw_content` actually contain for reddit.com threads; Brave LLM Context billing; Exa quoted-phrase matching and the per-page rate for `contents.text`/`highlights` on `/search`; Serper `num`/`page`/`tbs` params.
4. GetSongBPM: any success response, real field types beyond the docs example, 429 behaviour after 3000 req/hour, sample-set coverage 0/15; docs were read from a 2026-08-24 Internet Archive snapshot because getsongbpm.com challenge-blocks curl.
5. Anthropic API: no request made; `messages.parse` + `output_config.format` verified only in the installed types.

**Keyless but not yet done**
6. ~~MusicBrainz ISRC lookup on the **plain-search** Deezer ISRCs~~ DONE [corrected in verification]: NLG620480565 404, TCABP1327651 → b944f19c (AB 63), ATE611000013 → 123f59a2 (AB 48), USEM39700073 → 05f63c90 (AB 17), GBBRP0922203 404 — see section 3.3. Still 13/15 in MB and 10/15 ISRC-only in AB, but the plain picks land on the canonical studio recordings.
7. iTunes explicit-content filtering from a non-SA vantage point — "geo-based" is inferred; 0 `explicit` values were seen in 738 records.
8. iTunes 403/429 error shape — never triggered (25 origin misses in 18.5 s were all 200).
9. Actual browser playback of Deezer / iTunes / Spotify previews — only CORS/Range headers were observed via curl.
10. Deezer `preview` re-mint cost under the 50 req/5 s quota when many tracks are on screen; whether the same-resource "no throttle" observation holds for `/search`.
11. MusicBrainz 503 frequency over longer runs (12 of ~45 in this probe) and whether a contact URL/email in the User-Agent changes it.
12. AcousticBrainz coverage for the 2021–2022 window (only 2020 and 2023 samples exist: telepatía has 8 submissions, vampire 0).
13. Deezer `available_countries` vs the deployment location: The Lovecats 1143631 is not available in US; the app was probed from SA.

**Toolchain**
14. `next build` with `output: "standalone"` (trace includes the prebuilt `.node`, but standalone itself not run).
15. ~~`node:sqlite` (DatabaseSync) inside a Next/Turbopack route and its typings under `@types/node` 20.~~ DONE [Verification addendum (Next.js), item (d)]: works at runtime in both `next dev` and `next start`; **no typings** under `@types/node` 20.19.43 (`TS2307: Cannot find module 'node:sqlite'`), needs `// @ts-expect-error` or `@types/node` ≥ 22.
16. TypeScript 7.0.2 (template pins `^5`; 5.9.3 used); vitest 5.0.0 (only `npm view`).
17. Whether `npm install-scripts approve` needs re-running on a better-sqlite3 version bump (the approval is pinned to `better-sqlite3@13.0.3`).

**Probe-internal inconsistencies flagged**
18. Deezer probe: the summary said "6/24 ids had bpm 0" while its own per-id table and verified-command note list 7 zero-bpm ids (3392254691, 2440763155, 2713054981, 3677797302, 1148585682, 1761439787, 3049462741). This document uses 7/24.
19. Deezer vs MB/AB probes chose different Deezer ids for 7 tracks (Prima, Zoot Suit Riot, Lone Digger, Smooth Operator, Booty Swing, Mr. Pinstripe Suit, Apple Pie Bed) because one used plain search and the other advanced syntax; their per-track ISRC/bpm numbers differ accordingly and are both reported above with the id that produced them.
20. The Spotify brief's "25 users" figure conflicts with the live quota-modes page ("Up to 5 authenticated Spotify users"); the doc value is used.

---

## Verification addendum (Next.js)

Second pass on 2026-09-06 (~12:43–12:50 UTC) by a Next.js reviewer, in the same probe app (`…/scratchpad/toolchain-probe/probe-app`, Next 16.3.4, React 19.2.8, better-sqlite3 13.0.3, Node v24.20.0 arm64). Every claim below is from a request actually run; raw outputs are in `…/scratchpad/verify-next/` (`dev-probes.txt`, `prod-probes.txt`, `dev.log`, `dev2.log`, `dev3.log`, `start.log`, `build*.log`, `*-mb.json`). Probe routes added under `src/app/api/{echo,counter,mb,cachetest,sse,nodesqlite,sqlitefile}/route.ts` (left in place; `src/proxy.ts` / `src/middleware.ts` removed again). Both servers were started on free ports (`PORT=3998 npm run dev`, `PORT=3997 npm start`, later 3996/3995 for the proxy tests) and killed; `lsof -ti :3995 -ti :3996 -ti :3997 -ti :3998` was empty and `pgrep -fl 'next dev|next-server|next start'` returned 0 at the end.

### (a) Default User-Agent of `fetch` inside a route handler — MusicBrainz REJECTS it (403 `ua-short`)

Route `src/app/api/mb/route.ts` fetches `${origin}/api/echo` (a route that returns `Object.fromEntries(req.headers)`) and then `https://musicbrainz.org/ws/2/recording?query=recording:%22The%20Lovecats%22%20AND%20artist:%22The%20Cure%22&limit=1&fmt=json` twice (1.1 s apart): once with no explicit UA, once with `headers: { "User-Agent": "ItStings/0.1 (local dev)" }`.

`curl -s -D prod-mb.hdr -o prod-mb.json -w 'total %{time_total}s http %{http_code}\n' http://localhost:3997/api/mb` → `total 1.567772s http 200`, body (abridged, `next start`):
```json
{"requestHeadersSentByDefaultFetch":{"accept":"*/*","accept-encoding":"gzip, deflate","accept-language":"*","connection":"keep-alive","host":"localhost:3997","sec-fetch-mode":"cors","user-agent":"node", ...},
 "noExplicitUA":{"ms":337,"v":{"status":403,"server":"openresty","xRatelimitWho":"ua-short","xMbRateLimiter":"lua","xRatelimitLimit":null,"retryAfter":null,
   "bodyHead":"{\"error\": \"Your requests are being throttled by MusicBrainz because the application you are using has not identified itself. Please update your application, and"}},
 "withUA":{"ms":112,"v":{"status":200,"xRatelimitLimit":"360","count":36,"bodyHead":"{\"created\":\"2026-09-06T12:43:50.305Z\",\"count\":36,\"offset\":0,\"recordings\":[{\"id\":\"5ba073e7-9c96-4eb5-"}}}
```
- Node/undici's default request UA, as seen by the echo route, is literally **`user-agent: node`** (identical in `next dev` and `next start`). MusicBrainz answers **403** with a header value not seen in the first pass: **`x-ratelimit-who: ua-short`** (the earlier probe saw `ua-missing` for an empty UA). Body is the same "has not identified itself" JSON.
- With `headers: { "User-Agent": "ItStings/0.1 (local dev)" }` the same URL → **200**, `x-ratelimit-limit: 360`, `count: 36`.
- **Hazard:** every MusicBrainz (and AcousticBrainz) `fetch` from a route handler must set `User-Agent` explicitly; wrap it in one helper. Next does not add or alter the UA.
- Surprise: the `created` timestamp in the 200 body served to `next start` at 12:44:49 UTC was `2026-09-06T12:43:50.305Z` — the exact time of the *dev* process's request one minute earlier. Different process, `cache: "no-store"` → this is MusicBrainz's own search-result cache, not Next's.
- Surprise (dev run 2, `dev2-mb.json`): with the correct UA, MB returned **503** twice: `{"status":503,"server":"openresty","xRatelimitWho":"global","xMbRateLimiter":"lua","xRatelimitLimit":"15","retryAfter":"0","bodyHead":"{\"error\": \"The MusicBrainz web server is currently busy. Please try again later.\"}\n"}` and then `xRatelimitWho: "search-shed"`, `xRatelimitLimit: "1200"`, `retryAfter: "0"`. Confirms open question 11: the route handler needs 503 retry with its own backoff (`retry-after: 0` is useless).
- Dev-only timing anomaly, observed once, **not reproduced**: in the first `next dev` run the first `GET /api/mb` took `11.0s (next.js: 40ms, application-code: 11.0s)` (dev.log). In the second dev run the same first call took 1.59 s (`noExplicitUA ms 324`, MB 503 in 107 ms, plus the 1.1 s sleep) and 1.34 s on the second call; `next start` took 1.57 s. Treat cold outbound HTTPS from `next dev` as potentially slow; don't set tight upstream timeouts in dev.

### (b) Next's fetch cache — does NOT interfere by default; `no-store` changes the *request headers*

Route `src/app/api/cachetest/route.ts` calls `${origin}/api/counter` (module-level `let n = 0; n += 1`) five times: two with no options, one `{ cache: "no-store" }`, two `{ cache: "force-cache" }`. Called twice, 2 s apart, in both modes.

`curl -s http://localhost:3997/api/cachetest; sleep 2; curl -s http://localhost:3997/api/cachetest` (`next start`):
```
{"default1":{"n":1,...},"default2":{"n":2,...},"noStore":{"n":3,...},"forceCache1":{"n":4,"t":1788698689425,...},"forceCache2":{"n":4,"t":1788698689425,...},"handlerTime":1788698689426}
{"default1":{"n":5,...},"default2":{"n":6,...},"noStore":{"n":7,...},"forceCache1":{"n":4,"t":1788698689425,...},"forceCache2":{"n":4,"t":1788698689425,...},"handlerTime":1788698691460}
```
`next dev` (port 3998) gave the identical pattern (n=1,2,3,4,4 then 5,6,7,4,4).
- **Default `fetch()` (no `cache` option) in a route handler hits the origin every time**, in dev and prod — there is no request memoization in Route Handlers (the bundled docs say so too: `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/fetch.md` "Memoization does not apply in Route Handlers") and no Data Cache write. **`cache: 'no-store'` is not required** for correctness on GET route handlers in 16.3.4 (all `/api/*` routes build as `ƒ (Dynamic)`).
- `cache: 'force-cache'` DOES persist across requests in both `next dev` and `next start` (n stayed 4 with the same `t`). Never use it for proxy calls whose upstream is rate-limited-by-URL unless that is the intent; the app's SQLite cache should be the only cache.
- **Hazard found:** passing `cache: "no-store"` makes Next's patched fetch add two *request* headers upstream. Echo of a default fetch: no cache headers. Echo of a `no-store` fetch: `"cache-control":"no-cache","pragma":"no-cache"` (seen in both dev and prod, `requestHeadersSentByNoStoreFetch` in `*-mb.json`). Upstream CDNs (iTunes/Deezer/Last.fm) may treat `Cache-Control: no-cache` as a cache bypass, i.e. slower and more origin load. Recommendation: **omit the `cache` option** for proxied calls; do not sprinkle `no-store`.
- Next adds nothing else: the outgoing request carried only `accept: */*`, `accept-encoding: gzip, deflate`, `accept-language: *`, `sec-fetch-mode: cors`, `user-agent: node` (plus x-forwarded-* injected by the local receiving server).
- Route-handler responses carry **no `Cache-Control` header** at all in either mode (`curl -s -i /api/counter` → `vary: rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch`, `content-type: application/json`, `Date`, `Connection: keep-alive`, `Transfer-Encoding: chunked`). Set `Cache-Control: no-store` yourself on proxy routes if browser-side caching matters.
- Docs caveat (not exercised): `fetch.md` says the dev-only **HMR cache** (`serverComponentsHmrCache`) applies to `no-store` fetches *in Server Components* between HMR refreshes; route handlers were not affected in this probe (counter advanced on every call).

### (c) Streaming / SSE from a route handler works in `next dev` and `next start`

`src/app/api/sse/route.ts` returns `new Response(new ReadableStream({ start(c){ …enqueue 3 events 700 ms apart… } }), { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" } })`.

`curl -N -s -i --trace-time -v http://localhost:3998/api/sse` (dev):
```
15:43:52.421867 < HTTP/1.1 200 OK
15:43:52.421896 < cache-control: no-cache, no-transform
15:43:52.421911 < content-type: text/event-stream
15:43:52.421925 < Transfer-Encoding: chunked
event: tick
data: {"i":1,"t":1788698632584}
event: tick
data: {"i":2,"t":1788698633287}
event: tick
data: {"i":3,"t":1788698633989}
event: done
data: {}
```
A python `urllib` reader timestamped each line as it arrived (dev): `+0.010s 'event: tick'` … `+0.713s 'event: tick'` … `+1.415s 'event: tick'` … `+2.117s 'event: done'`; prod: `+0.006s`, `+0.707s`, `+1.410s`, `+2.111s`. The 700 ms gaps prove chunks are flushed incrementally, not buffered until close. Server log: `GET /api/sse 200 in 2.1s (next.js: 30ms, application-code: 2.1s)`. `Connection: keep-alive` and the custom `Cache-Control` passed through untouched; no compression was applied (the `no-transform` was honoured, body arrived as raw chunks).

### (d) better-sqlite3 (and `node:sqlite`) under Turbopack `next dev` — loads fine

- The first pass already ran `/api/ping` under `next dev` (section 8); re-confirmed: `curl -s -i http://localhost:3998/api/ping` → `{"ok":true,"row":{"id":1,"name":"sting","sqlite":"3.53.4"},"sdkIsClass":true,"node":"v24.20.0","arch":"arm64"}` (dev.log: `GET /api/ping 200 in 163ms`), identical under `next start`.
- Realistic pattern, `src/app/api/sqlitefile/route.ts`: file DB at `path.join(process.cwd(), ".probe-cache.sqlite")`, `db.pragma("journal_mode = WAL")`, singleton on `globalThis.__itstingsDb`, upsert per request. 3× `curl -s /api/sqlitefile` → `{"ok":true,"opens":1,"rows":1,"journal":"wal","file":".../probe-app/.probe-cache.sqlite"}` each time in both dev and prod: **one open per process**, WAL active (`.probe-cache.sqlite-wal` / `-shm` appeared on disk), `process.cwd()` is the app dir under both `next dev` and `next start`. The `globalThis` guard is what keeps the handle across Turbopack HMR re-evaluations; module-level state alone is also preserved between requests when nothing is edited (the `/api/counter` module counter advanced 1…9 across a dev session).
- `src/app/api/nodesqlite/route.ts` with `import { DatabaseSync } from "node:sqlite"` → `curl -s -i /api/nodesqlite` → `{"ok":true,"row":{"a":42,"v":"3.53.4"}}` in both modes (dev.log `GET /api/nodesqlite 200 in 43ms`). Resolves open question 15 at runtime. **But** `npx tsc --noEmit` → `src/app/api/nodesqlite/route.ts(2,30): error TS2307: Cannot find module 'node:sqlite' or its corresponding type declarations.` under `@types/node` 20.19.43 (template pin `^20`); needed `// @ts-expect-error` to pass `next build`'s type step. Bump `@types/node` to `^22`/`^24` if `node:sqlite` is used.
- `next build` after adding all routes: exit 0, `✓ Compiled successfully in 589ms`, `Finished TypeScript in 801ms`, all `/api/*` listed as `ƒ (Dynamic)`; total 3.4 s wall.

### (e) Next 16 `proxy.ts` vs `middleware.ts`, and `serverExternalPackages`

- Bundled docs (`node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md` §"`middleware` to `proxy`", and `03-api-reference/03-file-conventions/{proxy,middleware}.md`): `middleware` file+export are **deprecated**, renamed to `proxy`; **proxy runs on the `nodejs` runtime only, not configurable, `edge` runtime NOT supported in `proxy`**; `skipMiddlewareUrlNormalize` → `skipProxyUrlNormalize`; codemod `npx @next/codemod@canary middleware-to-proxy .`. Place it at `src/proxy.ts` when using `src/`.
- Tested `src/proxy.ts` (`export function proxy(req: NextRequest)` setting request header `x-proxy-ran: 1` via `NextResponse.next({ request: { headers } })` and response header `x-proxy-response: 1`, `config.matcher = "/api/:path*"`). `PORT=3996 npm run dev`; `curl -s -i http://localhost:3996/api/echo` → `HTTP/1.1 200 OK`, `x-proxy-response: 1`, body headers include `"x-proxy-ran":"1","x-proxy-response":"1"`. Dev log line format gains a column: `GET /api/echo 200 in 199ms (next.js: 99ms, proxy.ts: 91ms, application-code: 8ms)`. Note that the **internal `fetch(\`${origin}/api/echo\`)` from inside `/api/mb` also passed through proxy.ts** (`requestHeadersSentByDefaultFetch` contained `x-proxy-ran: 1`) — a proxy that enforces auth would block route-to-route self-calls.
- `npm run build` with `src/proxy.ts` → exit 0, route table adds **`ƒ Proxy (Middleware)`**; on disk it is still `.next/server/middleware.js`, `middleware-manifest.json`, `middleware.js.nft.json` (internal name unchanged).
- **Hazard — both files present hangs the dev server:** with `src/middleware.ts` AND `src/proxy.ts`, `PORT=3995 npm run dev` printed `✓ Ready in 147ms`, then `⚠ The "middleware" file convention is deprecated. Please use "proxy" instead.` and `Unhandled Rejection: Error: Both middleware file "./src/middleware.ts" and proxy file "./src/proxy.ts" are detected. Please use "./src/proxy.ts" only.` — the process **kept listening on the port and never answered**: `curl -s -i --max-time 5 http://localhost:3995/api/echo` produced no bytes; an un-timed curl hung until killed. Not a clean crash.
- **Hazard — stale `.next/dev/types` breaks `next build`:** after that crashed dev run, `npm run build` failed the TypeScript step with 10 errors in generated files: `.next/dev/types/validator.ts(5,50): error TS2305: Module '"./routes.js"' has no exported member 'AppRouteHandlerRoutes'`, `…(40,59): error TS2536: Type 'Route' cannot be used to index type 'ParamMap'` ×7, `…(52,52)/(137,51): error TS2344: Type '"/"' does not satisfy the constraint 'never'`, `Failed to type check.` Cause: the scaffold's `tsconfig.json` `include` has `.next/dev/types/**/*.ts`, and the crashed dev server had written a `routes.d.ts` with `type AppRoutes = never`. Reproduced with proxy.ts removed (build A: exit 1, 10 `error TS`); `rm -rf .next/dev` then build (B) → exit 0. **Recovery recipe: `rm -rf .next/dev` whenever `next build` fails inside `.next/dev/types/`.** Consider running `next build` only after a clean dev shutdown, or in CI from a clean checkout.
- `serverExternalPackages`: unchanged from section 8 — `node_modules/next/dist/lib/server-external-packages.jsonc` (103 lines) lists `better-sqlite3` (line 33) and `sqlite3` (line 90) by default; the empty `next.config.ts` was used for every run above. The docs file `serverExternalPackages.md` only records the v15 rename from `serverComponentsExternalPackages`; nothing new in 16.
- Turbopack is the default for both `next dev` and `next build` (`▲ Next.js 16.3.4 (Turbopack)` in every dev/build log; `next start` prints `▲ Next.js 16.3.4` without the tag). The docs note a custom `webpack` key in `next.config` makes `next build` **fail** unless `--webpack` is passed; filesystem caching (`experimental.turbopackFileSystemCacheForDev/ForBuild`) is on by default — the second dev start was `Ready in 157ms` and the second build `Compiled successfully in 589ms` vs 2.6 s in the first pass.

### Exact commands used (Next.js addendum)
```
cd ".../scratchpad/toolchain-probe/probe-app"
npx tsc --noEmit                          # TS2307 on node:sqlite until @ts-expect-error added
PORT=3998 npm run dev > .../verify-next/dev.log 2>&1 &   ; .../verify-next/run-probes.sh 3998 dev
npm run build                              # exit 0, all /api/* ƒ (Dynamic)
PORT=3997 npm start   > .../verify-next/start.log 2>&1 & ; .../verify-next/run-probes.sh 3997 prod
# run-probes.sh: curl -s /api/echo ; curl -s -D -o -w 'total %{time_total}s http %{http_code}\n' /api/mb ;
#   curl -s /api/cachetest (x2, sleep 2) ; curl -s -i /api/counter (x2) ;
#   curl -N -s -i --trace-time -v /api/sse ; python3 urllib line-timing of /api/sse ;
#   curl -s -i /api/ping ; curl -s /api/sqlitefile (x3) ; curl -s -i /api/nodesqlite
PORT=3996 npm run dev (with src/proxy.ts)  ; curl -s -i /api/echo ; curl /api/mb (x2)
PORT=3995 npm run dev (proxy.ts + middleware.ts) ; curl -s -i --max-time 5 /api/echo   # hang
npm run build (stale .next/dev)  → exit 1 ; rm -rf .next/dev ; npm run build → exit 0 ; +proxy.ts → exit 0 "ƒ Proxy (Middleware)"
kill <pid>; pkill -f "next dev"; pkill -f "next-server"; lsof -ti :3995 -ti :3996 -ti :3997 -ti :3998   # empty
```

---

## Verification addendum (completeness)

Completeness pass run **2026-09-06 ~12:40–13:00 UTC** from the same SA-geolocated machine. Method: for each of the six consumers (iTunes typeahead, ISRC resolver, preview player, Last.fm channels, web-search evidence channel, tempo lookups) list what an engineer would still have to guess at after reading sections 1–10, then fill the most important gaps with real requests. Every number below was observed in a request listed in "Commands run" at the end of this addendum. Nothing above this heading was modified. Raw bodies/headers are in `…/scratchpad/critic/` (`it_*.json`, `dz_*.json`, `mb_*.json(.h)`, `ab_*.json`, `mb_log.txt`).

### A. Typeahead (iTunes) — gaps filled

**A1. Correction: track objects are NOT always "exactly 31 keys". Three optional keys exist.**
- `contentAdvisoryRating` (string) appears on every `trackExplicitness:"cleaned"` record: all 5 results of `term=cardi+b+wap&country=US` have 32 keys, the extra being `contentAdvisoryRating:"Clean"`; the SA-storefront `vampire` hits (1694768031, 1736995100) also carry `contentAdvisoryRating:"Clean"`. The value `"Explicit"` was never observed from this IP (consistent with §3.1: no `explicit` records reach SA). `notExplicit` records do not carry the key at all.
- `collectionArtistId` (int) + `collectionArtistName` (string) appear on tracks that sit on various-artists compilations: `term=misirlou+dick+dale` → ids 716598516 (`collectionArtistName:"Various Artists"`, `collectionArtistId:4035426`) and 1469433643 (`"Various Artists"`, 151566958) have 33 keys; the other 8 results have 31.
- Type the result as: 31 required keys (§3.1) plus `contentAdvisoryRating?: "Clean" | "Explicit"`, `collectionArtistId?: number`, `collectionArtistName?: string`. Do not fail parsing on unexpected keys. Use `collectionArtistName === "Various Artists"` as a cheap "compilation" signal when ranking candidates.

**A2. Apostrophes/commas in `term` are fine when URL-encoded.** `--data-urlencode "term=Cherry Poppin' Daddies Zoot Suit Riot"` (sent as `term=Cherry+Poppin%27+Daddies+Zoot+Suit+Riot`) → 200, 5 results, #1 675806955 `Zoot Suit Riot` (studio), then `(Live '98)` 1184888534, `(20th Anniversary)` 1184887952, `(Spanish Version 20th Anniversary)` 1184888728, and a marching-band cover 553690470. So `encodeURIComponent` / `URLSearchParams` is sufficient; no special quoting.

**A3. The local storefront `country=SA` works and is a third id space.** 5/5 probes found: The Lovecats → trackId **1443749582** (220093 ms; also 1440932670 and 1440929252 at ranks 2–3), vampire → 1694768031 / 1736995100 (both `cleaned` + `contentAdvisoryRating:"Clean"`), telepatía → 1541731262 at rank 3 (ranks 1–2 are the `(acoustic)` versions 1567612021 / 1568640212 — different ordering from US, where the studio track is #1), Jump, Jive an' Wail → 725786770 / 726137265 / 730300531 (Louis Prima & Keely Smith), WAP → 1526747167 at rank 3 (ranks 1–2 are other Cardi B songs). Response `country:"SAU"`, `currency:"SAR"`; every hit had `previewUrl` and `isStreamable:true`. Only some ids coincide with US (1694768031, 1736995100, 1541731262, 1526747167 do; Lovecats does not). If the app defaults to `country=US`, users in SA still get playable previews (§3.1); if it defaults to the caller's storefront, store `(trackId, "SA")` — the ids are not interchangeable.

**A4. `/lookup?id=` accepts at least 200 comma-separated ids in one call.** Using the 200 `trackId`s from `term=fever&limit=200`: 50 ids → 200 in 1.19 s, `resultCount:50`, 75,008 B; 100 ids → 1.73 s, `resultCount:100`, 149,627 B; **200 ids → 2.01 s, `resultCount:200`, 302,062 B**. So a nightly cache refresh can re-validate 200 stored tracks per request (one `country` per call). Cap above 200 UNTESTED.

### B. Resolver (iTunes / Deezer / MusicBrainz / Spotify by ISRC) — gaps filled

**B1. Deezer advanced-search numeric filters are silently ignored on the public API — do not use them for duration matching.** Deezer's documented `dur_min`/`dur_max`/`bpm_min`/`bpm_max` operators had no effect: `q=artist:"The Cure" track:"The Lovecats" dur_min:999 dur_max:1000` → `total:4`, same four ids (1143631 220 s, 2887368212 228 s, 490397642 279 s, 67310084 247 s) as with no filter; identical with `strict=on` and with `order=RANKING`; `q=artist:"The Cure" dur_min:400` → `total:210`, first hit `Boys Don't Cry` 154 s; `q=artist:"The Cure" bpm_min:200 bpm_max:220` → same 210-item list. `q=isrc:"GBALB8300001"` → `{"data":[],"total":0}` (no ISRC search; only `/track/isrc:{ISRC}` exists). **Duration matching must be done client-side** on the `duration` (seconds, int) field of the search items.

**B2. Open question #6 closed: MusicBrainz `/isrc/` on the plain-search Deezer ISRCs.** (`inc=isrcs+artist-credits`, UA `ItStings/0.1 (local dev)`, 1.1 s spacing, retry on 503.)

| Deezer plain-search ISRC | Track | MB | Recording MBID | `disambiguation` / `length` / `first-release-date` | AB `count` | AB `rhythm.bpm` / key |
|---|---|---|---|---|---|---|
| NLG620480565 | Louis Prima — Jump, Jive an' Wail | **404** | — | — | — | — |
| TCABP1327651 | Cherry Poppin' Daddies — Zoot Suit Riot | 200 | **b944f19c-0a0c-4278-a613-c72ae8932232** (the canonical 1997 recording, which §3.3 could only reach via search) | "" / 233266 / 1997-07-01 | 63 | 91.9 / G# minor |
| ATE611000013 | Parov Stelar — Booty Swing | 200 (3rd attempt; 2× 503) | **123f59a2-69cf-4407-99e7-ce200a8e9ce8** — a *fourth* studio MBID not among §3.3's d259fc63 / 96bc94dd / abd85361 | "" / 197506 / 2010-11-19 | **48** | 112.9 / D minor |
| USEM39700073 | Big Bad Voodoo Daddy — Mr. Pinstripe Suit | 200 | **05f63c90-1953-4120-8676-b00c5216d59d** (the studio 1998 recording) | "" / 217800 / 1998-09 | 17 | 107.6 / A# minor |
| GBBRP0922203 | Lawrence Arabia — Apple Pie Bed | **404** | — | — | — | — |

Consequences for the resolver:
- With the plain-search Deezer pick (plus §3.2's `title_version` filter, which turns Lone Digger into 109590416 / FR89R1500001), the ISRC→MB hit rate stays **13/15** (misses: Louis Prima, Apple Pie Bed — both ISRCs are 404 whichever Deezer edition is chosen), but the ISRC-only **AcousticBrainz** coverage rises from **10/15 to 11/15** and, for Booty Swing and Mr. Pinstripe Suit, lands on the *studio* recordings (48 and 17 submissions) instead of the live ones §3.3 reached via the advanced-syntax ISRCs. Remaining ISRC-only AB misses: Louis Prima (404 in MB), Fever (1958 recording has 0 subs), vampire (2023), Apple Pie Bed (404 in MB) — all need the MB-search fallback, which works for Prima and Apple Pie Bed (§3.3).
- §3.3's statement "studio MBIDs d259fc63/96bc94dd/abd85361 have 0" for Booty Swing is incomplete: MB has at least one more studio recording (123f59a2) with 48 AB submissions. Always resolve through the ISRC first; MB search `limit` must be large enough (≥10) to surface all same-title recordings.
- `first-release-date` from `/isrc/` (`1997-07-01`, `2010-11-19`, `1998-09`) matches the expected original years for the three hits — usable as the app's "year" field, as §4 recommends. Note it can be month-precision (`1998-09`); parse as prefix, not as a full date.

**B3. MusicBrainz Lucene queries tolerate commas and apostrophes inside quoted phrases without escaping.** `query=recording:"Jump, Jive an' Wail" AND artist:"Louis Prima"` (URL-encoded `%2C` / `%27`) → 200, `count:27`, top score-100 hits include the apostrophe variants `Jump, Jive An' Wail`, `Jump, Jive an’ Wail` (curly), `Jump, Jive, An' Wail`, `Jump Jive an' Wail` — MB folds punctuation/apostrophe style in scoring, so the app does not need to normalise them before searching. `artist:"Cherry Poppin' Daddies"` → `count:17`. Only `"` and Lucene operators (`AND OR NOT + - ! ( ) { } [ ] ^ ~ * ? : \ /`) need escaping inside the phrase; none of the sample titles contain them except `<I°_°I>` (album, not queried).

**B4. MB 503 rate was worse than §3.3's 12/45: 10 of 22 attempts (12 distinct requests) returned 503 at 1.1 s spacing with a valid UA, including two runs of three consecutive 503s (Bad Habit search, Louis Prima search) that only succeeded on the 4th attempt.** All 503s returned in ~0.31 s (fast-fail from the gateway). A retry budget of 3 is *not* enough; use **≥4 attempts** (5 recommended) with ≥1.2 s backoff. Successful responses carried the non-per-client `x-ratelimit-remaining` values again (1200-limit lookups: 291…1086; 360-limit searches: 86…328) — confirming §3.3: ignore them.

**B5. iTunes ↔ Deezer/MB join by duration:** the SA/US/GB Lovecats ids differ in `trackTimeMillis` (220093 vs 218600 for 1440932670/1440929252) while Deezer says 220 s and MB says 220000 ms — a ±2 s window (§3.1) is enough, but do not require exact equality across storefronts.

### C. Preview player — gaps filled

**C1. `readable:false` / empty `preview` were never observed on search items** (300 items across `q=taylor swift`, `q=beatles`, `q=king crimson`, `limit=100` each: 0 `readable:false`, 0 empty `preview`). The region-limited id 1126164 (64 `available_countries`, §3.2) is `readable:true` with a `preview` from SA because `"SA"` is in its list. So the app cannot pre-detect an unplayable preview from the search item; treat `preview === ""` / `readable === false` defensively (documented Deezer behaviour for unavailable tracks) but expect it to be rare. UNTESTED from a country outside `available_countries`.

**C2. Deezer preview URL really does die at `exp` — observed, not inferred.** A `preview` minted at 12:42:56 UTC (`Date` header; `exp=1788699476` = 12:57:56 UTC, +900 s) was HEAD 200 `audio/mpeg` immediately, and at 12:58:30 UTC (34 s past `exp`) both `HEAD` and `Range: bytes=0-1000` GET returned **HTTP 403**, `server: AkamaiGHost`, `content-type: text/html`, 282-byte body `<HTML><HEAD><TITLE>Error</TITLE></HEAD><BODY>An error occurred while processing your request.<p>Reference&#32;&#35;199.…` with an `expires:` header equal to the response time (no `cache-control`, no `retry-after`). This is the same 403/HTML shape §3.2 saw for a tampered `exp`, so the player cannot tell "expired" from "tampered" from the response — it must compare `exp` to `Date.now()/1000` itself before handing the URL to `<audio>`, and treat any 403 from `cdnt-preview.dzcdn.net` as "re-mint via `/track/{id}` and retry once". Practical TTL: mint-time + 840 s (leave ≥60 s for the browser to start the fetch).

**C3. Spotify oEmbed edge cases:** a malformed track URL (`/track/abc`, not a 22-char base62 id) → **HTTP 504 `text/plain`** (not 404 — the same "upstream request timeout" shape as a missing `url` param, §3.5); a track URL carrying Spotify's share query (`/track/{id}?si=abc123`) → 200 `application/json` as normal. Validate the id format locally (`^[0-9A-Za-z]{22}$`) before calling oEmbed, and treat 504 as "bad request", not as "retry later".

### D. Last.fm channels — gap filled

**D1. Error precedence with a key present: key validity is checked before parameter presence.** `method=track.getSimilar&api_key=INVALID&format=json` with **no** `artist`/`track` → 403 `{"message":"Invalid API key - You must be granted a valid key by last.fm","error":10}`; same with `artist=The Cure` only (track missing) → 403 `error:10`. Combined with §3.4 (method existence is checked before the key), the observed order is: missing key → 6; unknown method → 3; invalid key → 10; only then parameter validation (→ 6, UNTESTED with a real key). So in the proxy's error mapper, `error:6` with a key configured can only mean "missing/invalid parameter or not found" and never "bad key".

### E. Web-search evidence channel — gap filled

**E1. Tavily authenticates before it validates the body.** `POST /search` with a bogus Bearer and `{"query":""}` → 401 `{"detail":{"error":"Unauthorized: missing or invalid API key."}}`; with `{"query":"lovecats","search_depth":"bogus"}` → the same 401. So a 401 says nothing about the request shape; parameter errors (422-style) are UNTESTED (needs key). Do not use a bogus-key call as a request-shape smoke test.

### F. Tempo lookups (AcousticBrainz / Deezer / GetSongBPM) — gaps filled

**F1. Open question #12 closed: AcousticBrainz coverage in the 2021–2022 window is thin but not zero.** MBIDs from MB search (`limit=8`, top score-100 hits), then one bulk `GET /api/v1/count?recording_ids=…` (21 ids) and one bulk `low-level?…&features=rhythm.bpm;tonal.key_key;tonal.key_scale` (2,803 B):

| Track (first release) | MBIDs checked | AB `count` | `rhythm.bpm` / key of the covered MBID |
|---|---|---|---|
| Olivia Rodrigo — drivers license (2021-01-08) | top-8 search hits: 4412d98a (music video), fc99fbd2 (Atmos explicit), 313c49d4 (live), 89bcfcbe (Atmos clean) → 0, 0, 0, 0. **Re-run with `limit=25` (all 23 recordings) → 2 MBIDs have data:** 143f1c88 (`disambiguation:"explicit"`, 2021-01-08) **20**, 88af1d59 (`"clean"`, 2021-01-08) 4 | 20 / 4 on the canonical explicit/clean recordings, 0 on the 21 others | not fetched (count only) |
| Glass Animals — Heat Waves (2020/2021) | 1ecd6bce (radio edit, 2021-03-26), cae16772 (2021), df39979f (DJ-mix part), a3aeb635 (2021-10-04) | **3**, 0, 0, 0 | 161.9 / B major (radio edit only) |
| Harry Styles — As It Was (2022-04-01) | 53969964, 1d1edf98 (2022-03-21), 5c942492 (Atmos), e0bf757c (360RA) | **3**, 0, 0, 0 | 87.0 / A major |
| Steve Lacy — Bad Habit (2022-06/07) | be62d1e4 (clean), 2a2451ae (live 2024), ae949c7c (DJ-mix), 1abdf128 (explicit) | 0, 0, 0, 0 | — |
| Kate Bush — Running Up That Hill (control; MB search top hits were 2004 and 2018 video re-releases) | f88222e6, 2515fdd4 | 0, 0 | — (the 1985 original was not in the top 2; not a 2022 data point) |

So: early-2021 releases can still have real coverage (drivers license: 20 submissions on the canonical explicit recording), mid-2021–mid-2022 releases have at most **~3 submissions on one MBID** (vs 45–262 for the older sample tracks and 8 for telepatía Nov 2020), and the covered MBID is frequently *not* among the top search hits or not the canonical one (drivers license: the two covered MBIDs were outside the top-8 score-100 hits, which were video/Atmos/live recordings; Heat Waves: radio edit only). For the never-fabricate rule this means: (a) for anything released 2021+ expect `count:0` on most MBIDs and check *every* candidate MBID via bulk `/count` (MB search `limit=25` or higher, then ≤25 ids per AB call) before declaring "unknown" — `limit=8` would have wrongly concluded "no data" for drivers license; (b) when the only covered MBID is an edit/remix (`disambiguation` non-empty), store the tempo with that MBID and its `disambiguation` so the UI can say "tempo from radio edit" instead of presenting it as the album version's; (c) post-mid-2022 (Bad Habit, Jul 2022: 0/4) treat AB as absent — Deezer `bpm` or GetSongBPM are the only remaining sources, and Deezer was `0` for both 2020+ sample tracks (§3.2), so **expect `bpm = null` to be the normal case for new releases**.

**F2. AcousticBrainz bulk `features=` response size:** 21 requested ids / 5 present → 2,803 B in 0.55 s (vs 541 KB unfiltered for 25 ids, §3.3). Rate-limit headers on both calls: `x-ratelimit-limit: 100`, `x-ratelimit-remaining: 99`, `x-ratelimit-reset-in: 6`.

**F3. Deezer numeric filters cannot be used to cross-check tempo** (B1): `bpm_min`/`bpm_max` are ignored, so the only Deezer tempo source remains `/track/{id}.bpm`.

### G. Still not covered by this doc (not tested here; listed so nobody assumes)

1. iTunes: `/lookup?id=` with >200 ids; the 403/429 error body; `contentAdvisoryRating:"Explicit"` (unreachable from SA).
2. Deezer: what a search item looks like when the track is outside `available_countries` for the caller (`readable:false`, `preview:""`) — not observable from SA for the sample set.
3. MusicBrainz: headers of the 503 responses in this run were overwritten by the successful retry (§3.3's `x-ratelimit-zone: global`, `retry-after: 0` description still stands); whether `retry-after` is ever non-zero.
4. AcousticBrainz: Heat Waves (44 MB recordings), As It Was (4, all checked), Bad Habit (6, 4 checked) were not exhaustively checked the way drivers license was; the 1985 Kate Bush original was not looked up.
5. Browser playback of any preview; Spotify embed autoplay/login behaviour (needs a browser session, out of scope for curl).
6. Everything key-gated (Last.fm success shapes, Spotify `/v1/search?q=isrc:`, Tavily/Brave/Exa searches, GetSongBPM success shape) — unchanged from §10.

### Commands run (all 2026-09-06, from SA; raw output in `scratchpad/critic/`)

- `curl -s "https://itunes.apple.com/search?term=cardi+b+wap&entity=song&limit=5&country=US"` → 200 in 0.60 s; 5 results, each 32 keys = the 31 documented + `contentAdvisoryRating:"Clean"`; ids 1526747167, 1822585609, 1841742329, 1848194448, 1841990378.
- `curl -s "https://itunes.apple.com/search?term=misirlou+dick+dale&entity=song&limit=10&country=US"` → 200 in 0.64 s; 8 results with 31 keys, 2 results (716598516, 1469433643) with 33 keys: + `collectionArtistId` (4035426 / 151566958), `collectionArtistName:"Various Artists"`.
- `curl -s -G "https://itunes.apple.com/search" --data-urlencode "term=Cherry Poppin' Daddies Zoot Suit Riot" --data-urlencode entity=song --data-urlencode limit=5 --data-urlencode country=US` → 200 in 0.65 s; #1 675806955 Zoot Suit Riot; all 31 keys.
- `curl -s "https://itunes.apple.com/search?term=<q>&entity=song&limit=5&country=SA"` for `the+cure+the+lovecats`, `olivia+rodrigo+vampire`, `kali+uchis+telepatia`, `louis+prima+jump+jive+an+wail`, `cardi+b+wap` (3 s apart) → 5× 200 (0.58–0.70 s); `country:"SAU"`, `currency:"SAR"`; Lovecats trackId 1443749582 (rank 1), vampire 1694768031 `cleaned`/`Clean`, telepatía studio 1541731262 at rank 3 behind two `(acoustic)` ids, Prima 725786770, WAP 1526747167 at rank 3; all with `previewUrl`, `isStreamable:true`.
- `curl -s "https://itunes.apple.com/search?term=fever&entity=song&limit=200&country=US"` → 200 in 2.30 s, 200 trackIds; then `curl -s "https://itunes.apple.com/lookup?id=<N ids>&country=US"` for N=50/100/200 → 200 in 1.19 / 1.73 / 2.01 s, `resultCount` 50 / 100 / 200, 75,008 / 149,627 / 302,062 B.
- `curl -s -G 'https://api.deezer.com/search' --data-urlencode 'q=artist:"The Cure" track:"The Lovecats" dur_min:210 dur_max:230'` ; `… bpm_min:90 bpm_max:93` ; `… dur_min:999 dur_max:1000` (plain, `&strict=on`, `&order=RANKING`) → all 200 `total:4`, identical ids 1143631 (220 s), 2887368212 (228 s), 490397642 (279 s), 67310084 (247 s) — filters ignored.
- `curl -s -G 'https://api.deezer.com/search' --data-urlencode 'q=track:"The Lovecats" dur_min:225 dur_max:300'` → 200 `total:43`, first hit 1143631 at 220 s (outside the range). `q=artist:"The Cure" bpm_min:200 bpm_max:220` and `q=artist:"The Cure" dur_min:400` → both `total:210`, same list starting 6215171, 1143625 (154 s).
- `curl -s -G 'https://api.deezer.com/search' --data-urlencode 'q=isrc:"GBALB8300001"'` → 200 `{"data":[],"total":0}`.
- `curl -s -G 'https://api.deezer.com/search' --data-urlencode 'q=<taylor swift | beatles | king crimson>' --data-urlencode limit=100` → 3× 200, 100 items each, 0 `readable:false`, 0 empty `preview`. `curl -s 'https://api.deezer.com/track/1126164'` → `readable:true`, `preview` present, 64 `available_countries` incl. `SA`.
- `curl -s 'https://api.deezer.com/track/1143631'` at 12:42:56 UTC → `preview` with `exp=1788699476` (= Date + 900 s); `curl -I <preview>` immediately → 200 `audio/mpeg`. At epoch 1788699510 (12:58:30 UTC): `curl -I <same preview>` → **403** `text/html` 0 B; `curl -H 'Range: bytes=0-1000' <same preview>` → **403** `text/html` 282 B, `server: AkamaiGHost`, `expires: Sun, 06 Sep 2026 12:58:31 GMT`, body "An error occurred while processing your request. Reference #199.3c5e3356.1788699511.227a9aa6". Immediately re-minting via `curl -s https://api.deezer.com/track/1143631` at 12:58:31 UTC → new `preview` with `exp=1788700411` (= now + 900 s), i.e. re-mint after expiry works with no cooldown.
- `curl -s -A "ItStings/0.1 (local dev)" -G "https://musicbrainz.org/ws/2/recording" --data-urlencode 'query=recording:"drivers license" AND artist:"Olivia Rodrigo"' --data-urlencode fmt=json --data-urlencode limit=25` → 200 first attempt, `count:23`, 23 recordings; `curl -s "https://acousticbrainz.org/api/v1/count?recording_ids=<those 23>"` → 200; only 143f1c88-… (`explicit`) count 20 and 88af1d59-… (`clean`) count 4 present.
- `curl -s -A "ItStings/0.1 (local dev)" "https://musicbrainz.org/ws/2/isrc/<ISRC>?fmt=json&inc=isrcs+artist-credits"` for NLG620480565, TCABP1327651, ATE611000013, USEM39700073, GBBRP0922203 (1.1 s apart, retry on 503) → 404, 200 (b944f19c…, 233266 ms, 1997-07-01), 200 on 3rd attempt (123f59a2…, 197506 ms, 2010-11-19), 200 (05f63c90…, 217800 ms, 1998-09), 404. 404 body `{"help":"For usage, please see: https://musicbrainz.org/development/mmd","error":"Not Found"}`.
- `curl -s -A "ItStings/0.1 (local dev)" -G "https://musicbrainz.org/ws/2/recording" --data-urlencode 'query=recording:"<title>" AND artist:"<artist>"' --data-urlencode fmt=json --data-urlencode limit=8` for drivers license / Olivia Rodrigo (503 then 200, count 23), Heat Waves / Glass Animals (503 then 200, count 44), As It Was / Harry Styles (200, count 4), Bad Habit / Steve Lacy (503×3 then 200, count 6), Running Up That Hill / Kate Bush (200, count 54), `Jump, Jive an' Wail` / Louis Prima (503×3 then 200, count 27), Zoot Suit Riot / `Cherry Poppin' Daddies` (200, count 17). 12 requests, 22 attempts, 10 HTTP 503 (each ~0.31 s); `x-ratelimit-limit` 360 on searches, 1200 on lookups, `remaining` non-monotonic (86…1086).
- `curl -s "https://acousticbrainz.org/api/v1/count?recording_ids=<21 MBIDs joined by ;>"` → 200 in 0.38 s; counts: 1ecd6bce 3, 53969964 3, b944f19c 63, 123f59a2 48, 05f63c90 17, all 16 others 0 (`mbid_mapping: {}`); headers `x-ratelimit-limit: 100`, `x-ratelimit-remaining: 99`, `x-ratelimit-reset-in: 6`.
- `curl -s "https://acousticbrainz.org/api/v1/low-level?recording_ids=<same 21>&features=rhythm.bpm;tonal.key_key;tonal.key_scale"` → 200 in 0.55 s, 2,803 B, 5 MBIDs present: 1ecd6bce bpm 161.9 B major; 53969964 87.0 A major; b944f19c 91.9 G# minor; 123f59a2 112.9 D minor; 05f63c90 107.6 A# minor.
- `curl -sS "https://ws.audioscrobbler.com/2.0/?method=track.getSimilar&api_key=INVALID&format=json"` (no artist/track) and `…&artist=The%20Cure&api_key=INVALID&format=json` (no track) → both 403 `{"message":"Invalid API key - You must be granted a valid key by last.fm","error":10}`.
- `curl -sS -X POST https://api.tavily.com/search -H 'Authorization: Bearer BOGUS_KEY_NOT_REAL_0000' -H 'Content-Type: application/json' -d '{"query":""}'` and `-d '{"query":"lovecats","search_depth":"bogus"}'` → both 401 `{"detail":{"error":"Unauthorized: missing or invalid API key."}}`.
- `curl -sS "https://open.spotify.com/oembed?url=https://open.spotify.com/track/abc"` → 504 `text/plain`; `curl -sS "https://open.spotify.com/oembed?url=https%3A%2F%2Fopen.spotify.com%2Ftrack%2F6q2T5xXao6mTS6LLE88L84%3Fsi%3Dabc123"` → 200 `application/json`.
