# Clean ICY StreamTitle + Album-Art StreamUrl — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Broadcast a clean `Artist - Title` ICY StreamTitle plus a per-track album-art `StreamUrl` on the public `/stream.mp3` Icecast mount.

**Architecture:** The controller stamps two new `annotate:` fields on each track URI (`liq_stream_title`, `liq_stream_url`); Liquidsoap's `on_meta` reads them and pushes both to Icecast in one `icy.update_metadata` call, with the MP3 output's automatic ICY updater disabled so it can't race. The web UI and `now-playing.json` keep the full original title and are untouched.

**Tech Stack:** TypeScript (controller, `tsx` + `node:assert` tests), Liquidsoap 2.2.5 (`radio.liq`), Icecast 2.4.0-kh, Docker Compose.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-06-29-icy-metadata-album-art-design.md` — authoritative.
- Fork `sethbrammer/subwave`, branch `feat/icy-metadata-album-art`, upstream default branch `develop`.
- `now-playing.json`, the `/now-playing` API, the web player, and the Opus mount audio MUST remain unchanged — only the MP3 mount's ICY metadata changes.
- Title cleaning is conservative (curated safelist) and always on — no settings toggle.
- Tests follow the repo convention: a `tsx` script using `import assert from 'node:assert/strict'`, a local `test()` helper, `process.exit(1)` on failure, registered in `controller/package.json`'s `"test"` chain.
- Liquidsoap is 2.2.5; `icy.update_metadata(?host,?port,?user,?password,?mount,…,[string*string]) -> unit` is confirmed present.
- Commit messages: conventional commits (`feat:`, `test:`, `docs:`). End each with the Co-Authored-By trailer used on the spec commit.

---

### Task 1: Pure title-cleaning helpers + unit tests

**Files:**
- Modify: `controller/src/music/subsonic.ts` (add two exported pure functions near `getCoverArtUrl`, ~line 530)
- Create: `controller/scripts/clean-title-icy.test.ts`
- Modify: `controller/package.json` (`"test"` script chain)

**Interfaces:**
- Produces:
  - `export function cleanTitleForIcy(title: string): string` — strips trailing edition/source cruft per the safelist; returns the original when stripping would empty it.
  - `export function icyStreamTitle(artist: string, title: string): string` — returns `"<artist> - <cleanTitleForIcy(title)>"`, or whichever of artist/clean-title is non-empty, or `""` if both empty.

- [ ] **Step 1: Write the failing test**

Create `controller/scripts/clean-title-icy.test.ts`:

```typescript
// Unit tests for the ICY StreamTitle helpers (cleanTitleForIcy, icyStreamTitle).
// Run: `tsx scripts/clean-title-icy.test.ts`. node:assert-via-tsx style,
// matching scripts/stale-link.test.ts.

import assert from 'node:assert/strict';
import { cleanTitleForIcy, icyStreamTitle } from '../src/music/subsonic.js';

let failures = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err: any) {
    failures++;
    console.error(`  ✗ ${name}\n      ${err?.message || err}`);
  }
}

