# Prism

Rotate the optics until light blooms through every pane.

A daily light-routing puzzle: a beam enters a stained-glass panel; tap a mirror to
flip it between `/` and `\` and the whole beam re-routes. Light every pane to win.
Easy / Medium / Hard each day; Hard adds colour (mix beams to hit a pane's exact
hue). Every puzzle has exactly one solution — beat **par** for ★★★.

**Play it:** [mamcisaac.github.io/prism](https://mamcisaac.github.io/prism/)
Part of the [Connect the Thoughts](https://connectthethoughts.ca/) arcade.

## Design

See [DESIGN.md](DESIGN.md). Boards are generated **backwards from a solved state**,
so solvability is guaranteed by construction; extra panes are added to force a
unique solution. `npm run build` runs `scripts/selfcheck.mjs`, which verifies every
generated board is solvable, a real puzzle, and reports uniqueness.

## Develop

```
npm install
npm run dev        # local dev server
npm run selfcheck  # generator invariants
npm run build      # selfcheck + production bundle
```
