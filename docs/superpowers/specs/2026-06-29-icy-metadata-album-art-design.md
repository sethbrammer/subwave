# Design: Clean ICY StreamTitle + per-track album-art StreamUrl

**Date:** 2026-06-29
**Branch:** `feat/icy-metadata-album-art`
**Fork:** `sethbrammer/subwave` (upstream `perminder-klair/subwave`, default branch `develop`)
**Status:** Design — awaiting review

## Problem

SUB/WAVE broadcasts per-track metadata on the public Icecast MP3 mount, but the
metadata is thin and the title is dirty:

- The ICY `StreamTitle` is built from raw library tags, so version/edition cruft
  baked into title tags airs verbatim — e.g. `Frank Ocean - Thinkin Bout You
  (Spring Sampler / 2012)`.
- There is **no per-track artwork** on the stream at all.

The operator listens through **TuneIn** today and plans to move to **Music
Assistant**. The behaviour of those two clients drives this design:

- **Music Assistant** (future target) fetches per-track album art by looking up
  the ICY `StreamTitle` text against metadata providers (MusicBrainz / TheAudioDB
  / etc.). It needs the title in the exact form `Artist - Title`, single spaces
  around the hyphen, with a **clean title** — cruft like `(Spring Sampler /
  2012)` degrades or breaks the match. So album art in MA is unlocked by *clean
  StreamTitle hygiene*, not by an API.
- **TuneIn** (today) shows the station logo plus the `StreamTitle` text for a
  custom stream; it does **not** do per-track album art. The only win for TuneIn
  is cleaner now-playing text.
- **Other clients** (WiiM, Kodi, foobar2000) honour an ICY `StreamUrl` field and
  can render it as per-track artwork. Setting it costs nothing for the clients
  that ignore it.

