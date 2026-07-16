// Prism — board generator. Builds backwards from a SOLVED state so solvability
// is guaranteed by construction, then scrambles. One WHITE emitter feeds a
// prism a few unobstructed cells ahead, so the signature opening — white beam
// → prism → R/G/B fan — exists in every solved board (and at load on easy,
// where the prism is fixed). Panes are derived from where the solved light
// actually lands, with the OR'd arriving colour as `need` (panes are
// transparent, so adding one on a lit cell never changes the trace). Extra
// panes are added to drive the puzzle toward a UNIQUE solution — that
// uniqueness is what makes the endgame feel inevitable. Deterministic in `seed`.

import {
  DIRS, idx, trace, isSolved, countSolutions, countPlacements, rotatableIndices,
  paneIndices, socketIndices, orientStates, rotateOnce, tapDistance,
} from './engine.js';

// Same RNG the rest of the arcade seeds with.
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Colour is the game at every tier now. Easy stays legible because every pane
// wants a plain primary; medium demands a crossing (secondary pane); hard adds
// a second prism and accepts white recombination panes too.
export const TIERS = {
  easy:   { w: 6, h: 6, prisms: 1, fixedPrism: true,  mirrors: [5, 6],   splitters: [0, 0], panes: 3, paneCap: 5, primariesOnly: true, quota: null,         scramble: 1.0,  parMin: 4, parMax: 7 },
  medium: { w: 7, h: 7, prisms: 1, fixedPrism: false, mirrors: [8, 8],   splitters: [0, 1], panes: 4, paneCap: 6, primariesOnly: false, quota: [3, 5, 6],    scramble: 0.85, parMin: 6, parMax: 12 },
  hard:   { w: 8, h: 8, prisms: 2, fixedPrism: false, mirrors: [10, 12], splitters: [1, 2], panes: 5, paneCap: 7, primariesOnly: false, quota: [3, 5, 6, 7], scramble: 0.85, parMin: 8, parMax: 16, socketK: [2, 3], decoys: [1, 3] },
};

const BORDERS = ['N', 'E', 'S', 'W'];
const PRIMARIES = [1, 2, 4];

function emptyBoard(w, h) {
  return { w, h, cells: Array.from({ length: w * h }, () => ({ type: 'empty' })) };
}
function pick(rng, arr) { return arr[(rng() * arr.length) | 0]; }
function irange(rng, [lo, hi]) { return lo + ((rng() * (hi - lo + 1)) | 0); }
function shuffle(rng, arr) {
  for (let i = arr.length - 1; i > 0; i--) { const j = (rng() * (i + 1)) | 0; [arr[i], arr[j]] = [arr[j], arr[i]]; }
  return arr;
}

// Trace-free count of tray→socket assignments (multiset, unplaced allowed) —
// used to budget countPlacements before paying for it.
function assignmentCount(board) {
  const sockets = socketIndices(board);
  const pool = (board.tray || []).concat(sockets.map((i) => board.cells[i].piece).filter(Boolean));
  const groups = [];
  for (const p of pool) {
    const g = groups.find((g) => g.type === p.type && g.orient === p.orient);
    if (g) g.count++; else groups.push({ type: p.type, orient: p.orient, count: 1 });
  }
  let n = 0;
  (function tally(s) {
    if (s === sockets.length) { n++; return; }
    tally(s + 1);
    for (const g of groups) { if (!g.count) continue; g.count--; tally(s + 1); g.count++; }
  })(0);
  return n;
}

// White emitter on a border cell firing inward; prism #1 placed 2–4 cells
// ahead ON the beam line with nothing between. The feed-line cells come back
// as `reserved` so nothing (pieces or panes) ever lands on them — the
// dispersion opening is built in, not hoped for.
function placeEmitterAndPrism(board, rng, fixedPrism) {
  const { w, h } = board;
  const side = pick(rng, BORDERS);
  let x, y, dir, depth;
  if (side === 'N')      { x = 1 + ((rng() * (w - 2)) | 0); y = 0;     dir = 'S'; depth = h - 2; }
  else if (side === 'S') { x = 1 + ((rng() * (w - 2)) | 0); y = h - 1; dir = 'N'; depth = h - 2; }
  else if (side === 'W') { x = 0; y = 1 + ((rng() * (h - 2)) | 0);     dir = 'E'; depth = w - 2; }
  else                   { x = w - 1; y = 1 + ((rng() * (h - 2)) | 0); dir = 'W'; depth = w - 2; }
  const k = 2 + ((rng() * Math.min(3, depth - 1)) | 0); // prism stays interior, fan has room
  const [dx, dy] = DIRS[dir];
  const reserved = new Set([idx(x, y, w)]);
  for (let s = 1; s < k; s++) reserved.add(idx(x + dx * s, y + dy * s, w));
  const prismIdx = idx(x + dx * k, y + dy * k, w);
  reserved.add(prismIdx);
  board.cells[idx(x, y, w)] = { type: 'emitter', dir, color: 7 };
  board.cells[prismIdx] = fixedPrism
    ? { type: 'prism', orient: dir, fixed: true }
    : { type: 'prism', orient: dir };
  return { reserved, prismIdx };
}

