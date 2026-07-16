// Generator self-check — runs before build so a generation regression can't
// ship. For many seeds per tier it asserts the dispersion contract:
//   1. the recorded solved state satisfies EVERY pane exactly (got === need),
//   2. the scrambled state is NOT solved and par > 0 (there's a puzzle),
//   3. exactly one emitter, and it is white,
//   4. the solved beam reaches a prism and the full R/G/B fan exists,
//   5. tier shape holds: grid size, prism count (easy's prism fixed, elsewhere
//      a player-controlled prism), colour quotas (easy all-primary; medium ≥1
//      secondary; hard ≥1 secondary-or-white), ≥3 rotatable pieces,
//   6. hard's socket layer: tray of 2–3 pre-cut pieces, sockets ≥ tray (the
//      rest are decoys), all mounts ship empty, the solved assignment solves,
//      prism #1 is never lifted, par covers rotations AND placements.
// Uniqueness (inevitability) stays a SOFT stat — reported, not required.
import { generateBoard, TIERS } from '../src/generate.js';
import {
  DIRS, idx, xy, trace, isSolved, countSolutions, countPlacements,
  rotatableIndices, socketIndices,
} from '../src/engine.js';

const N = 60;
const PRIMARY = [1, 2, 4];
const SECONDARY = [3, 5, 6];
const errors = [];
let total = 0;
const stats = {};

