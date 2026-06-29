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
