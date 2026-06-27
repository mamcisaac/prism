# Prism — Design

> Rotate the optics until light blooms through every pane.
> Part of the [Connect the Thoughts](https://connectthethoughts.ca/) arcade.

## Concept

A dark stained-glass panel. A beam of light enters from one edge. Scattered across the
panel are **mirrors** you can rotate. **One verb — tap a mirror to rotate it** — and the
*entire* downstream beam re-routes: it bends, branches, and floods new cells. The goal is
simple and legible at a glance: **light up every pane.**

The magic we are deliberately engineering (and the three things that separate this from a
generic mirror-laser puzzle):

1. **Observability is the whole game.** Light is instant, deterministic, and traceable.
   Before every move the player can answer *"what happens if I rotate this?"* — that
   predictability is the load-bearing property. No hidden RNG during play, ever.
2. **Local edits, global blooms.** A board is tuned so one rotation re-lights roughly a
   **third to a half** of the active beam — big enough to feel dramatic, small enough that
   the player never loses causality.
3. **Inevitability, not just correctness.** As panes are satisfied, the optics that feed
   them **lock** (frost over). The free-piece set shrinks monotonically, so the endgame
   feels *forced* — "there was never another answer."

Base goal is **light, not colour**. Colour is a hard-mode layer (see Difficulty), so casual
players experience *flow and bloom* rather than mentally reducing it to "match the colours."

## Round

- A grid (6×6 → 9×9). Rays travel orthogonally (N/E/S/W).
- One or more **emitters** on the border fire a beam inward.
- Some cells hold **rotatable mirrors** (the player's pieces); others hold fixed **walls**,
  **splitters**, or **panes** (targets).
- Player taps a mirror to toggle/rotate it. The beam re-traces instantly; newly lit panes
  pop and chime; satisfied panes (and the now-determined optics feeding them) **lock**.
- Solved when **every pane is lit** (base) / **lit with its target colour** (hard).
- No timer, free unlimited rotations, free reset. Scored on **moves vs. par** (see Scoring).

## Pieces

| Piece | Fixed/rotatable | Behaviour |
|---|---|---|
| **Emitter** | fixed (border) | Emits one ray inward; white (base) or coloured (hard). |
| **Mirror** | **rotatable** (the verb) | 45° mirror, two states `/` and `\`. Reflects a ray 90°. |
| **Splitter** | fixed (Easy/Med) → rotatable (Hard) | Passes the ray straight **and** reflects 90° — branches the beam. |
| **Wall** | fixed | Blocks light. Pure constraint/decoration. |
| **Pane** | fixed (target) | Must receive light (base) or a specific colour (hard). Glows when satisfied. |
| **Filter / colour-shifter** | fixed (hard) | Tints a passing beam (e.g. white → red). |

**Mirror reflection table** (the only rule the player must internalise):
- `/` : E→N, N→E, W→S, S→W
- `\` : E→S, S→E, W→N, N→W

That single table is the entire "predict what happens" surface in base mode. Everything else
is composition of it.

### Beam interactions (the signature — kept traceable)

- **Additive mix at a pane (hard):** a pane hit by a red beam *and* a green beam reads as
  yellow. Traceable because the player sees both beams terminate on one visible pane.
- **Head-on cancel (hard):** two directly opposing beams meeting in a cell annihilate.
  Traceable (you see them collide).
- **Charge-lens chains (hard-mode-only, optional):** a lens that, once struck, emits a new
  ray — the one mechanic that can cascade past the 70% legibility ceiling, so it is **gated
  to hard mode** and used sparingly. Do **not** put this in the base game.

## Generation — guaranteed solvable (the crux)

Boards are **built backwards from a solved state**, the same philosophy as Ladder's
generate-then-validate and Switchback's unique path. Solvability is therefore guaranteed by
construction, never by luck.

```
buildBoard(seed, difficulty):
  rng = mulberry32(seed)                       # seed = UTC-date hash + difficulty offset
  grid = empty(size[difficulty])
  place emitter(s) on the border (rng)

  # 1. GROW A SOLVED LIGHT NETWORK
  for each emitter:
    walk the beam through the grid (rng-chosen turns):
      at each chosen turn cell, place a mirror in the orientation that produces that turn
      occasionally place a splitter to branch (Med/Hard), recursing on the new beam
    designate selected beam endpoints as PANES (record their colour in hard mode)
  record solvedOrientation for every rotatable piece

  # 2. DECORATE
  drop walls into empty cells that do NOT intersect any solved beam path

  # 3. (ELEGANCE) ENFORCE UNIQUENESS  -> this is what creates "inevitability"
  if solver(grid).solutionCount != 1:
    add a constraining pane/wall, or perturb, and retry (bounded attempts)

  # 4. SCRAMBLE
  for each rotatable piece:
    set it to a random orientation != solvedOrientation
  par = Σ minRotations(scrambled_i → solved_i)   # the daily "beat par" target

  return { grid, solvedOrientation, par }
```

Notes:
- **Solver** for the uniqueness check is a small branch-and-bound over rotatable-piece
  orientations (prune as soon as a placed mirror sends light off-board or starves a pane).
  Grids are tiny, so this is cheap.
- Uniqueness is what makes the last moves feel *forced*. For the first build it can be
  best-effort (most constructed boards with enough panes are already unique); full
  enforcement is a fast-follow.
- **Region-locking rule (safe, monotone):** a rotatable piece locks the moment *every* pane
  its ray can possibly reach is already satisfied. This never traps the player (you only
  lose pieces you no longer need) and shrinks the free set toward zero.

## State model

```js
board = {
  w, h,                       // grid dims
  cells: [ { type, ... } ],   // 'empty'|'emitter'|'mirror'|'splitter'|'wall'|'pane'|'filter'
                              //   emitter:  { dir, color }
                              //   mirror:   { orient: '/'|'\\', locked }
                              //   splitter: { orient, locked }
                              //   pane:     { need: 'any'|color, lit: false, color: null }
  solvedOrient: Map(idx -> orient),  // for par + uniqueness, not shown to player
  par,
}
state = { board, moves: 0, started, finished }
```

The **light trace** is pure derived state, recomputed after every rotation:

```
trace(board):
  lit = {}                                  # cell -> set of (incoming colors)
  queue = emitters as (cell, dir, color)
  seen = set()                              # (cell, dir) cycle guard
  while queue:
    (c, dir, color) = queue.pop()
    while in-bounds and not wall:
      mark c lit with color
      piece = board.cellAt(c)
      if mirror:   dir = reflect(piece.orient, dir)
      if splitter: queue.push(c, reflect(...), color)   # branch; straight ray continues
      if filter:   color = piece.tint(color)
      if pane:     record arrival (color) ; (light continues past unless pane is opaque)
      advance c by dir; guard (c,dir) in seen
  resolve panes: lit + (color matches need) -> satisfied
  return { litCells, satisfiedPanes }
```

Trace is O(cells) per ray on a ≤9×9 grid — recompute every frame, no perf concern.

## Scoring

- **Par** = minimum rotations from the scrambled board to the (unique) solved board.
- Stars from moves over par, strike-style (mirrors Ladder's strikes→stars):
  - at par → ★★★, ≤ par+2 → ★★, ≤ par+4 → ★, else ☆. Tiebreak: solve time.
- First attempt per daily difficulty is leaderboard-eligible (same rule as Ladder).
- Many-small-completions juice: soft chime + pop on each pane lit; a resolved chord on the
  full solve; the panel "blooms" (light flood animation) on the winning move.

## Difficulty (daily Easy / Medium / Hard)

Three seeds per UTC day, one per tier — same "three-a-day" model as Mosaic/Ladder.

| Tier | Grid | Pieces | Goal | ~Par |
|---|---|---|---|---|
| **Easy** | 6×6 | mirrors, 1 emitter, 3–4 panes | light only | 4–6 |
| **Medium** | 7×7 | + splitters, 1–2 emitters, 5–6 panes | light only | 6–10 |
| **Hard** | 8–9 | + colour (filters, coloured panes, additive mix), beam cancel, rotatable splitters | colour-correct | 10–16 |

**Cascade tuning (the 20–70% rule):** aim for ~1 rotatable piece per 3–4 cells, and keep
beam paths long enough that each mirror sits on a path feeding ≥2 downstream cells. Then a
typical rotation re-lights ~⅓–½ of the active beam — dramatic but still traceable. Fewer
pieces → moves feel trivial; more / longer chains → players lose causality.

## Rendering

- **Canvas** (or SVG) over the grid. Light = glowing line segments from the trace.
- On each move: quick "flood" animation as new rays grow along their paths; satisfied panes
  crystallise (scale-pop + glow); locked optics get a subtle frosted overlay.
- **Tri-state cue convention** (arcade-wide): panes use `--good` (lit & correct),
  `--warn` (lit but wrong colour / partial), neutral (dark). A live counter
  `panes N/total` carries `is-under` / `is-match` styling.
- Colour-blind support (hard mode): pane targets carry a small glyph/letter for their
  colour, consistent with the arcade's colour-blind glyph convention.

## Tech & arcade integration

- Static **Vite**, `base: '/prism/'`, GitHub Pages — identical setup to Ladder.
- Reuse the shared lib verbatim: `arcade-leaderboard.js`, `arcade-leaderboard-ui.js`,
  `arcade-archive.js`, `arcade-results.js`, `arcade-card.js`, `arcade-share.js`,
  `arcade-util.js` (`mulberry32`, `escapeHtml`), plus shared `tokens.css` / `chrome.css`.
- **Daily seed:** `dailyPick()` by UTC date → board seed; Easy/Med/Hard are three offsets of
  the day, exactly like Ladder. Leaderboard board keys `YYYY-M-D|easy …` + a combined Total;
  metric = **moves** (fewer better), tiebreak solve time.
- **Archive** for replaying past days; **streak**; Wordle-style **share** (e.g. a tiny emoji
  grid of pane states, or `Prism 2026-06-27 — Hard solved in 12 (par 11) 🔆`).
- No build-time content file to validate (boards are generated), but ship a **generator
  self-check** in the spirit of `validate-boards.mjs`: for N seeds per tier assert
  (a) the recorded solved state actually lights all panes, and (b) par > 0. Wire into the
  build so a generator regression can't ship.

## What we are deliberately NOT doing (guardrails)

- No hidden randomness once a board is shown — every consequence is predictable.
- No charge-lens chain reactions outside hard mode (they break the legibility ceiling).
- No "harmony/vibe" win state — a pane is lit or it isn't; the solved state is well-defined
  and (ideally) unique. Correctness is observable, not aesthetic.

## Build order

1. Square-grid trace + mirrors + panes + tap-to-rotate, light-only. (This alone is a game.)
2. Generate-from-solved + par + Easy daily. Wire shared chrome + leaderboard.
3. Splitters + Medium; cascade tuning pass.
4. Colour layer + beam interactions + Hard.
5. Uniqueness enforcement (inevitability) + region-locking polish + bloom/chime juice.

## Stretch

- Region-lock "frost" as the core aesthetic payoff (the panel visibly crystallises shut).
- Endless/zen mode (no par, no leaderboard) for the ambient white-space we identified.
- Hex grid variant (prettier light, harder to trace — a deliberate expert mode).
