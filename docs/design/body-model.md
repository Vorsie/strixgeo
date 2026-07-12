# Body Model — current design

> Current state only. The full body-with-extent refactor history (2026-05-31,
> ~50 commits, 8 slices), the lens-entity era, and the R1 suggestion rule are
> retired — git history of CLAUDE.md pre-2026-07-12 has the archaeology.

## What a body is

* A **body** = a resolver connected-component of approved layer↔layer
  `LithoContactCorrelationEdge`s (each links two `litho_layer.id`). The
  resolver stamps `litho_layer.body_id` on every member.
* `ResolveLithoInstances` runs inline on every correlation-mutating use case
  (correlate / uncorrelate / accept / delete contact / delete layer /
  cross-merge update) to keep instance ordinals coherent.
* `body_id` is **identity, not shape** — it over-lumps heterogeneous packages,
  so the fill engine matches on real edges, never on `body_id`
  (see [section-fill.md](section-fill.md)).

## Body shape — single source of truth

The **partition fill** (`utils/partitionFill.computePartitionFill` /
`computeSectionFill` + `PartitionFillOverlay` + freedraw `body_boundary_nodes`
via `SaveBodyBoundary`) derives bands + pinch-outs + lenses purely from
aligning adjacent column unit-stacks. It is the single source of truth for
body shape (owner directive 2026-06-06).

## Body-extent system RETIRED 2026-06-06

The `to_target` / extent-kind / `DetectBodies` / `SuggestBodyPinchOuts` /
`ClaimBodyExtent` / `BodyExtentOverlay` system is deleted (endpoints, schemas,
verbs, the 10 `body.extent_*` columns + 4 constraints + `extent_kind` enum —
drop migration `d8868bb27884`). `detect_body_extents` was stripped to its 3
shared contact-stack dataclasses (kept for `auto_correlate` /
`detect_crossing_pinch_outs`).

**KEPT:** the resolver (`body_id` membership), correlation edges,
`BodyContextMenu` Dissolve/Name, "Materialise companions".

**Legacy compatibility:** old `.strix` bundles with stale `extent_*` keys still
restore (unknown-key filter).

Spec: `docs/superpowers/specs/2026-06-06-body-extent-retirement-design.md`;
plan: `docs/superpowers/plans/2026-06-06-body-extent-retirement.md`.

## Behavioral rules that survived the refactors

* **Lens detection is an EXPLICIT verb** (owner directive 2026-05-31): no use
  case auto-fires `DetectLithoLenses`. `POST
  .../geology/models/{mid}/lenses/detect` + the toolbar "Detect lenses" verb
  are the only triggers. "No side-effects beyond the gesture."
* **Bilateral closure required**: a candidate body must pinch out on ≥2
  distinct target investigations to fire as a lens; a unilateral single-target
  closure is not a lens.
* **Preserve-named guard**: reconcile/sweep steps never remove a body/lens row
  with a non-null `name` — user-named rows are intentional and only removable
  via explicit DELETE.
* **Startup sweep**: the FastAPI lifespan hook reconciles stale rows per model
  (each model commits independently; failures log a warning, never block
  startup) so legacy bundles self-clean on open — including the
  open-without-restore path.
* **Concurrent boundary saves are serialised** with
  `pg_advisory_xact_lock(hashtext(model_id || ':' || content_key))` at the top
  of `SaveBodyBoundary.execute` (the shape editor fires PUTs ~1 ms apart while
  dragging; without the lock two transactions raced the delete+insert).
* **Degeneracy guard**: `max_lens_thickness_m`
  (`view_state.litho_segmenter.max_lens_thickness_m`, 0 = off, default 5 m,
  Settings → Litho segmenter) rejects near-whole-column spurious lenses.

## Tier-D export note (load-bearing for the Phase-4 export step, debt #104)

The partition geometry lives **only in client-side TS** — a 2D/3D exporter must
either port `computePartitionFill` to a Python domain service OR export
client-side. The raw inputs (layers, `body_id`, correlations,
`body_boundary_nodes`) fully reconstruct the geometry, so nothing is
foreclosed.
