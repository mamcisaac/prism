# Prism — Design

> Rotate the optics until light blooms through every pane.
> Part of the [Connect the Thoughts](https://connectthethoughts.ca/) arcade.

## Concept

A dark stained-glass panel. A single beam of **white light** enters from one edge, strikes
a triangular **prism**, and **disperses** — red, green and blue fan out in three directions.
Scattered across the panel are **mirrors and prisms** you can rotate. **One verb — tap a
piece to rotate it** — and the *entire* downstream light re-routes: it bends, splits, and
floods new cells. The goal is legible at a glance: **route each colour to the pane that
wants it.** Colours recombine, too — cross beams at a pane for a secondary, or feed all
three primaries back through a reversed prism to rebuild white.

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

Colour is the game at **every** tier. Easy stays legible because every pane wants a plain
primary (the prism has already done the splitting for you); the mixing puzzles — secondaries
at a crossing, white through a reversed prism — arrive on Medium and Hard.

## Round

- A grid (6×6 → 8×8). Rays travel orthogonally (N/E/S/W).
- Exactly **one white emitter** on the border fires a beam inward, aimed at a **prism**.
- Some cells hold **rotatable mirrors/splitters/prisms** (the player's pieces); others hold
  fixed **walls** or **panes** (targets, each stamped with the colour it needs).
- Player taps a piece to rotate it (mirrors/splitters toggle `/`↔`\`; prisms cycle
  N→E→S→W). The light re-traces instantly; newly satisfied panes pop and chime; the
  now-determined optics feeding them **lock**.
- Solved when **every pane receives exactly its target colour** (OR of arriving beams).
- No timer, free unlimited rotations, free reset. Scored on **moves vs. par** (see Scoring).

## Pieces

| Piece | Fixed/rotatable | Behaviour |
|---|---|---|
| **Emitter** | fixed (border) | Emits one ray inward. Always **white** (7); exactly one per board. |
| **Mirror** | **rotatable** (2 states `/` `\`) | 45° mirror. Reflects all colours 90°. |
| **Splitter** | rotatable (2 states) | Half-silvered: passes the ray straight **and** reflects a 90° branch — same colour both ways. |
| **Prism** | rotatable (**4 states** N/E/S/W) | The heart of the game — disperses and recombines light (see below). |
| **Wall** | fixed | Blocks light. Pure constraint/decoration. |
| **Pane** | fixed (target) | Satisfied when the OR of arriving colours **equals its `need` exactly**. Transparent to light. Glows when satisfied. |
| **Socket** (Hard) | fixed mount, **placeable** contents | An empty mount (transparent) that accepts a pre-cut piece from the **tray**. Occupied, it behaves exactly as the held piece; the held orientation never changes. |

Retired: **filters** and **coloured emitters**. The engine still traces filters for safety,
but the generator never places them — dispersion carries all colour play now.

**Mirror reflection table** (the first rule the player internalises):
- `/` : E→N, N→E, W→S, S→W
- `\` : E→S, S→E, W→N, N→W

**Prism rule** (the second — and last — rule). A prism's `orient` is the direction its
**apex** points; its **base** faces light travelling that way.

- **Split (base entry):** a beam travelling `orient` enters the base and disperses per
  primary component: **R exits 90° left, G exits straight, B exits 90° right**. White in →
  the signature three-way RGB fan. Yellow in → red left + green straight.
- **Recombine (fan-port entry, i.e. the prism run in reverse):** a beam arriving along one
  of the three fan directions passes only that port's primary (others are absorbed) and
  exits out the **base**, reversed. Send R, G and B back into the fan ports and three
  primaries leave along one line — a pane there ORs them to **white**. Recombination is
  emergent; no special-case rule.

Those two tables are the entire "predict what happens" surface. Everything else is
composition of them.

### Beam interactions (the signature — kept traceable)

- **Additive mix at a pane:** a pane hit by a red beam *and* a green beam reads as yellow.
  Traceable because the player sees both beams terminate on one visible pane.
- **Recombination through a prism:** feed primaries into a reversed prism's fan ports and
  they exit the base along a single line. Traceable — the pieces sit in plain sight and
  each incoming ray is drawn.
- Beams do **not** interact in empty cells — crossings just cross. Mixing happens only at a
  pane (OR) or inside a prism.

## Generation — guaranteed solvable (the crux)

Boards are **built backwards from a solved state**, the same philosophy as Ladder's
generate-then-validate and Switchback's unique path. Solvability is therefore guaranteed by
construction, never by luck.

```
buildBoard(seed, difficulty):
  rng = mulberry32(seed)                       # seed = daily date hash + difficulty offset
  grid = empty(size[difficulty])
  place ONE white emitter on the border (rng)
  place prism #1 a few cells ahead ON the emitter's beam line, nothing between
    # so the opening image — white beam → prism → RGB fan — exists in the solved state

  # 1. GROW A SOLVED LIGHT NETWORK
  scatter mirrors / splitters / (hard: a 2nd prism) in solved orientations
  trace(); derive PANES from lit empty cells, `need` = the OR'd colour that
    actually arrives there (panes are transparent, so adding one never changes
    the trace); bias picks to hit the tier's colour-mix quota

  # 2. DECORATE
  demote never-matters pieces to FIXED decor (they'd be free degrees of freedom)

  # 3. (ELEGANCE) ENFORCE UNIQUENESS  -> this is what creates "inevitability"
  greedily add constraining panes while solutionCount > 1 (countSolutions, capped)

  # 4. SCRAMBLE
  rotateOnce() each rotatable piece a random number of times
  par = Σ tapDistance(scrambled_i → solved_i)   # the daily "beat par" target
  reject if the scrambled board is already solved

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
  cells: [ { type, ... } ],   // 'empty'|'emitter'|'mirror'|'splitter'|'prism'|'wall'|'pane'
                              //   emitter:  { dir, color: 7 }          // always white
                              //   mirror:   { orient: '/'|'\\', fixed? }
                              //   splitter: { orient: '/'|'\\', fixed? }
                              //   prism:    { orient: 'N'|'E'|'S'|'W', fixed? }
                              //   pane:     { need: <RGB mask> }       // exact-match target
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
      if prism:    base entry -> queue R left / G straight / B right (per component), ray ends
                   fan-port entry -> pass that port's primary only, exit base reversed
      if pane:     record arrival (OR color) ; light continues past (panes are transparent)
      advance c by dir; guard (c,dir,color) in seen     # prism loops must terminate
  resolve panes: OR(arrivals) === need -> satisfied
  return { litCells, satisfiedPanes }
```

Trace is O(cells) per ray on a ≤9×9 grid — recompute every frame, no perf concern.

## Scoring

- **Par** = minimum taps from the scrambled board to the (unique) solved board
  (`Σ tapDistance` — mirrors count 0/1, prisms 0–3).
- Ranked on **moves over par** (fewer better), solve time as the tiebreak — the arcade-wide
  raw-metric convention (no stars).
- First attempt per daily difficulty is leaderboard-eligible (same rule as Ladder).
- Many-small-completions juice: soft chime + pop on each pane lit; a resolved chord on the
  full solve; the panel "blooms" (light flood animation) on the winning move.

## Difficulty (daily Easy / Medium / Hard)

Three seeds per day, one per tier — same "three-a-day" model as Mosaic/Ladder. Every tier
has exactly one white emitter and at least one prism; every pane has a colour `need`.

| Tier | Grid | Contents | Panes |
|---|---|---|---|
| **Easy** | 6×6 | 1 **fixed** prism directly on the emitter's sight line (the RGB fan is visible at load), ~5–6 rotatable mirrors | 3 — one per primary (R, G, B) |
| **Medium** | 7×7 | prism **rotatable** (scrambled), ~8 mirrors, 0–1 splitter | 4–5, ≥1 secondary (Y/M/C) — two beams crossing at the pane |
| **Hard** | 8×8 | 2 prisms (the second may act as a recombiner), ~10–12 mirrors, 1–2 splitters, **sockets + a 2–3 piece tray** | 5–6, ≥1 secondary or white pane |

### Sockets & tray (Hard)

Hard adds a placement layer: 2–3 load-bearing pieces are **lifted out** of the solved
board into a **tray** of pre-cut optics (fixed, visible orientation — the player decides
WHERE, never how it's turned), and their cells become **sockets** (dashed square mounts,
transparent while empty). 1–3 **decoy sockets** sit off the solved beam paths. Tap a tray
piece, tap an empty socket → mounted, **1 move**; tap a mounted piece → lifted back,
**free** (a misplacement only costs the eventual re-placement). Prism #1 — the emitter's
sight-line prism — is never lifted, so the opening white→fan image survives.
`par = rotation tap-distances + placements`; uniqueness is checked over placements ×
orientations (`countPlacements`); load-bearing mounted pieces frost like rotatables.
Easy/Medium have no sockets and no tray.

**Cascade tuning (the 20–70% rule):** aim for ~1 rotatable piece per 3–4 cells, and keep
beam paths long enough that each mirror sits on a path feeding ≥2 downstream cells. Then a
typical rotation re-lights ~⅓–½ of the active beam — dramatic but still traceable. Fewer
pieces → moves feel trivial; more / longer chains → players lose causality.

## Rendering

- **Canvas** over the grid. Light = glowing line segments from the trace, additive
  (`lighter`) compositing. Segments sharing a grid edge are **merged (OR of colour masks)
  and drawn once**, so recombined light renders as its true blend — three primaries on one
  line glow white, not three stacked strokes.
- **Dark-start readability** (a hard requirement): the board is fully legible with zero
  light. Unlit optics use full-strength strokes (no ghosting); every pane is a diamond
  outline **tinted with its `need` colour** plus its letter glyph, so the target is visible
  before light arrives; the emitter sits in a housing with a muzzle marking its fire
  direction; the faint cell grid stays.
- **Prism glyph:** a glassy triangle — apex points toward `orient` (the straight/green
  exit), base faces the incoming light. When a beam enters the base, a tiny internal
  **rainbow fan** previews the R/G/B dispersion (the "aha" cue). Orientation must be
  readable at a glance; a tap visibly spins it.
- **Splitter vs mirror:** a mirror is one bold diagonal; a splitter is **twin rails with a
  centre bead** (half-silvered), so pass-through light never reads as light penetrating a
  solid mirror.
- **Sockets (Hard):** a dashed square mount outline — clearly "something goes here" and
  clearly not a pane (diamonds). Empty mounts brighten while a tray piece is selected;
  mounted pieces draw exactly like their bare counterparts (one shared glyph code path,
  reused by the tray's mini-canvas slots).
- On each move: satisfied panes crystallise (scale-pop + glow + bloom pulse + chime);
  locked optics get a subtle frosted overlay.
- **Tri-state cue convention** (arcade-wide): panes use their tint (dark), `--warn` (lit
  but wrong colour), full glow (correct). A live counter `panes N/total` carries
  `is-under` / `is-match` styling.
- Colour-blind support: every pane carries its colour letter (R/G/B/Y/M/C/W) at all times,
  consistent with the arcade's colour-blind glyph convention.

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
- No chain-reaction pieces (charge lenses etc.) in the core game — they break the
  legibility ceiling. Anything of that shape lives in Stretch until proven traceable.
- No "harmony/vibe" win state — a pane is lit or it isn't; the solved state is well-defined
  and (ideally) unique. Correctness is observable, not aesthetic.

## Build order

1. Square-grid trace + mirrors + panes + tap-to-rotate, light-only. (This alone is a game.)
2. Generate-from-solved + par + Easy daily. Wire shared chrome + leaderboard.
3. Splitters + Medium; cascade tuning pass.
4. Colour layer + beam interactions + Hard.
5. Uniqueness enforcement (inevitability) + region-locking polish + bloom/chime juice.

## Stretch

- **Grating** (future piece): splits a beam into parallel offset copies of the same colour —
  a geometry multiplier rather than a colour one.
- **Lens** (future piece): merges the beams crossing it onto one line (a movable
  recombiner, complementing the reversed prism).
- Region-lock "frost" as the core aesthetic payoff (the panel visibly crystallises shut).
- Endless/zen mode (no par, no leaderboard) for the ambient white-space we identified.
- Hex grid variant (prettier light, harder to trace — a deliberate expert mode).
