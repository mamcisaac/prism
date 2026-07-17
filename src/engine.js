// Prism — optical engine. Pure, no DOM. The "predict what happens" surface:
// light is instant, deterministic, and traceable.
//
// Grid is w×h, cells in row-major order. Rays travel N/E/S/W.
// Colour is an additive RGB bitmask: R=1, G=2, B=4, white=7. Mixing at a pane
// is OR of arriving beams; a filter ANDs the passing beam with its colour.
// Hard boards add sockets: empty mounts the player fills from board.tray with
// pre-cut (fixed-orientation) pieces.

export const DIRS = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };

// Direction algebra (screen coords, y grows downward).
export const OPP   = { N: 'S', S: 'N', E: 'W', W: 'E' };
export const LEFT  = { N: 'W', W: 'S', S: 'E', E: 'N' };   // 90° CCW on screen
export const RIGHT = { N: 'E', E: 'S', S: 'W', W: 'N' };   // 90° CW on screen

// The one rule a player must internalise.
const REFLECT = {
  '/':  { E: 'N', N: 'E', W: 'S', S: 'W' },
  '\\': { E: 'S', S: 'E', W: 'N', N: 'W' },
};
export function reflect(orient, dir) { return REFLECT[orient][dir]; }
export const ALT_ORIENT = (o) => (o === '/' ? '\\' : '/');

export const idx = (x, y, w) => y * w + x;
export const xy = (i, w) => [i % w, (i / w) | 0];

export const ROTATABLE = new Set(['mirror', 'splitter', 'prism']);

// A prism's orient is the direction its apex points — the base faces light
// travelling that way. Tap cycles N→E→S→W→N.
export const PRISM_ORIENTS = ['N', 'E', 'S', 'W'];

// Every orientation a piece can take. THE source of truth for rotation.
export function orientStates(cell) {
  return cell.type === 'prism' ? PRISM_ORIENTS : ['/', '\\'];
}

// The tap verb: advance a piece to its next orientation (mutates the cell).
export function rotateOnce(cell) {
  const states = orientStates(cell);
  cell.orient = states[(states.indexOf(cell.orient) + 1) % states.length];
}

// Minimum taps to reach targetOrient from the current one (for par).
export function tapDistance(cell, targetOrient) {
  const states = orientStates(cell);
  const d = states.indexOf(targetOrient) - states.indexOf(cell.orient);
  return (d + states.length) % states.length;
}

const EMPTY = { type: 'empty' }; // what an unoccupied socket presents to the trace

// Trace every beam from every emitter. Returns derived light state.
export function trace(board) {
  const { w, h, cells } = board;
  const lit = new Set();            // cell idx the light passes through
  const segs = [];                  // {x0,y0,x1,y1,color} for rendering
  const paneColor = new Map();      // pane idx -> received colour bitmask (OR)
  const seen = new Set();           // cycle guard: "x,y,dir,color"
  const queue = [];

  for (let i = 0; i < cells.length; i++) {
    if (cells[i].type === 'emitter') {
      const [x, y] = xy(i, w);
      queue.push({ x, y, dir: cells[i].dir, color: cells[i].color });
    }
  }

  const MAX = w * h * 32 + 256;
  let steps = 0;
  while (queue.length) {
    let { x, y, dir, color } = queue.pop();
    while (true) {
      if (++steps > MAX) break;
      const [dx, dy] = DIRS[dir];
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) break; // off board
      const ni = idx(nx, ny, w);
      let cell = cells[ni];
      // A socket is an empty mount (transparent) until a tray piece is
      // mounted in it — then it behaves exactly as the held piece.
      if (cell.type === 'socket') cell = cell.piece || EMPTY;
      if (cell.type === 'wall' || cell.type === 'emitter') break; // opaque
      const key = nx + ',' + ny + ',' + dir + ',' + color;
      if (seen.has(key)) break;
      seen.add(key);
      segs.push({ x0: x, y0: y, x1: nx, y1: ny, color });
      lit.add(ni);

      if (cell.type === 'mirror') { dir = reflect(cell.orient, dir); x = nx; y = ny; continue; }
      if (cell.type === 'splitter') {
        queue.push({ x: nx, y: ny, dir: reflect(cell.orient, dir), color }); // reflected branch
        x = nx; y = ny; continue;                                            // straight continues
      }
      if (cell.type === 'prism') {
        const d = cell.orient;
        if (dir === d) {                       // base entry → disperse into primaries
          if (color & 1) queue.push({ x: nx, y: ny, dir: LEFT[d],  color: 1 });
          if (color & 2) queue.push({ x: nx, y: ny, dir: d,        color: 2 });
          if (color & 4) queue.push({ x: nx, y: ny, dir: RIGHT[d], color: 4 });
          break;                               // incoming ray ends; children take over
        }
        // Fan-port entry (reversed): each port passes only its own primary.
        const pass = dir === RIGHT[d] ? color & 1 : dir === OPP[d] ? color & 2 : color & 4;
        if (!pass) break;                      // wrong colour for this port → absorbed
        dir = OPP[d]; color = pass; x = nx; y = ny; continue; // exits out the base
      }
      if (cell.type === 'filter') { color = color & cell.color; if (!color) break; x = nx; y = ny; continue; }
      if (cell.type === 'pane') { paneColor.set(ni, (paneColor.get(ni) || 0) | color); x = nx; y = ny; continue; }
      x = nx; y = ny; // empty
    }
  }

  const satisfied = new Set();
  let paneCount = 0;
  for (let i = 0; i < cells.length; i++) {
    if (cells[i].type !== 'pane') continue;
    paneCount++;
    const got = paneColor.get(i) || 0;
    const need = cells[i].need;
    if (got !== 0 && (need == null || got === need)) satisfied.add(i);
  }
  return { lit, segs, paneColor, satisfied, paneCount };
}