Sources: [Music Assistant metadata](https://www.music-assistant.io/metadata/),
[Liquidsoap ICY metadata](https://liquidsoap.readthedocs.io/en/stable/content/icy_metadata.html),
[Liquidsoap #2676 (no in-band url/song mapping)](https://github.com/savonet/liquidsoap/issues/2676),
[Icecast cover-art via StreamUrl — RadioForge](https://www.radioforge.com/icecast-shoutcast-metadata-with-artwork-image/).

## Goal

On the public `/stream.mp3` Icecast mount, broadcast:

1. A clean `StreamTitle = "Artist - Title"` with conservative cruft stripping.
2. A per-track `StreamUrl` pointing at the public cover-art image.

Non-goals: changing the web player UI, `now-playing.json`, the `/now-playing`
API, the Opus mount's audio, or building any Home Assistant / Music Assistant
integration. `now-playing.json` and the web UI keep the **full original title**.

## Approach

Two small, surgical changes. The controller owns URL/title construction (it
knows `SITE_URL` and the `/cover/:id` convention, and TS makes cleaning easy to
test); Liquidsoap stays a dumb consumer that just reads stamped annotations and
pushes them to Icecast. This mirrors the existing `liq_amplify` / `liq_cue_out`
annotation pattern exactly.

### Change 1 — `controller/src/music/subsonic.ts`

Add a `cleanTitleForIcy(title)` helper and two new fields to the `annotate:` URI
built by `getAnnotatedUri(song)`:

- `liq_stream_url="${SITE_URL}/cover/${song.id}"` — public cover-art URL. Only
  added when `SITE_URL` is set and the song has an id.
- `liq_stream_title="${artist} - ${cleanTitleForIcy(title)}"` — pre-built clean
  StreamTitle. When artist or title is missing, fall back to whichever is
  present (mirrors Liquidsoap's default `icy_song` behaviour).

Custom `liq_`-prefixed keys are not auto-consumed by Liquidsoap; `on_meta` reads
them explicitly.

`SITE_URL` is already an env on the controller (e.g.
`http://100.98.158.95:7700`); the `/cover/:id` route on the controller proxies
`subsonic.getCoverArtUrl(id, 512)`. Values are escaped through the existing
`escAnnotate()` (handles the `:` `/` `?` in URLs inside the quoted annotate
field).

#### `cleanTitleForIcy` — conservative strip

Strip **trailing** parenthetical/bracketed segments whose contents match a
curated cruft safelist; leave everything else (including the body of the title
and any non-trailing parentheses) intact.

- **STRIP** (case-insensitive, as a trailing `(...)` or `[...]` group):
  `remaster`, `remastered`, `* remaster`, `deluxe`, `expanded`, `anniversary`,
  `* edition`, `mono`, `stereo`, `reissue`, `* sampler`, `itunes`, `spotify`,
  `amazon`, `apple music`, `bonus track`, and a bare year (`(2012)`,
  `(2012 remaster)` already covered by the keyword rules).
- **KEEP** (never strip, even if trailing): `feat`, `ft`, `featuring`, `with`,
  `live`, `remix`, `acoustic`, `instrumental`, `edit`, `radio edit`, `version`,
  `demo`, `mix`, `cover`, `reprise`, `interlude`.
- Collapse resulting double spaces and trim. If stripping would empty the title,
  return the original (never broadcast an empty title).

Conflict rule: if a trailing group matches **both** a keep- and a strip-keyword,
KEEP wins (safer to over-retain than to drop a real qualifier).

No settings toggle — cleaning is always on. The original title is preserved
everywhere except the broadcast StreamTitle, so a bad strip is low-blast-radius
and fixable in code.

### Change 2 — `liquidsoap/radio.liq`

Liquidsoap in the broadcast image is **2.2.5**; `icy.update_metadata` is
confirmed present with the signature `(?host, ?port, ?user, ?password, ?mount,
…, [string * string]) -> unit`. Exact `try/catch` keyword form to be matched to
2.2.5 during implementation.

In the MP3 `output.icecast` inside `make_stream_outputs()`:

- Add `send_icy_metadata=false` so Liquidsoap's automatic per-track ICY update
  no longer fires for the MP3 mount. Required because the in-band metadata path
  cannot set `StreamUrl` (Liquidsoap #2676), so we drive ICY manually; leaving
  the automatic updater on would race it and intermittently drop the StreamUrl.

In `on_meta(m)` (which already fires once per music track on the pre-cross
`music_meta` source and writes `now-playing.json`):

- Build `stream_title`: prefer `m["liq_stream_title"]`; else build
  `"#{artist} - #{title}"` (or whichever single field is present).
- Build `stream_url`: `m["liq_stream_url"]` (else `""`).
- Push **both in one update**, guarded so it only runs when the stream is up and
  any failure just logs:

  ```liquidsoap
  if stream_on() then
    try
      icy.update_metadata(
        mount="/stream.mp3",
        host=environment.get(default="icecast", "ICECAST_HOST"),
        port=7702,
        user="source",
        password=environment.get("ICECAST_SOURCE_PASSWORD"),
        [("StreamTitle", stream_title), ("StreamUrl", stream_url)]
      )
    catch err do
      log(label="on_meta", level=3, "icy.update_metadata failed: #{err}")
    end
  end
  ```

- **Keep** the existing `radio.insert_metadata([title, artist, album])`. With
  `send_icy_metadata=false` it no longer drives MP3 ICY, but it still supplies
  the **Opus** mount's in-band Ogg comments (Opus carries metadata in-band, not
  via ICY, so it is unaffected by the MP3 output flag).

The `metadata.map(strip=true)` + `insert_metadata(radio)` wiring above `on_meta`
is unchanged — it still prevents the crossfade from re-emitting stale metadata
to the Opus mount.

## Data flow

```
controller queue → getAnnotatedUri(song)
   annotate: title, artist, album, subsonic_id, year, genre,
             liq_amplify, liq_cue_out, liq_cross_duration,
             liq_stream_title (NEW), liq_stream_url (NEW)
        ↓ (next.txt / auto.m3u)
liquidsoap music_meta.on_metadata(on_meta)
        ├─ file.write now-playing.json   (full original title — unchanged)
        ├─ radio.insert_metadata([...])  (Opus Ogg comments — unchanged)
        └─ icy.update_metadata(/stream.mp3, StreamTitle + StreamUrl)  (NEW)
        ↓
Icecast /stream.mp3 → MA (art lookup), TuneIn (clean text), WiiM/Kodi (art via StreamUrl)
```

## Edge cases

- **Listener requests / tracks not routed through `getAnnotatedUri`:** no
  `liq_stream_title` / `liq_stream_url`; `on_meta` falls back to `artist - title`
  and an empty StreamUrl. Stream still updates correctly.
- **Jingles / station IDs:** never reach `music_meta`, so `on_meta` doesn't fire
  for them (current behaviour) — StreamTitle holds the last track, as today.
- **Stream off-air (`stream_down`):** `icy.update_metadata` is skipped behind
  `stream_on()`, so no error against a disconnected mount.
- **Missing `SITE_URL`:** controller omits `liq_stream_url`; StreamUrl is empty;
  StreamTitle still cleaned. No crash.
- **Title that is entirely cruft** (e.g. literally `(Remastered)`): cleaner
  returns the original to avoid an empty broadcast title.

## Testing

- **Unit:** `controller/scripts/clean-title-icy.test.ts` — a `tsx` assertion
  script matching the repo's existing test convention (plain `assert`, no
  vitest/jest), added to the `"test"` chain in `controller/package.json`. Table
  cases for each STRIP keyword, each KEEP keyword, the KEEP-wins conflict,
  non-trailing parentheses preserved, double-space collapse, and the all-cruft
  fallback. (`cleanTitleForIcy` must be `export`ed from `subsonic.ts` so the
  test can import it.)
- **Integration (post-deploy on blue-jay-way):**
  - `curl status-json.xsl` on the broadcast container → `source.title` is clean
    and a per-track `StreamUrl` is present and resolves to a JPEG.
  - `now-playing.json` still carries the **full original** title (regression
    guard).
  - Tail `/var/log/liquidsoap/radio.log` for `on_meta` + a successful
    `icy.update_metadata` (no catch log).

## Deployment

1. Edits on `feat/icy-metadata-album-art` in fork `sethbrammer/subwave`.
2. Rebuild `broadcast` + `controller` images — either fork CI
   (`.github/workflows/publish-images.yml` → your ghcr) or
   `docker compose build broadcast controller` on blue-jay-way (compose has
   `build:` contexts).
3. Recreate both containers. Liquidsoap reloads `radio.liq` on restart; the
   controller picks up the new `getAnnotatedUri`.
4. Optionally open a PR upstream to `perminder-klair/subwave` (`develop`).

## Files touched

- `controller/src/music/subsonic.ts` — `cleanTitleForIcy()` + two annotate fields.
- `liquidsoap/radio.liq` — `send_icy_metadata=false` on the MP3 mount + `on_meta`
  `icy.update_metadata` push.
- `controller/scripts/clean-title-icy.test.ts` (new) + `controller/package.json`
  `"test"` chain — `cleanTitleForIcy` unit tests.
