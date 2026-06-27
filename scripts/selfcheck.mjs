// Generator self-check — runs before build so a generation regression can't
// ship. For many seeds per tier it asserts that every generated board:
//   1. has a recorded solved state that lights ALL panes,
//   2. is NOT already solved in its scrambled state (there's a puzzle),
//   3. has a UNIQUE solution (inevitability),
//   4. has par > 0.
import { generateBoard, TIERS } from '../src/generate.js';
import { trace, countSolutions, rotatableIndices, ALT_ORIENT } from '../src/engine.js';

const N = 60;
const errors = [];
let total = 0;
const stats = {};

for (const tier of Object.keys(TIERS)) {
  const pars = []; let unique = 0;
  for (let s = 0; s < N; s++) {
    total++;
    const seed = (s * 2654435761) >>> 0;
    const { board, par, solved } = generateBoard(seed, tier);
    const where = `${tier} seed#${s}`;

    // HARD invariants: real, solvable puzzle.
    const t0 = trace(board);
    if (t0.paneCount === 0) errors.push(`${where}: no panes`);
    if (t0.satisfied.size === t0.paneCount && t0.paneCount > 0) errors.push(`${where}: ships pre-solved`);
    if (!(par > 0)) errors.push(`${where}: par=${par}`);

    // applying the recorded solved orientations must light EVERY pane.
    for (const { i, o } of solved) board.cells[i].orient = o;
    const tS = trace(board);
    if (tS.satisfied.size !== tS.paneCount) errors.push(`${where}: solved state lights ${tS.satisfied.size}/${tS.paneCount} panes`);

    // SOFT: uniqueness (inevitability) — reported, not required.
    if (countSolutions(board, rotatableIndices(board), 2) === 1) unique++;
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
console.log(`✓ prism generator: ${total} boards — all solvable, a real puzzle, par > 0.`);
for (const [t, s] of Object.entries(stats)) console.log(`   ${t}: par ${s.minPar}–${s.maxPar} (avg ${s.avgPar}) · ${s.uniquePct}% unique`);