function main() {
  console.log('cleanTitleForIcy:');

  // STRIP — trailing edition/source cruft
  test('strips (Remastered)', () =>
    assert.equal(cleanTitleForIcy('Redbone (Remastered)'), 'Redbone'));
  test('strips (2014 Remaster)', () =>
    assert.equal(cleanTitleForIcy('Song (2014 Remaster)'), 'Song'));
  test('strips (Deluxe Edition)', () =>
    assert.equal(cleanTitleForIcy('Song (Deluxe Edition)'), 'Song'));
  test('strips (Spring Sampler / 2012)', () =>
    assert.equal(cleanTitleForIcy('Thinkin Bout You (Spring Sampler / 2012)'), 'Thinkin Bout You'));
  test('strips [Mono]', () =>
    assert.equal(cleanTitleForIcy('Song [Mono]'), 'Song'));
  test('strips (UK iTunes)', () =>
    assert.equal(cleanTitleForIcy('Song (UK iTunes)'), 'Song'));
  test('strips bare year (2012)', () =>
    assert.equal(cleanTitleForIcy('Song (2012)'), 'Song'));

  // KEEP — performance-relevant qualifiers
  test('keeps (feat. X)', () =>
    assert.equal(cleanTitleForIcy('Song (feat. Drake)'), 'Song (feat. Drake)'));
  test('keeps (Live)', () =>
    assert.equal(cleanTitleForIcy('Song (Live)'), 'Song (Live)'));
  test('keeps (Radio Edit)', () =>
    assert.equal(cleanTitleForIcy('Song (Radio Edit)'), 'Song (Radio Edit)'));
  test('keeps (Acoustic)', () =>
    assert.equal(cleanTitleForIcy('Song (Acoustic)'), 'Song (Acoustic)'));
  test('keeps (Tiësto Remix)', () =>
    assert.equal(cleanTitleForIcy('Song (Tiësto Remix)'), 'Song (Tiësto Remix)'));

  // KEEP-wins conflict: group has both a keep- and strip-keyword
  test('keep wins over strip (Live Remaster)', () =>
    assert.equal(cleanTitleForIcy('Song (Live Remaster)'), 'Song (Live Remaster)'));

  // Structure
  test('preserves non-trailing parentheses', () =>
    assert.equal(cleanTitleForIcy('Song (Pt. 1) (Remastered)'), 'Song (Pt. 1)'));
  test('collapses double space after strip', () =>
    assert.equal(cleanTitleForIcy('Song  (Remastered)'), 'Song'));
  test('all-cruft title falls back to original', () =>
    assert.equal(cleanTitleForIcy('(Remastered)'), '(Remastered)'));
  test('plain title untouched', () =>
    assert.equal(cleanTitleForIcy('Redbone'), 'Redbone'));

  console.log('icyStreamTitle:');
  test('artist + clean title', () =>
    assert.equal(icyStreamTitle('Childish Gambino', 'Redbone (Remastered)'), 'Childish Gambino - Redbone'));
  test('missing artist → clean title only', () =>
    assert.equal(icyStreamTitle('', 'Redbone (Remastered)'), 'Redbone'));
  test('missing title → artist only', () =>
    assert.equal(icyStreamTitle('Childish Gambino', ''), 'Childish Gambino'));
  test('both empty → empty string', () =>
    assert.equal(icyStreamTitle('', ''), ''));

  if (failures > 0) {
    console.error(`\n${failures} test(s) failed`);
    process.exit(1);
  }
  console.log('\nall clean-title-icy tests passed');
  process.exit(0);
}

main();
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd controller && tsx scripts/clean-title-icy.test.ts`
Expected: FAIL — `cleanTitleForIcy`/`icyStreamTitle` are not exported (import error or `is not a function`).

- [ ] **Step 3: Implement the helpers**

In `controller/src/music/subsonic.ts`, immediately after the `getCoverArtUrl` function (~line 532), add:

```typescript
// ICY StreamTitle hygiene. Music Assistant fetches per-track album art by
// looking up the "Artist - Title" ICY text against metadata providers, and the
// match degrades when version/edition cruft baked into a title tag (e.g.
// "(Spring Sampler / 2012)") rides along. Strip only a curated safelist of
// trailing edition/source groups; keep performance-relevant qualifiers
// (feat./live/remix/acoustic/edit/version). Conservative on purpose — the full
// original title is preserved everywhere except the broadcast StreamTitle.
const ICY_STRIP_KEYWORDS = [
  'remaster', 'remastered', 'deluxe', 'expanded', 'anniversary', 'edition',
  'mono', 'stereo', 'reissue', 'sampler', 'itunes', 'spotify', 'amazon',
  'apple music', 'bonus track',
];
const ICY_KEEP_KEYWORDS = [
  'feat', 'ft', 'featuring', 'with', 'live', 'remix', 'acoustic',
  'instrumental', 'edit', 'version', 'demo', 'mix', 'cover', 'reprise',
  'interlude',
];

