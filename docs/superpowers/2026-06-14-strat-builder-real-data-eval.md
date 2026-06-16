# Implicit stratigraphic 3D builder — shipped, and the real-data finding

- **Date:** 2026-06-14
- **Branch:** `feat-litho-3d-strat-field` (forked off `feat-litho-3d-watertight-loft`; UNPUSHED, off `develop`)
- **Spec:** `docs/superpowers/specs/2026-06-13-implicit-stratigraphic-3d-builder-design.md`
- **Plan:** `docs/superpowers/plans/2026-06-13-implicit-stratigraphic-3d-builder.md`

## What shipped

All 11 plan tasks (+ one inserted fix, Task 8.5) are implemented, each with
two-stage review (spec compliance + code quality) and the load-bearing
real-data-shaped-fixture discipline:

| Stage | Module | Status |
|---|---|---|
| 1 — stratigraphic order | `strat_field/stratigraphic_order.py` | ✓ topo-sort + cycle detection (`NonConformableError`) |
| 2 — control data | `strat_field/control_data.py` | ✓ tagged contact points + derived (down) orientations |
| 3 — potential field | `strat_field/potential_field.py` | ✓ cubic RBF, **coordinate-normalised** (Task 8.5), monotonicity-pinned |
| 4 — isosurfaces | `strat_field/iso_surface.py` | ✓ marching cubes, shared, clipped, pinch-terminating |
| 5 — body assembly | `strat_field/body_assembly.py` | ✓ **height-field prism, watertight by construction** |
| — orchestrator | `strat_field/strat_builder.py` | ✓ `build_strat_model` |
| 6 — invariants | `tests/.../strat_field/strat_invariants.py` | ✓ strict closed-manifold / no-overlap / section-column diff |
| — wiring | `application/assemble_strat_inputs.py` + `recompute_litho_solids.py` | ✓ strat path; loft retired |

The watertight claim was **independently verified** (an adversarial reviewer ran
an edge census on the lens + split-component bodies, re-ran no-overlap at 900
samples, and mutated a body to fabricate a loft-class overlap to confirm the
section-column diff fires). On conformable interbedded/dipping/pinch fixtures the
model tiles with zero overlaps by construction. The loft wedge-mesher is retired.

**Bench (synthetic, ~620×609 m footprint, 7 holes):** coarse 5 m ≈ 1.5 s,
medium 2 m ≈ 11 s, fine 1 m ≈ 52 s. Grid spacing is the throughput knob; the
Python node/cell loops in `body_assembly` are the hot path (vectorisable later).

## The real-data finding (the make-or-break)

Rebuilding the real `test.strix` litho model (dev DB, model
`019e934c-70fd-7d11-a44a-b2073f4063a2`: 418 accepted layers, 58 investigations,
401 approved correlations, 102 resolver bodies, 4 lithologies) via
`scripts/eval_strat_builder.py`:

> **The model is NON-CONFORMABLE.** Stage 1's topological sort of the 102-instance
> order hits a directed cycle, so the v1 builder correctly flags all 102 bodies
> and builds **zero** real solids. This is the documented v1 limitation — and the
> builder behaved exactly per spec: it **detected and reported** the cycle rather
> than silently mis-ordering (the loft's exact sin).

`scripts/eval_strat_cycles.py` quantifies it — **it is localized, not pervasive**:

- 102 instances, 137 precedence edges. **94 instances form a clean DAG.**
- **2 small cycles** (strongly-connected components of size 5 and 3) = **8
  instances** trapped, in **SILT↔ZAND** interbedding (+ one related formation).
- 5 bidirectional contradictions (instance A directly above instance B in some
  columns, below it in others).

So the implicit single-field approach builds the *vast majority* of the model
cleanly; a handful of interfingering SILT/ZAND bodies create local cycles that no
single global stratigraphic order can satisfy.

## Why this happens (the conceptual gap)

The spec promised "interbedding is free" — and it is, for interbedding *within*
one conformable column (ZAND/SILT/ZAND/SILT = four distinct, consistently-ordered
horizons). The cycles come from the **correlation model**: the strat order's
nodes are resolver `body_id`s (connected components of correlated layers). When
two correlated bodies — a SILT body and a ZAND body — sit in the opposite
vertical order in different columns (real lateral interfingering, or an
over-eager correlation), the global instance order cycles. A single scalar field
`F(x,y,z)` requires ONE global ordering of its iso-values, which a true
interfingering pair cannot have.

## The decision the owner needs to make

The rewrite is complete and correct; the question is how to model the 8
interfingering instances. Three options, owner's call:

1. **Correlation cleanup.** Examine the 8 cycle instances (the diagnostic prints
   the exact `body_id`s + formation pairs). If a few correlations over-eagerly
   merged distinct layers into contradictory bodies, fixing those correlations
   makes the model conformable and it builds. Cheapest if the cycles are data
   errors rather than genuine geology.
2. **Per-block / lens treatment** (the spec's designed-but-stubbed seam). Treat
   the cycling pair as an interfingering lens / a separate block: split the domain
   so each block has a conformable order, fit per block, stitch. This is the
   "genuine interfingering" path and reuses the litho-stage lens/body machinery
   conceptually. Larger effort; it is the principled answer if the interfingering
   is real.
3. **Targeted relaxation.** When two instances cycle, merge them (or pick a
   canonical order and let the smooth field absorb the contradiction). Builds
   immediately, loses fidelity on the interfingering — a stopgap.

This is a fundamental modelling decision (how interfingering is represented), not
a bug fix — exactly the kind of "establish the frame with the owner before
building" call the project's own lessons-learned insists on. **It is NOT merged to
`develop`; the branch waits on this decision.**

## Dev-DB state after the eval (note)

The eval set the project's `view_state.litho_segmenter.strat_grid_spacing_m` to
2.0 m (a reasonable default; 1 m is ~5× slower) and the model's 102
`litho_body_solid` rows are now **flagged-empty** (the build's own
non-conformable output — the loft rows were overwritten). So opening `test.strix`
in the app today shows an empty 3D model with a "non-conformable — these contacts
conflict" flag, which is the correct v1 behaviour until the interbedding decision
is made.

## Re-run the diagnostics

```
uv run python scripts/eval_strat_builder.py            # full rebuild + section-column diff
uv run python scripts/eval_strat_cycles.py             # cycle-density / SCC structure
```