export function paneIndices(board) {
  const out = [];
  for (let i = 0; i < board.cells.length; i++) if (board.cells[i].type === 'pane') out.push(i);
  return out;
}
export function rotatableIndices(board) {
  const out = [];
  for (let i = 0; i < board.cells.length; i++) {
    const c = board.cells[i];
    if (ROTATABLE.has(c.type) && !c.fixed) out.push(i); // fixed mirrors are decor, not puzzle
  }
  return out; // sockets never appear here — a mounted piece's orientation is pre-cut
}
export function socketIndices(board) {
  const out = [];
  for (let i = 0; i < board.cells.length; i++) if (board.cells[i].type === 'socket') out.push(i);
  return out;
}
export function isSolved(board) {
  const t = trace(board);
  return t.paneCount > 0 && t.satisfied.size === t.paneCount;
}

// Count solutions over the mixed-radix Cartesian product of orientStates for
// every rotatable piece (mirrors contribute 2 states, prisms 4).
// `cap` lets callers early-out (e.g. uniqueness only needs to know if >1).
export function countSolutions(board, rotIdx = rotatableIndices(board), cap = Infinity) {
  const n = rotIdx.length;
  const states = rotIdx.map((i) => orientStates(board.cells[i]));
  let total = 1;
  for (const s of states) {
    total *= s.length;
    if (total > (1 << 20)) return -1; // too big to brute force; caller treats as "unknown"
  }
  const saved = rotIdx.map((i) => board.cells[i].orient);
  let count = 0;
  for (let m = 0; m < total; m++) {
    for (let b = 0, r = m; b < n; b++) {
      board.cells[rotIdx[b]].orient = states[b][r % states[b].length];
      r = (r / states[b].length) | 0;
    }
    if (isSolved(board)) { count++; if (count >= cap) break; }
  }
  rotIdx.forEach((i, b) => { board.cells[i].orient = saved[b]; });
  return count;
}