export function cleanTitleForIcy(title: string): string {
  const original = String(title ?? '');
  // Repeatedly remove a single trailing (...) or [...] group while it matches
  // the strip rules and not the keep rules. Loop handles stacked groups like
  // "Song (Live) (Remastered)" — strips the Remaster, then re-checks (Live),
  // which is kept, and stops.
  let out = original.trim();
  // Trailing group: optional space, then (...) or [...] at end of string.
  const trailing = /\s*[([]([^()[\]]*)[)\]]$/;
  for (;;) {
    const m = out.match(trailing);
    if (!m) break;
    const inner = m[1].toLowerCase();
    const hasKeep = ICY_KEEP_KEYWORDS.some((k) => new RegExp(`\\b${k}\\b`).test(inner));
    if (hasKeep) break; // keep wins — stop stripping
    const isBareYear = /^\s*\d{4}\s*$/.test(inner);
    const hasStrip = isBareYear || ICY_STRIP_KEYWORDS.some((k) => inner.includes(k));
    if (!hasStrip) break; // unknown qualifier — leave it
    out = out.slice(0, m.index).trimEnd();
  }
  out = out.replace(/\s{2,}/g, ' ').trim();
  return out === '' ? original : out;
}

export function icyStreamTitle(artist: string, title: string): string {
  const a = String(artist ?? '').trim();
  const t = cleanTitleForIcy(title).trim();
  if (a && t) return `${a} - ${t}`;
  return a || t || '';
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd controller && tsx scripts/clean-title-icy.test.ts`
Expected: PASS — `all clean-title-icy tests passed`.

- [ ] **Step 5: Register the test in the suite**

In `controller/package.json`, append `&& tsx scripts/clean-title-icy.test.ts` to the end of the `"test"` script value (after `tsx scripts/rescan-scope.test.ts`).

- [ ] **Step 6: Run the full suite to confirm wiring**

Run: `cd controller && npm test`
Expected: the existing tests pass and the new `clean-title-icy` line prints `all clean-title-icy tests passed`.

- [ ] **Step 7: Commit**

```bash
git add controller/src/music/subsonic.ts controller/scripts/clean-title-icy.test.ts controller/package.json
git commit -m "feat(controller): add cleanTitleForIcy + icyStreamTitle helpers

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Stamp `liq_stream_title` + `liq_stream_url` in `getAnnotatedUri`

**Files:**
- Modify: `controller/src/music/subsonic.ts` (`getAnnotatedUri`, ~lines 573-607)
- Modify: `controller/scripts/clean-title-icy.test.ts` (add an annotate-fields section)

**Interfaces:**
- Consumes: `icyStreamTitle()` (Task 1), existing `escAnnotate()`, `process.env.SITE_URL`.
- Produces: `getAnnotatedUri(song)` output now contains `liq_stream_title="…"` always, and `liq_stream_url="<SITE_URL>/cover/<id>"` when `SITE_URL` is set and `song.id` is present.

- [ ] **Step 1: Write the failing test**

Append to `controller/scripts/clean-title-icy.test.ts`, inside `main()` just before the `if (failures > 0)` block:

```typescript
  console.log('getAnnotatedUri ICY fields:');
  const { getAnnotatedUri } = await import('../src/music/subsonic.js');

  test('stamps clean liq_stream_title', () => {
    process.env.SITE_URL = 'http://test.local:7700';
    const uri = getAnnotatedUri({ id: 'abc', title: 'Redbone (Remastered)', artist: 'Childish Gambino', album: 'Awaken' });
    assert.ok(uri.includes('liq_stream_title="Childish Gambino - Redbone"'), uri);
  });
  test('stamps liq_stream_url from SITE_URL + id', () => {
    process.env.SITE_URL = 'http://test.local:7700';
    const uri = getAnnotatedUri({ id: 'abc', title: 'Song', artist: 'Band', album: 'A' });
    assert.ok(uri.includes('liq_stream_url="http://test.local:7700/cover/abc"'), uri);
  });
  test('omits liq_stream_url when SITE_URL unset', () => {
    delete process.env.SITE_URL;
    const uri = getAnnotatedUri({ id: 'abc', title: 'Song', artist: 'Band', album: 'A' });
    assert.ok(!uri.includes('liq_stream_url='), uri);
  });
```

Change the `main()` signature to `async function main()` (it now uses `await import`); the trailing `main();` call stays (a floating promise is fine for a test script, but to be clean change it to `main();` → `void main();`). The dynamic `import()` is used so SITE_URL can be set per-case before the module reads it; `getAnnotatedUri` reads `process.env.SITE_URL` at call time, so a static import works too — either is acceptable as long as SITE_URL is set before each call.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd controller && tsx scripts/clean-title-icy.test.ts`
Expected: FAIL — the three new assertions fail (no `liq_stream_title` / `liq_stream_url` in the annotate string yet).

- [ ] **Step 3: Implement the annotate fields**

In `controller/src/music/subsonic.ts` `getAnnotatedUri`, after the `subsonic_id` line in the `fields` array (line 578) and before the `if (song.year)` block, add:

```typescript
  // ICY StreamTitle/StreamUrl for the broadcast MP3 mount (radio.liq on_meta
  // reads these). Clean "Artist - Title" so Music Assistant's art lookup
  // matches; cover URL so clients that honour ICY StreamUrl show per-track art.
  // The full original title still goes in the `title` field above (now-playing
  // / web UI / Opus tags). SITE_URL is the public origin (same one /cover/:id
  // is served from); omit the URL field when it isn't configured.
  fields.push(`liq_stream_title="${escAnnotate(icyStreamTitle(song.artist, song.title))}"`);
  const siteUrl = (process.env.SITE_URL || '').trim().replace(/\/+$/, '');
  if (siteUrl && song.id) {
    fields.push(`liq_stream_url="${escAnnotate(`${siteUrl}/cover/${song.id}`)}"`);
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd controller && tsx scripts/clean-title-icy.test.ts`
Expected: PASS — including the three `getAnnotatedUri ICY fields` cases.

- [ ] **Step 5: Run the full suite**

Run: `cd controller && npm test`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add controller/src/music/subsonic.ts controller/scripts/clean-title-icy.test.ts
git commit -m "feat(controller): stamp liq_stream_title + liq_stream_url on annotate URIs

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Drive MP3 ICY from `on_meta` (StreamTitle + StreamUrl)

**Files:**
- Modify: `liquidsoap/radio.liq` (MP3 `output.icecast` ~line 628; `on_meta` ~lines 562-592)

**Interfaces:**
- Consumes: `m["liq_stream_title"]`, `m["liq_stream_url"]` (Task 2); existing `ICECAST_HOST` / `ICECAST_SOURCE_PASSWORD` env; existing `stream_on` ref.
- Produces: per-track `StreamTitle` + `StreamUrl` on the `/stream.mp3` Icecast mount.

- [ ] **Step 1: Disable the automatic ICY updater on the MP3 mount**

In `liquidsoap/radio.liq`, in the `mp3_out = output.icecast(...)` call (~line 628), add `send_icy_metadata=false,` as a parameter (e.g. on its own line right after `fallible=true,`). Leave the Opus output untouched.

Resulting parameter block (for reference):

```liquidsoap
  mp3_out = output.icecast(
    %mp3(bitrate=192, samplerate=44100, stereo=true),
    id="stream_mp3",
    fallible=true,
    send_icy_metadata=false,
    host=environment.get(default="icecast", "ICECAST_HOST"),
    port=7702,
    password=environment.get("ICECAST_SOURCE_PASSWORD"),
    mount="/stream.mp3",
    name=station_name(),
    description="Personal frequency from the homelab",
    genre="Various",
    url="http://localhost:7700",
    radio
  )
```

- [ ] **Step 2: Push StreamTitle + StreamUrl from `on_meta`**

In `on_meta(m)` (~line 562), replace the existing `radio.insert_metadata([...])` block (lines 585-590) so it KEEPS the in-band update (for the Opus Ogg comments) and ADDS the manual ICY push. Replace:

```liquidsoap
    # Push the same metadata onto the Icecast stream so the ICY title
    # tracks the current song instead of lagging a transition behind.
    radio.insert_metadata([
      ("title", title),
      ("artist", artist),
      ("album", album)
    ])
```

with:

```liquidsoap
    # In-band metadata — still drives the Opus mount's Ogg comments. The MP3
    # mount has send_icy_metadata=false, so this no longer sets MP3 ICY.
    radio.insert_metadata([
      ("title", title),
      ("artist", artist),
      ("album", album)
    ])
    # MP3 ICY — push a clean "Artist - Title" StreamTitle plus a per-track
    # cover-art StreamUrl in ONE update. The controller stamps liq_stream_title
    # (cruft-stripped) and liq_stream_url (SITE_URL/cover/<id>) on the annotate
    # URI; fall back to a built "artist - title" when they're absent (e.g. a
    # listener request not routed through getAnnotatedUri). In-band metadata
    # can't carry StreamUrl (liquidsoap#2676), so this is sent out-of-band.
    icy_title =
      if m["liq_stream_title"] != "" then m["liq_stream_title"]
      elsif artist != "" and title != "" then "#{artist} - #{title}"
      elsif title != "" then title
      else artist end
    icy_url = m["liq_stream_url"]
    if stream_on() then
      try
        icy.update_metadata(
          mount="/stream.mp3",
          host=environment.get(default="icecast", "ICECAST_HOST"),
          port=7702,
          user="source",
          password=environment.get("ICECAST_SOURCE_PASSWORD"),
          [("StreamTitle", icy_title), ("StreamUrl", icy_url)]
        )
      catch err do
        log(label="on_meta", level=3, "icy.update_metadata failed: #{err}")
      end
    end
```

Note for the implementer: confirm the `try … catch err do … end` form against Liquidsoap 2.2.5 (`liquidsoap --help` / docs). If 2.2.5 requires a typed catch list, use `catch err : [error.uri, error.http, error.invalid] do …` — but the bare `catch err do … end` is valid in 2.2.x. If in doubt, the simplest safe fallback is to drop the `try`/`catch` (the call is already guarded by `stream_on()`); a transient failure logs its own error inside Liquidsoap and the next track re-pushes.

- [ ] **Step 3: Syntax-check the script with the broadcast image**

Run (best effort — type-checks the script without going on air):

```bash
docker run --rm --entrypoint liquidsoap \
  -e ICECAST_SOURCE_PASSWORD=checkonly \
  -v "$PWD/liquidsoap/radio.liq:/tmp/radio.liq:ro" \
  ghcr.io/perminder-klair/subwave-broadcast:latest --check /tmp/radio.liq
```

Expected: exits 0 with no type/parse errors. If `--check` tries to open outputs/connect (non-zero for runtime reasons rather than a parse/type error), treat a clean *parse/type* result as success and rely on the Task 4 log-tail to confirm runtime correctness.

- [ ] **Step 4: Commit**

```bash
git add liquidsoap/radio.liq
git commit -m "feat(broadcast): push clean ICY StreamTitle + cover StreamUrl on MP3 mount

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Deploy to blue-jay-way and verify end-to-end

**Files:** none (operational).

**Interfaces:**
- Consumes: Tasks 1-3 merged on `feat/icy-metadata-album-art`.
- Produces: live broadcast emitting clean StreamTitle + StreamUrl; `now-playing.json` unchanged.

- [ ] **Step 1: Push the branch**

```bash
git push -u origin feat/icy-metadata-album-art
```

- [ ] **Step 2: Build the two changed images on the host**

The host runs from `/mnt/user/appdata/subwave` with prebuilt ghcr images. Build the modified `broadcast` + `controller` from the fork checkout and tag them as the names the compose file pulls (so no compose edit is needed). On a machine with the fork checked out and Docker (e.g. blue-jay-way with the repo synced, or build+push from the dev machine):

```bash
# from the repo root
docker build -f docker/Dockerfile.broadcast  -t ghcr.io/perminder-klair/subwave-broadcast:latest  .
docker build -f docker/Dockerfile.controller -t ghcr.io/perminder-klair/subwave-controller:latest .
```

(Alternatively use the repo's `subwave-deploy` skill, which rebuilds only the services whose code changed and recreates them.)

- [ ] **Step 3: Recreate the two containers**

```bash
ssh blue-jay-way 'cd /mnt/user/appdata/subwave && docker compose up -d --force-recreate broadcast controller'
```

- [ ] **Step 4: Confirm Liquidsoap started cleanly (no parse error / restart loop)**

```bash
ssh blue-jay-way 'docker ps --filter name=sub-wave-broadcast --format "{{.Status}}"; \
  docker exec sub-wave-broadcast tail -n 40 /var/log/liquidsoap/radio.log'
```
Expected: container `Up … (healthy)`, log shows `on_meta:` lines and **no** `icy.update_metadata failed` and no script error.

- [ ] **Step 5: Verify the live ICY metadata is clean and carries art**

```bash
ssh blue-jay-way 'docker exec sub-wave-broadcast curl -s http://localhost:7702/status-json.xsl' | python3 -m json.tool
```
Expected: `source.title` is a clean track title (no `(… Remaster)` / `(… Sampler …)` cruft for a track that had it), and a per-track `StreamUrl`/cover field is present pointing at `…/cover/<id>`. (Wait for a track change if the current track predates the deploy.)

- [ ] **Step 6: Regression-check `now-playing.json` (full title preserved)**

```bash
ssh blue-jay-way 'cat /mnt/user/appdata/subwave/state/now-playing.json'
```
Expected: still the **full original** `title`/`artist`/`album` (e.g. with any version suffix intact) — proving the web UI / API path is unchanged.

- [ ] **Step 7 (optional): Open PR upstream**

If upstreaming, use the repo's `subwave-release-pr` flow or:
```bash
gh pr create --repo perminder-klair/subwave --base develop \
  --head sethbrammer:feat/icy-metadata-album-art \
  --title "feat: clean ICY StreamTitle + per-track album-art StreamUrl" \
  --body "See docs/superpowers/specs/2026-06-29-icy-metadata-album-art-design.md"
```

---

## Self-Review

**Spec coverage:**
- Clean `Artist - Title` StreamTitle → Task 1 (`icyStreamTitle`/`cleanTitleForIcy`) + Task 2 (stamp) + Task 3 (push). ✓
- Conservative safelist strip (keep feat./live/remix/etc.; strip remaster/edition/sampler/year) → Task 1 keyword lists + tests, incl. KEEP-wins conflict. ✓
- Per-track cover `StreamUrl` from `SITE_URL/cover/<id>` → Task 2 (stamp) + Task 3 (push). ✓
- `send_icy_metadata=false` on MP3 to avoid races → Task 3 Step 1. ✓
- Keep `insert_metadata` for Opus Ogg comments → Task 3 Step 2 (retained). ✓
- Single combined `icy.update_metadata`, guarded by `stream_on()`, failure only logs → Task 3 Step 2. ✓
- `now-playing.json` / web UI unchanged → not modified; Task 4 Step 6 regression check. ✓
- Edge cases (unannotated request fallback, missing SITE_URL, stream off, all-cruft title) → Task 1 fallback test, Task 2 omit-when-unset test, Task 3 `stream_on()` guard + fallback `icy_title`. ✓
- Unit test in `tsx` convention, added to `"test"` chain → Task 1 Steps 1/5. ✓

**Placeholder scan:** No TBD/TODO; all code shown in full; commands have expected output. The one judgement call (Liquidsoap `catch` syntax) is flagged with a concrete fallback, not left open. ✓

**Type consistency:** `cleanTitleForIcy(title)` and `icyStreamTitle(artist, title)` names/signatures match across Tasks 1-2 and the tests; annotate keys `liq_stream_title` / `liq_stream_url` match exactly between Task 2 (producer) and Task 3 (consumer). ✓
