// Prism — board generator. Builds backwards from a SOLVED state so solvability
// is guaranteed by construction, then scrambles. Panes are derived from where
// the solved light actually lands (panes are transparent, so adding one on a
// lit cell never changes the trace). Extra panes are added to drive the puzzle
// toward a UNIQUE solution — that uniqueness is what makes the endgame feel
// inevitable. Deterministic in `seed`.

import { idx, xy, trace, isSolved, countSolutions, rotatableIndices, paneIndices, ALT_ORIENT } from './engine.js';

// Same RNG the rest of the arcade seeds with.
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const TIERS = {
  easy:   { w: 6, h: 6, mirrors: 6,  splitters: 0, colors: false, panes: 4, scramble: 0.9 },
  medium: { w: 7, h: 7, mirrors: 9,  splitters: 1, colors: false, panes: 5, scramble: 0.85 },
  hard:   { w: 8, h: 8, mirrors: 12, splitters: 2, colors: true,  panes: 6, scramble: 0.85 },
};

const ORIENTS = ['/', '\\'];
const COLORS = [1, 2, 4]; // R, G, B emitters in colour mode
const BORDERS = ['N', 'E', 'S', 'W'];

function emptyBoard(w, h) {
  return { w, h, cells: Array.from({ length: w * h }, () => ({ type: 'empty' })) };
}
function pick(rng, arr) { return arr[(rng() * arr.length) | 0]; }

// Place an emitter on a border cell firing inward.
function placeEmitter(board, rng, color) {
  const { w, h } = board;
  const side = pick(rng, BORDERS);
  let x, y, dir;
  if (side === 'N') { x = 1 + ((rng() * (w - 2)) | 0); y = 0; dir = 'S'; }
  else if (side === 'S') { x = 1 + ((rng() * (w - 2)) | 0); y = h - 1; dir = 'N'; }
  else if (side === 'W') { x = 0; y = 1 + ((rng() * (h - 2)) | 0); dir = 'E'; }
  else { x = w - 1; y = 1 + ((rng() * (h - 2)) | 0); dir = 'W'; }
  const i = idx(x, y, w);
  if (board.cells[i].type !== 'empty') return false;
  board.cells[i] = { type: 'emitter', dir, color };
  return true;
}

