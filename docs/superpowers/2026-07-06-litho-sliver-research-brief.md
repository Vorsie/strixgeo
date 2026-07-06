# Research Brief — Litho Fill-Bands Sliver Overlaps (debt #228) — 2026-07-06

**For a fresh research session, running IN PARALLEL with the geotech
implementation session** (docs/superpowers/2026-07-06-geotech-fraction-refinement-handoff.md).
**You OWN `desktop/src/renderer/src/utils/partitionFill.ts`** — the other
session must not touch it; you must not touch its new geotech files. Work in a
**git worktree on a fresh branch** (memory:
`feedback_concurrent_agent_shared_worktree`). DO NOT push. The dev app may be
running on :8765 and a throwaway http.server on :8801 — touch neither.

## The finding (proven on real CS1, 2026-07-06)

`computeSectionFill`'s RAW output — the production **Fill-bands render** on the
litho axis AND the input to the 3D voxel labelling — contains hairline
**overlaps between non-lens regions** on dense interbedded stacks. Proven by a
polygon-overlap detector with blame attribution during the geotech brainstorm:

- CS1 gap 0 (between `GEO-22/115-S10` and the next column — the finely
  interbedded thin sand/clay/silt stack): `raw@quad × raw@quad` overlaps,
  e.g. SILT×ZAND at elev ≈ +5.9, ZAND×KLEI at ≈ +5.0, ZAND×SILT at ≈ +1.2
  (preview screen x≈121) — each ~2 of 25 grid-sample hits = hairline slivers.
- Invisible on the litho axis (adjacent litho colours near-identical at
  hairline widths); ANY differing colouring amplifies them instantly.
- The CS1 gate (`partitionFill.cs1void.test.ts`, `CS1_GATE=1`) did NOT catch
  them — its sampling is coarser than the sliver width. Classic
  "the real-data gate must assert the invariant at the resolution the
  invariant breaks" (docs/lessons-learned.md #4).

## Reproduce (10 minutes)

1. Inputs (regenerate if stale, read-only dev-DB `groundmodel` :5433 via
   `docker exec strix-db-1 psql …`):
   `uv run python scripts/throwaway_cs1_partition_extract.py` and
   `uv run python scripts/throwaway_geotech_brainstorm_extract.py`.
2. `cd desktop` then
   `GEOTECH_BRAINSTORM=1 npx vitest run src/renderer/src/utils/partitionFill.geotechBrainstorm.test.ts`
   (PowerShell: set env var separately). Untracked file — do not delete.
3. Read `scripts/throwaway_carve_overlaps.txt`: the `raw@…` lines are the
   ENGINE's own polygons overlapping (ignore non-raw lines — those are the
   geotech prototype's, other session's business). The detector code (grid
   point-in-poly sampling, blame tags) is at the bottom of `carvePanel` in
   that test file — reuse/extract it.

## The task

1. **Build the invariant first**: a dense overlap check over `computeSectionFill`
   output — rasterised sampling at sliver resolution or exact polygon
   intersection (non-lens regions pairwise, per gap; `kind==='lens'` +
   `overlayTier` regions are by-design overlays). Add it to the unit suite on a
   frozen CS1 fixture AND to the CS1 gate. Watch it go RED on current code
   (lesson #6: a regression test must fail on the old behaviour).
2. **Root-cause** in the engine: gap 0's dense interbed stack exercises
   `emitGap` / `emitInterval` / pinch-pair interval sharing /
   `carveOverlays` / the deep-substrate clip. Suspects: interval arithmetic at
   near-coincident contact depths (mm-rounding), pinch pairs "cut at the
   meeting fraction" leaving ε-overlaps, carry-through polygons vs their
   interval mates. Instrument, don't guess (memory:
   `feedback_no_guessing_instrument_first`); full UUIDs in diagnostics.
3. **Fix** so raw non-lens regions are pairwise disjoint on CS1 + the synthetic
   suite, with NO visual regression on the litho axis (the CS1 gate's existing
   assertions must stay green; eyeball the fill-bands render before/after —
   `partitionFill.cs1render.test.ts`, `CS1_RENDER=1`, is the faithful render
   harness).
4. Also check the SUBSTRATE: earlier detector runs showed same-colour
   substrate-strip overlaps at coincident cluster columns (engine emits
   per-column quads whose strips overlap when columns are closer than a strip
   width) — decide fix vs document.

Owner's bar: **perfection, not 95%** — a partition must be a partition.
Commit per-file, `--no-verify`, Conventional Commits, DO NOT push. Integration
tests only via `.\scripts\run-integration-tests.ps1` (read stdout).
