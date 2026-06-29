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

async function main() {
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

  test('keeps (Editions of You) — substring "edition" must not over-strip', () =>
    assert.equal(cleanTitleForIcy('Editions of You (Editions of You)'), 'Editions of You (Editions of You)'));
  test('keeps (Monochrome) — substring "mono" must not over-strip', () =>
    assert.equal(cleanTitleForIcy('Song (Monochrome)'), 'Song (Monochrome)'));

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

  if (failures > 0) {
    console.error(`\n${failures} test(s) failed`);
    process.exit(1);
  }
  console.log('\nall clean-title-icy tests passed');
  process.exit(0);
}

void main();