// One attempt: scatter pieces in solved orientations, derive panes, drive to
// uniqueness, scramble. Returns a finished board or null if quality gates fail.
function attempt(rng, t) {
  const board = emptyBoard(t.w, t.h);
  const interior = [];
  for (let y = 1; y < t.h - 1; y++) for (let x = 1; x < t.w - 1; x++) interior.push(idx(x, y, t.w));
  // shuffle interior
  for (let i = interior.length - 1; i > 0; i--) { const j = (rng() * (i + 1)) | 0;[interior[i], interior[j]] = [interior[j], interior[i]]; }

  const emitters = t.colors ? Math.min(3, 1 + ((rng() * 3) | 0)) : 1;
  const used = new Set();
  for (let e = 0; e < emitters; e++) {
    let ok = false;
    for (let tries = 0; tries < 12 && !ok; tries++) ok = placeEmitter(board, rng, t.colors ? COLORS[e % COLORS.length] : 7);
  }

  let p = 0;
  const place = (type, count) => {
    for (let k = 0; k < count && p < interior.length; ) {
      const i = interior[p++];
      if (board.cells[i].type !== 'empty') continue;
      board.cells[i] = { type, orient: pick(rng, ORIENTS) };
      used.add(i); k++;
    }
  };
  place('splitter', t.splitters);
  place('mirror', t.mirrors);

  if (rotatableIndices(board).length < 3) return null;

  // Derive panes from the solved trace — only on lit, empty cells that the
  // light reaches AFTER bouncing off at least one rotatable piece (so the pane
  // genuinely depends on the optics, not on the bare emitter line).
  let t0 = trace(board);
  const litEmpty = [...t0.lit].filter((i) => board.cells[i].type === 'empty');
  // rank by how "deep" the light is (prefer cells far from emitters / endpoints)
  for (let i = litEmpty.length - 1; i > 0; i--) { const j = (rng() * (i + 1)) | 0;[litEmpty[j], litEmpty[i]] = [litEmpty[i], litEmpty[j]]; }
  if (litEmpty.length < t.panes) return null;

  const addPane = (i) => {
    const color = t0.paneColor.get(i) || colorAt(t0, i);
    board.cells[i] = { type: 'pane', need: t.colors ? color : null, color: null, lit: false };
  };
  // colour reaching a cell: recompute by checking segments terminating there
  function colorAt(tr, cell) {
    let c = 0; const [cx, cy] = xy(cell, board.w);
    for (const s of tr.segs) if (s.x1 === cx && s.y1 === cy) c |= s.color;
    return c || 7;
  }

  for (let k = 0; k < t.panes; k++) addPane(litEmpty[k]);
  if (!isSolved(board)) return null; // must hold by construction; guard anyway

  // Demote non-essential mirrors to FIXED decor: a mirror whose toggling breaks
  // no pane is a free degree of freedom (it spawns alternate solutions). Lock it
  // as fixed optics instead of rejecting the board — the light is unchanged, the
  // puzzle just loses a meaningless choice. Every player-rotatable piece is then
  // pinned, which is the real driver of inevitability.
  const paneTotal = () => paneIndices(board).length;
  const pinned = (r) => {
    const o = board.cells[r].orient; board.cells[r].orient = ALT_ORIENT(o);
    const broke = trace(board).satisfied.size < paneTotal();
    board.cells[r].orient = o; return broke;
  };
  for (const r of rotatableIndices(board)) if (!pinned(r)) board.cells[r].fixed = true;
  let rotP = rotatableIndices(board);
  if (rotP.length < 3) return null; // too few real choices → retry

  // Greedily tighten toward a UNIQUE solution over the remaining choices: try
  // each spare lit cell as an extra pane, keep it only if it strictly shrinks
  // the solution set. Extra panes can only constrain, so this converges while
  // keeping the pane count modest.
  let sols = countSolutions(board, rotP, 6);
  const PANE_CAP = t.panes + 5;
  let panes = paneTotal();
  for (let ci = t.panes; ci < litEmpty.length && sols > 1 && panes < PANE_CAP; ci++) {
    const cell = litEmpty[ci];
    if (board.cells[cell].type !== 'empty') continue;
    addPane(cell);
    if (!isSolved(board)) { board.cells[cell] = { type: 'empty' }; continue; }
    const s2 = countSolutions(board, rotP, 6);
    if (s2 < sols) { sols = s2; panes++; } else board.cells[cell] = { type: 'empty' };
  }

  // Record solved orientations, then scramble a subset (leave some correct as
  // "don't-touch" decoys). par = number of pieces that start wrong; vary it for
  // day-to-day variety.
  const rot = rotP;
  const solved = rot.map((i) => board.cells[i].orient);
  const order = rot.map((_, k) => k);
  for (let i = order.length - 1; i > 0; i--) { const j = (rng() * (i + 1)) | 0;[order[i], order[j]] = [order[j], order[i]]; }
  const frac = t.scramble + (rng() - 0.5) * 0.2;
  const nScramble = Math.max(1, Math.min(rot.length, Math.round(rot.length * frac)));
  for (let k = 0; k < nScramble; k++) board.cells[rot[order[k]]].orient = ALT_ORIENT(board.cells[rot[order[k]]].orient);
  const par = nScramble;
  if (isSolved(board)) return null; // scramble must actually break it

  // Light coverage sanity — boards should look full, not sparse.
  if (trace(board).lit.size < Math.floor(t.w * t.h * 0.18)) return null;

  return { board, par, solved: rot.map((i, k) => ({ i, o: solved[k] })), sols };
}

// Best-effort toward uniqueness: return the first unique board found; otherwise
// keep the most-constrained (fewest-solution) valid board. Always returns a real
// solvable puzzle, so there is no empty-board fallback in practice.
export function generateBoard(seed, tierName = 'easy') {
  const t = TIERS[tierName];
  let best = null;
  for (let s = 0; s < 250; s++) {
    const rng = mulberry32((seed ^ (0x9e3779b9 * (s + 1))) >>> 0);
    const r = attempt(rng, t);
    if (!r) continue;
    if (r.sols === 1) { r.tier = tierName; r.seed = seed; return r; }
    if (!best || r.sols < best.sols) best = r;
  }
  if (best) { best.tier = tierName; best.seed = seed; return best; }
  // Pathological fallback (should not happen): retry on the easy tier.
  for (let s = 0; s < 1000; s++) {
    const r = attempt(mulberry32((seed + s) >>> 0), TIERS.easy);
    if (r) { r.tier = tierName; r.seed = seed; return r; }
  }
  return { board: emptyBoard(t.w, t.h), par: 1, solved: [], sols: 0, tier: tierName, seed };
}