// Count solutions over (assignments of the tray-piece multiset to sockets,
// pieces optionally left unplaced) × (orientations of rotatable pieces).
// Enumerates from a normalized all-pieces-lifted base, so the current
// placement state is one of the counted assignments. Identical tray pieces
// (same type+orient) are grouped so swapping twins isn't double-counted.
// With no sockets and no tray this reduces exactly to countSolutions.
export function countPlacements(board, cap = Infinity) {
  const sockets = socketIndices(board);
  const rotIdx = rotatableIndices(board);

  // Pool = tray + everything currently mounted, grouped into a multiset.
  const pool = (board.tray || []).concat(sockets.map((i) => board.cells[i].piece).filter(Boolean));
  const groups = [];
  for (const p of pool) {
    const g = groups.find((g) => g.type === p.type && g.orient === p.orient);
    if (g) g.count++; else groups.push({ type: p.type, orient: p.orient, count: 1 });
  }

  // Bail out above ~2^20 total combinations (assignments × orientations).
  let orientTotal = 1;
  for (const i of rotIdx) {
    orientTotal *= orientStates(board.cells[i]).length;
    if (orientTotal > (1 << 20)) return -1;
  }
  const budget = ((1 << 20) / orientTotal) | 0; // max assignments we may enumerate
  let assignTotal = 0, over = false;
  (function tally(s) {
    if (over) return;
    if (s === sockets.length) { if (++assignTotal > budget) over = true; return; }
    tally(s + 1);                              // this socket left empty
    for (const g of groups) {
      if (!g.count || over) continue;
      g.count--; tally(s + 1); g.count++;      // this socket takes one of group g
    }
  })(0);
  if (over) return -1; // too big to brute force; caller treats as "unknown"

  const saved = sockets.map((i) => board.cells[i].piece || null);
  let count = 0;
  const place = (s) => { // depth-first over sockets; returns false once cap is hit
    if (s === sockets.length) {
      count += countSolutions(board, rotIdx, cap - count);
      return count < cap;
    }
    const mount = board.cells[sockets[s]];
    mount.piece = null;
    if (!place(s + 1)) return false;
    for (const g of groups) {
      if (!g.count) continue;
      g.count--;
      mount.piece = { type: g.type, orient: g.orient };
      const go = place(s + 1);
      g.count++;
      mount.piece = null;
      if (!go) return false;
    }
    return true;
  };
  place(0);
  sockets.forEach((i, s) => { board.cells[i].piece = saved[s]; }); // tray was never mutated
  return count;
}

// Region-locking (derived fresh each move, so it can never trap the player):
// a piece locks when light has reached it and NO alternative orientation can
// increase the satisfied-pane count — i.e. it's either useless or protecting a
// solved pane. The productive frontier always stays unlocked.
//
// Frost renders as "settled — there was never another answer", so it must
// never touch a piece the solution still needs to move. Pass the generator's
// `solution` ({ solved: [{i, o}], solvedSockets: [{socketIdx, piece}] }) and a
// piece additionally frosts only in its SOLVED configuration: a rotatable at
// its solved orient, a socket holding exactly its solved piece (type+orient;
// decoy and misfilled mounts never frost). Only ever removes frost relative to
// the heuristic alone. Without `solution`: heuristic behaviour, unchanged.
export function lockedSet(board, solution) {
  const t = trace(board);
  const base = t.satisfied.size;
  const locked = new Set();
  if (base === 0) return locked;
  const solvedO = solution ? new Map(solution.solved.map(({ i, o }) => [i, o])) : null;
  const solvedS = solution ? new Map((solution.solvedSockets || []).map(({ socketIdx, piece }) => [socketIdx, piece])) : null;
  for (const i of rotatableIndices(board)) {
    if (!t.lit.has(i)) continue;            // light hasn't reached it yet → free
    const cell = board.cells[i];
    if (solvedO && solvedO.has(i) && solvedO.get(i) !== cell.orient) continue; // must still move → free
    const o = cell.orient;
    let helps = false;
    for (const alt of orientStates(cell)) {
      if (alt === o) continue;
      cell.orient = alt;
      if (trace(board).satisfied.size > base) { helps = true; break; }
    }
    cell.orient = o;
    if (!helps) locked.add(i);              // no rotation can help → settle it
  }
  // Occupied sockets frost when load-bearing: lifting the piece would
  // strictly lose a satisfied pane. Empty mounts never lock.
  for (const i of socketIndices(board)) {
    const mount = board.cells[i];
    if (!mount.piece) continue;
    if (solvedS) {                          // frost only the solved assignment
      const want = solvedS.get(i);
      if (!want || want.type !== mount.piece.type || want.orient !== mount.piece.orient) continue;
    }
    const p = mount.piece;
    mount.piece = null;                     // lift-test
    const after = trace(board).satisfied.size;
    mount.piece = p;
    if (after < base) locked.add(i);        // it's holding a pane together → settle it
  }
  return locked;
}

export const colorName = (c) => ({ 1: 'red', 2: 'green', 4: 'blue', 3: 'yellow', 5: 'magenta', 6: 'cyan', 7: 'white' })[c] || 'light';
