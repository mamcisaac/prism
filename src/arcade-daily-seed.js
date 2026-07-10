// ============================================================
// Shared daily seeding — the one canonical date→seed path.
//
// Every daily game derives its puzzle from the player's local date. Games
// used to hand-roll this (a dozen bespoke todayStr/dayNum/hash copies); this
// module is the single version. The local-calendar key + shared "Day N"
// epoch live in arcade-archive.js (they define the archive's calendar);
// this module layers the seeding on top:
//
//   dailyDateKey()            → 'YYYY-M-D' for today's daily — or for the
//                               archived day being replayed: it honors
//                               window.__archiveDateKey, so a daily loader
//                               that seeds from dailyDateKey() is archive-
//                               ready with no extra wiring.
//   dailyDayNumber(key?)      → shared-epoch Day N for a key (default: the
//                               dailyDateKey() day), matching the number the
//                               archive modal shows arcade-wide.
//   seedFromKey(key, salt)    → deterministic uint32 from key(+salt) — xmur3.
//                               Salt with the game slug so two games never
//                               share a day's random stream.
//   mulberry32(seed)          → fast seeded PRNG, () => float in [0,1).
//
// Classic consumers must load arcade-archive.js BEFORE this file.
// ============================================================

import { archiveDateKey, archiveDayNumber } from './arcade-archive.js';

// The date key the daily should be built from right now: the archived day
// being replayed if one is active, else today (local calendar — the daily
// rolls over at local midnight, same basis as the archive + daily boards).
export function dailyDateKey() {
  if (typeof window !== 'undefined' && window.__archiveDateKey) {
    return String(window.__archiveDateKey);
  }
  return archiveDateKey(new Date());
}

export function dailyDayNumber(key) {
  return archiveDayNumber(key || dailyDateKey());
}

// xmur3 string hash → uint32 seed. Deterministic across engines.
export function seedFromKey(key, salt) {
  const str = String(key) + (salt ? '|' + salt : '');
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

// mulberry32 — small fast PRNG over a uint32 seed.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