for (const tier of Object.keys(TIERS)) {
  const t = TIERS[tier];
  const pars = []; let unique = 0;
  for (let s = 0; s < N; s++) {
    total++;
    const seed = (s * 2654435761) >>> 0;
    const { board, par, solved, solvedSockets } = generateBoard(seed, tier);
    const where = `${tier} seed#${s}`;
    const tray = board.tray || [];

    // Tier shape.
    if (board.w !== t.w || board.h !== t.h) errors.push(`${where}: grid ${board.w}×${board.h}, want ${t.w}×${t.h}`);
    const emitters = board.cells.filter((c) => c.type === 'emitter');
    if (emitters.length !== 1) errors.push(`${where}: ${emitters.length} emitters`);
    else if (emitters[0].color !== 7) errors.push(`${where}: emitter colour ${emitters[0].color}, want white`);
    const gridPrisms = board.cells.filter((c) => c.type === 'prism');
    const trayPrisms = tray.filter((p) => p.type === 'prism');
    if (gridPrisms.length + trayPrisms.length !== t.prisms) errors.push(`${where}: ${gridPrisms.length}+${trayPrisms.length} prisms, want ${t.prisms}`);
    if (t.fixedPrism && gridPrisms.some((c) => !c.fixed)) errors.push(`${where}: easy prism must be fixed`);
    if (!t.fixedPrism && !gridPrisms.some((c) => !c.fixed) && !trayPrisms.length) errors.push(`${where}: no player-controlled prism`);
    if (rotatableIndices(board).length < 3) errors.push(`${where}: <3 rotatable pieces`);

    // Prism #1: the first thing on the emitter's beam line must be a REAL
    // grid prism — the feed line is unobstructed and prism #1 never lifted.
    {
      const ei = board.cells.indexOf(emitters[0]);
      const [dx, dy] = DIRS[emitters[0].dir];
      let [cx, cy] = xy(ei, board.w); let hit = null;
      for (cx += dx, cy += dy; cx >= 0 && cy >= 0 && cx < board.w && cy < board.h; cx += dx, cy += dy) {
        const c = board.cells[idx(cx, cy, board.w)];
        if (c.type !== 'empty') { hit = c; break; }
      }
      if (!hit || hit.type !== 'prism') errors.push(`${where}: prism #1 lifted or feed line obstructed (hit ${hit && hit.type})`);
    }

    // Socket/tray layer — hard only; elsewhere there must be none.
    if (t.socketK) {
      const sockets = socketIndices(board);
      if (tray.length < 2 || tray.length > 3) errors.push(`${where}: tray has ${tray.length} pieces`);
      if (sockets.length < tray.length) errors.push(`${where}: ${sockets.length} sockets < ${tray.length} tray pieces`);
      if (sockets.some((i) => board.cells[i].piece)) errors.push(`${where}: a socket ships occupied`);
      if (!solvedSockets || solvedSockets.length !== tray.length) errors.push(`${where}: solvedSockets ${solvedSockets && solvedSockets.length}≠tray ${tray.length}`);
      if (!tray.some((p) => p.type === 'mirror')) errors.push(`${where}: no mirror in tray`);
      if (!(par > tray.length)) errors.push(`${where}: par ${par} covers no rotations beyond ${tray.length} placements`);
    } else if (tray.length || socketIndices(board).length) {
      errors.push(`${where}: sockets/tray outside hard`);
    }

    // Colour quotas on pane needs.
    const needs = board.cells.filter((c) => c.type === 'pane').map((c) => c.need);
    if (needs.length === 0) errors.push(`${where}: no panes`);
    if (needs.some((n) => n == null)) errors.push(`${where}: pane with null need`);
    if (tier === 'easy' && !needs.every((n) => PRIMARY.includes(n))) errors.push(`${where}: easy pane needs ${needs}`);
    if (tier === 'medium' && !needs.some((n) => SECONDARY.includes(n))) errors.push(`${where}: no secondary pane (${needs})`);
    if (tier === 'hard' && !needs.some((n) => SECONDARY.includes(n) || n === 7)) errors.push(`${where}: no secondary/white pane (${needs})`);

    // Base state (scrambled, tray unplaced) is a real puzzle.
    if (isSolved(board)) errors.push(`${where}: ships pre-solved`);
    if (!(par > 0)) errors.push(`${where}: par=${par}`);

    // SOFT: uniqueness — placements count on hard, rotations elsewhere.
    // Both solvers restore the board, so check before mutating to solved.
    const u = t.socketK ? countPlacements(board, 2) : countSolutions(board, rotatableIndices(board), 2);
    if (u === 1) unique++;

    // Mounting solvedSockets + applying the recorded solved orientations must
    // satisfy EVERY pane exactly, reach a prism, and keep the R/G/B fan alive.
    if (solvedSockets) for (const { socketIdx, piece } of solvedSockets) board.cells[socketIdx].piece = { ...piece };
    for (const { i, o } of solved) board.cells[i].orient = o;
    const tS = trace(board);
    for (let i = 0; i < board.cells.length; i++) {
      const c = board.cells[i];
      if (c.type !== 'pane') continue;
      const got = tS.paneColor.get(i) || 0;
      if (got !== c.need) errors.push(`${where}: pane@${i} needs ${c.need}, gets ${got}`);
    }
    const isPrism = (c) => c.type === 'prism' || (c.type === 'socket' && c.piece && c.piece.type === 'prism');
    if (!board.cells.some((c, i) => isPrism(c) && tS.lit.has(i))) errors.push(`${where}: solved beam misses every prism`);
    let fan = 0;
    for (const sg of tS.segs) if (sg.color === 1 || sg.color === 2 || sg.color === 4) fan |= sg.color;
    if (fan !== 7) errors.push(`${where}: R/G/B fan incomplete (${fan}/7)`);

    pars.push(par);
  }
  stats[tier] = {
    minPar: Math.min(...pars), maxPar: Math.max(...pars),
    avgPar: (pars.reduce((a, b) => a + b, 0) / pars.length).toFixed(1),
    uniquePct: Math.round((unique / N) * 100),
  };
}

if (errors.length) {
  console.error(`✗ prism generator: ${errors.length}/${total} problem(s)\n  - ${errors.slice(0, 20).join('\n  - ')}`);
  process.exit(1);
}
console.log(`✓ prism generator: ${total} boards — solvable, exact panes, white→prism fan, quotas met.`);
for (const [t, s] of Object.entries(stats)) console.log(`   ${t}: par ${s.minPar}–${s.maxPar} (avg ${s.avgPar}) · ${s.uniquePct}% unique`);