// Hard tier's second prism, dropped constructively ON an existing coloured
// beam with its base facing the light — it always does optical work
// (splits/routes what arrives) instead of hoping a random scatter catches
// a beam. Random scatter almost never does.
function addPrismOnBeam(board, rng, reserved) {
  const tr = trace(board);
  const seenCell = new Set();
  const cand = [];
  for (const s of tr.segs) {
    const i = idx(s.x1, s.y1, board.w);
    if (seenCell.has(i) || reserved.has(i) || board.cells[i].type !== 'empty') continue;
    if (s.x1 < 1 || s.y1 < 1 || s.x1 > board.w - 2 || s.y1 > board.h - 2) continue;
    seenCell.add(i);
    cand.push({ i, dir: s.x1 > s.x0 ? 'E' : s.x1 < s.x0 ? 'W' : s.y1 > s.y0 ? 'S' : 'N' });
  }
  if (!cand.length) return false;
  const c = pick(rng, cand);
  board.cells[c.i] = { type: 'prism', orient: c.dir };
  return true;
}

// One attempt: build the emitter→prism opening, scatter pieces in solved
// orientations, derive quota-respecting panes from the trace, drive toward
// uniqueness, scramble. Returns a finished board or null if a gate fails.
function attempt(rng, t) {
  const board = emptyBoard(t.w, t.h);
  const { reserved, prismIdx } = placeEmitterAndPrism(board, rng, t.fixedPrism);

  // Scatter mirrors/splitters in solved orientations, never on the feed line.
  const interior = [];
  for (let y = 1; y < t.h - 1; y++) for (let x = 1; x < t.w - 1; x++) {
    const i = idx(x, y, t.w);
    if (!reserved.has(i) && board.cells[i].type === 'empty') interior.push(i);
  }
  shuffle(rng, interior);
  let p = 0;
  const place = (type, count) => {
    for (let k = 0; k < count && p < interior.length; ) {
      const i = interior[p++];
      if (board.cells[i].type !== 'empty') continue;
      board.cells[i] = { type, orient: pick(rng, ['/', '\\']) };
      k++;
    }
  };
  place('splitter', irange(rng, t.splitters));
  place('mirror', irange(rng, t.mirrors));
  if (t.prisms > 1 && !addPrismOnBeam(board, rng, reserved)) return null;

  // Solved-trace gates: white reaches prism #1 (by construction — the feed
  // line is reserved) and the full R/G/B fan survives somewhere on the board.
  const t0 = trace(board);
  if (!t0.lit.has(prismIdx)) return null;
  let fan = 0;
  for (const s of t0.segs) if (s.color === 1 || s.color === 2 || s.color === 4) fan |= s.color;
  if (fan !== 7) return null;

  // Arriving colour per lit empty cell (OR of every beam that enters it) —
  // exactly what a pane placed there would receive as `need`. Feed-line cells
  // are excluded: a white pane there would be trivially, permanently lit.
  const colorAt = new Map();
  for (const s of t0.segs) {
    const i = idx(s.x1, s.y1, t.w);
    if (board.cells[i].type === 'empty' && !reserved.has(i)) colorAt.set(i, (colorAt.get(i) || 0) | s.color);
  }
  const cand = shuffle(rng, [...colorAt.keys()]);

  // Pane picks honour the tier colour quota; reject the attempt if they can't.
  const chosen = [];
  const takeWhere = (ok) => {
    const j = cand.findIndex((i) => !chosen.includes(i) && ok(colorAt.get(i)));
    if (j < 0) return false;
    chosen.push(cand[j]);
    return true;
  };
  if (t.primariesOnly) {
    for (const c of PRIMARIES) if (!takeWhere((got) => got === c)) return null; // one pane per primary
  } else {
    if (!takeWhere((got) => t.quota.includes(got))) return null; // ≥1 secondary(/white) pane
    while (chosen.length < t.panes) {
      const used = new Set(chosen.map((i) => colorAt.get(i)));
      if (!takeWhere((got) => !used.has(got)) && !takeWhere(() => true)) break; // prefer fresh colours
    }
    if (chosen.length < t.panes) return null;
  }
  const addPane = (i) => { board.cells[i] = { type: 'pane', need: colorAt.get(i), color: null, lit: false }; };
  for (const i of chosen) addPane(i);
  if (!isSolved(board)) return null; // must hold by construction; guard anyway

  // Demote never-matters pieces to FIXED decor: a piece with no orientation
  // that breaks a pane is a free degree of freedom (it spawns alternate
  // solutions). Lock it as fixed optics instead of rejecting the board — the
  // light is unchanged, the puzzle just loses a meaningless choice.
  const paneTotal = () => paneIndices(board).length;
  const matters = (i) => {
    const cell = board.cells[i];
    const o = cell.orient;
    let broke = false;
    for (const alt of orientStates(cell)) {
      if (alt === o) continue;
      cell.orient = alt;
      if (trace(board).satisfied.size < paneTotal()) { broke = true; break; }
    }
    cell.orient = o;
    return broke;
  };
  for (const i of rotatableIndices(board)) if (!matters(i)) board.cells[i].fixed = true;
  let rotP = rotatableIndices(board);
  if (rotP.length < 3) return null;
  // Wherever the prism isn't fixed by design, dispersion must be part of the puzzle.
  if (!t.fixedPrism && !rotP.some((i) => board.cells[i].type === 'prism')) return null;

  // HARD: the socket/tray layer. Convert K pinned LOAD-BEARING pieces (lifting
  // them breaks a pane) into sockets holding their solved piece — the player
  // will decide WHERE those pre-cut optics go. Prism #1 is never lifted: that
  // would kill the opening fan. Decoy sockets land on cells off every solved
  // beam path so an empty mount is a real decision, not a beacon.
  let solvedSockets = null;
  if (t.socketK) {
    const loadBearing = (i) => {
      const cell = board.cells[i];
      board.cells[i] = { type: 'empty' };
      const broke = trace(board).satisfied.size < paneTotal();
      board.cells[i] = cell;
      return broke;
    };
    const liftable = shuffle(rng, rotP.filter((i) => i !== prismIdx && loadBearing(i)));
    const mirror0 = liftable.find((i) => board.cells[i].type === 'mirror');
    const prism2 = liftable.find((i) => board.cells[i].type === 'prism');
    if (mirror0 == null) return null;                       // at least one mirror in the tray
    const K = irange(rng, t.socketK);
    const picked = [mirror0];
    if (prism2 != null) picked.push(prism2);                // prism #2 joins the tray when it can
    for (const i of liftable) { if (picked.length >= K) break; if (!picked.includes(i)) picked.push(i); }
    if (picked.length < 2) return null;
    solvedSockets = picked.map((i) => ({ socketIdx: i, piece: { type: board.cells[i].type, orient: board.cells[i].orient } }));
    for (const { socketIdx, piece } of solvedSockets) board.cells[socketIdx] = { type: 'socket', piece: { ...piece } };
    rotP = rotatableIndices(board);                         // mounted pieces are pre-cut, not rotatable
    if (rotP.length < 3) return null;
    let maxTaps = 0;                                        // can the leftovers still reach the par window?
    for (const i of rotP) maxTaps += orientStates(board.cells[i]).length - 1;
    if (maxTaps + picked.length < t.parMin) return null;

    const litNow = trace(board).lit;                        // pieces still mounted → solved beams
    const dark = [];
    for (let y = 1; y < t.h - 1; y++) for (let x = 1; x < t.w - 1; x++) {
      const i = idx(x, y, t.w);
      if (board.cells[i].type === 'empty' && !litNow.has(i) && !reserved.has(i)) dark.push(i);
    }
    if (!dark.length) return null;
    shuffle(rng, dark);
    const D = Math.min(irange(rng, t.decoys), dark.length);
    for (let k = 0; k < D; k++) board.cells[dark[k]] = { type: 'socket', piece: null };
  }

  // Greedily tighten toward a UNIQUE solution: try each spare lit cell as an
  // extra pane (easy stays primaries-only), keep it only if it strictly
  // shrinks the solution set. Skip when the orientation product is too big to
  // brute-force cheaply — uniqueness is a soft goal, solvability is not.
  let product = 1;
  for (const i of rotP) product *= orientStates(board.cells[i]).length;
  let sols = product <= (1 << 13) ? countSolutions(board, rotP, 6) : -1;
  let panes = paneTotal();
  for (let ci = 0; ci < cand.length && sols > 1 && panes < t.paneCap; ci++) {
    const i = cand[ci];
    if (board.cells[i].type !== 'empty') continue;
    if (t.primariesOnly && !PRIMARIES.includes(colorAt.get(i))) continue;
    addPane(i);
    if (!isSolved(board)) { board.cells[i] = { type: 'empty' }; continue; }
    const s2 = countSolutions(board, rotP, sols);
    if (s2 < sols) { sols = s2; panes++; } else board.cells[i] = { type: 'empty' };
  }

  // HARD stage two: uniqueness over PLACEMENTS too — where can the tray
  // pieces go? Rotations are already pinned above (cheap), so this pass only
  // pays for countPlacements when socket swaps still admit spare solutions,
  // and only within a trace budget (uniqueness is soft, runtime is not).
  if (t.socketK) {
    const budget = assignmentCount(board) * product;
    let solsP = budget <= (1 << 16) ? countPlacements(board, 6) : -1;
    for (let ci = 0, tried = 0; ci < cand.length && solsP > 1 && panes < t.paneCap && tried < 6; ci++) {
      const i = cand[ci];
      if (board.cells[i].type !== 'empty') continue;
      addPane(i);
      if (!isSolved(board)) { board.cells[i] = { type: 'empty' }; continue; }
      tried++;
      const s2 = countPlacements(board, solsP);
      if (s2 > 0 && s2 < solsP) { solsP = s2; panes++; } else board.cells[i] = { type: 'empty' };
    }
    sols = solsP;

    // Lift the pre-cut pieces to a shuffled tray; their sockets become empty mounts.
    board.tray = shuffle(rng, solvedSockets.map(({ piece }) => ({ ...piece })));
    for (const { socketIdx } of solvedSockets) board.cells[socketIdx].piece = null;
  }

  // Record solved orientations, then scramble via rotateOnce — mirrors get one
  // tap, prisms 1–3 (prisms are always scrambled; a scrambled prism still
  // leaks one primary out of a port, so the board glows at load). par is the
  // tap distance BACK to the solved state, measured from the scrambled
  // orientations — the order matters because tapDistance reads the CURRENT
  // cell. Rescramble a few times if par lands outside the tier window.
  const solvedO = rotP.map((i) => board.cells[i].orient);
  let par = 0;
  for (let retry = 0; retry < 4 && !par; retry++) {
    rotP.forEach((i, k) => { board.cells[i].orient = solvedO[k]; });
    const order = shuffle(rng, rotP.map((_, k) => k));
    const frac = t.scramble + (rng() - 0.5) * 0.15;
    const nS = Math.max(1, Math.min(rotP.length, Math.round(rotP.length * frac)));
    const move = new Set(order.slice(0, nS));
    rotP.forEach((i, k) => {
      const cell = board.cells[i];
      if (cell.type === 'prism') { const taps = 1 + ((rng() * 3) | 0); for (let n = 0; n < taps; n++) rotateOnce(cell); }
      else if (move.has(k)) rotateOnce(cell);
    });
    let d = 0;
    rotP.forEach((i, k) => { d += tapDistance(board.cells[i], solvedO[k]); });
    if (solvedSockets) d += solvedSockets.length; // one placement move per lifted piece
    if (d >= t.parMin && d <= t.parMax && !isSolved(board)) par = d;
  }
  if (!par) return null;

  // Light coverage sanity in the SCRAMBLED state — dark-at-start was the core
  // complaint; boards should glow from the first frame.
  if (trace(board).lit.size < Math.floor(t.w * t.h * 0.18)) return null;

  const out = { board, par, solved: rotP.map((i, k) => ({ i, o: solvedO[k] })), sols };
  if (solvedSockets) out.solvedSockets = solvedSockets;
  return out;
}

