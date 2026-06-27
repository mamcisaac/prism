// Prism — optical engine. Pure, no DOM. The "predict what happens" surface:
// light is instant, deterministic, and traceable.
//
// Grid is w×h, cells in row-major order. Rays travel N/E/S/W.
// Colour is an additive RGB bitmask: R=1, G=2, B=4, white=7. Mixing at a pane
// is OR of arriving beams; a filter ANDs the passing beam with its colour.

export const DIRS = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };

// The one rule a player must internalise.
const REFLECT = {
  '/':  { E: 'N', N: 'E', W: 'S', S: 'W' },
  '\\': { E: 'S', S: 'E', W: 'N', N: 'W' },
};
export function reflect(orient, dir) { return REFLECT[orient][dir]; }
export const ALT_ORIENT = (o) => (o === '/' ? '\\' : '/');

export const idx = (x, y, w) => y * w + x;
export const xy = (i, w) => [i % w, (i / w) | 0];

export const ROTATABLE = new Set(['mirror', 'splitter']);

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
      const cell = cells[ni];
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
  return out;
}
export function isSolved(board) {
  const t = trace(board);
  return t.paneCount > 0 && t.satisfied.size === t.paneCount;
}

// Count solutions over the 2^n orientations of the rotatable pieces.
// `cap` lets callers early-out (e.g. uniqueness only needs to know if >1).
export function countSolutions(board, rotIdx = rotatableIndices(board), cap = Infinity) {
  const n = rotIdx.length;
  if (n > 22) return -1; // too big to brute force; caller treats as "unknown"
  const saved = rotIdx.map((i) => board.cells[i].orient);
  let count = 0;
  for (let m = 0; m < (1 << n); m++) {
    for (let b = 0; b < n; b++) board.cells[rotIdx[b]].orient = (m >> b) & 1 ? '\\' : '/';
    if (isSolved(board)) { count++; if (count >= cap) break; }
  }
  rotIdx.forEach((i, b) => { board.cells[i].orient = saved[b]; });
  return count;
}

// Region-locking (derived fresh each move, so it can never trap the player):
// a piece locks when its light reaches a satisfied pane and toggling it cannot
// increase the satisfied-pane count — i.e. it's either useless or protecting a
// solved pane. The productive frontier always stays unlocked.
export function lockedSet(board) {
  const t = trace(board);
  const base = t.satisfied.size;
  const locked = new Set();
  if (base === 0) return locked;
  for (const i of rotatableIndices(board)) {
    if (!t.lit.has(i)) continue;            // light hasn't reached it yet → free
    const o = board.cells[i].orient;
    board.cells[i].orient = ALT_ORIENT(o);
    const after = trace(board).satisfied.size;
    board.cells[i].orient = o;
    if (after <= base) locked.add(i);       // toggling can't help → settle it
  }
  return locked;
}

export const colorName = (c) => ({ 1: 'red', 2: 'green', 4: 'blue', 3: 'yellow', 5: 'magenta', 6: 'cyan', 7: 'white' })[c] || 'light';