// Best-effort toward uniqueness: return the first unique board found; otherwise
// keep the most-constrained (fewest-solution) valid board. Always returns a real
// solvable puzzle, so there is no empty-board fallback in practice.
export function generateBoard(seed, tierName = 'easy') {
  const t = TIERS[tierName];
  const rank = (s) => (s === -1 ? Infinity : s); // unknown counts worse than any known
  let best = null;
  for (let s = 0; s < 300; s++) {
    const rng = mulberry32((seed ^ (0x9e3779b9 * (s + 1))) >>> 0);
    const r = attempt(rng, t);
    if (!r) continue;
    if (r.sols === 1) { r.tier = tierName; r.seed = seed; return r; }
    if (!best || rank(r.sols) < rank(best.sols)) best = r;
    if (best && rank(best.sols) <= 2 && s >= 80) break; // near-unique is good enough
  }
  if (best) { best.tier = tierName; best.seed = seed; return best; }
  // Pathological fallback (should not happen): keep trying the SAME tier with
  // fresh salts so tier invariants (grid, prisms, quotas) always hold.
  for (let s = 0; s < 2000; s++) {
    const r = attempt(mulberry32((seed + 0x9e37 + s * 7919) >>> 0), t);
    if (r) { r.tier = tierName; r.seed = seed; return r; }
  }
  return { board: emptyBoard(t.w, t.h), par: 1, solved: [], sols: 0, tier: tierName, seed };
}
