# Body Model — current design

> Current state only. The full body-with-extent refactor history (2026-05-31,
> ~50 commits, 8 slices), the lens-entity era, and the R1 suggestion rule are
> retired — git history of CLAUDE.md pre-2026-07-12 has the archaeology.

## What a body is

* A **body** = a resolver connected-component over TWO edge kinds unioned
  together: approved layer↔layer `LithoContactCorrelationEdge`s AND
  `body_geometry_fact` rows (owner ruling 2026-08-12: *"every same litho that
  is connected should get the same body id"*). The resolver stamps
  `litho_layer.body_id` on every member. Applies to litho AND geotech models
  (packing bodies drive qc/sample-per-body extraction).
* A **geometry fact** is an observed geometric adjacency between two
  same-unit layers, read off the partition fill (tie-born band/onlap/lens
  regions only — fallback paint NEVER defines identity) per section, plus
  cross-section at shared columns and fence crossings (the stage-2 rule in
  `merge_bodies_across_sections.py`). Facts exist because a tie is overloaded:
  it defines the 2/1/0 fill geometry AND body membership, so "same body,
  different boundary drawing" (the owner's silt-onlap case) needs its own
  record. Facts draw NOTHING — the fill never reads them, so persisting a
  merge can never redraw a section.
* Facts are written ONLY by `RecomputeBodies`
  (`POST .../bodies/recompute`): advisory-locked wholesale replace per model
  from the frontend's partition evidence, empty payloads refused (never a
  wipe), then the resolver re-stamps and a layer-stamp diff
  (merged/split/renamed counts) returns for the toast. The frontend fires it
  debounced in the background after tie/layer edits and on demand. Facts
  ride the bundle (save/restore/Save As), restore before the post-restore
  reconcile, and cascade with their layers.
* **Deliberate asymmetry**: the voxel BUILD's own alias pass still unions
  through fallback regions for blending; the PERSISTED identity does not.
  Two bodies connected only through fallback paint render welded but stay
  two bodies in the data — the owner's "no fallbacks in a properly built
  model" ruling accepts this.
* **User state follows the body, not the row** (lineage adoption): the
  `(formation, ordinal)` key recycles `BodyOrm` rows on renumbering, so on
  every resolve the surviving component adopts name (oldest name wins —
  owner ruling), display colour, primary section, and the hand-drawn
  boundary shape from the previous bodies of its member layers. A displaced
  name is reported in the diff.
* `ResolveLithoInstances` runs inline on every correlation-mutating use case
  (correlate / uncorrelate / accept / delete contact / delete layer /
  cross-merge update) to keep instance ordinals coherent — persisted facts
  ride every one of those runs, so a tie edit cannot revert a geometric
  merge; stale facts self-heal at the next recompute.
* **One body = one litho unit** (owner ruling 2026-10-03, verbatim: *"a zand
  and zand/matig siltig are 2 different lithologies, never weld those"*). A
  band of unit X and a band of unit Y never share a body, whatever their main
  soil family: the contact between ZAND and ZAND (SL:M) is a body boundary like
  ZAND / KLEI. The resolver's `same_mass` compares the litho UNIT (a litho
  layer's own formation row; a geotech band's `source_litho_formation_id`)
  before soil and class, so a tie or a geometry fact across two units is kept
  (it states a shared surface — a packing tie across two units is flagged
  `frame_mismatch` at draw time) but never joins bodies. Ordinals are numbered
  per unit (`_mass_unit_key`): ZAND bodies #0.., ZAND (SL:M) bodies #0..; a
  geotech body numbers within its litho unit + NAD class. The fill's class key
  (`packingClassOf.ts` / `packing_class_key.py`, `UNIT|SOIL|CLASS`) carries the
  unit, so the render, the voxel paint and the fence stop at the same boundary.
  Pooling two units is the user's **Join** (a GROUP, never a merge;
  `same_join_class` = same soil + class is its write guard). The Parameters
  tree lists a body under its home unit only.
* `body_id` is **identity, not shape** — it over-lumps heterogeneous packages,
  so the fill engine matches on real edges, never on `body_id`
  (see [section-fill.md](section-fill.md)).

## Body shape — single source of truth

The **partition fill** (`utils/partitionEngineSelect.computeSectionFillActive` →
`partitionFillV2/computeSectionFillV2` + `PartitionFillOverlay` + freedraw `body_boundary_nodes`
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

* **Lens detection runs inside the reconcile; there is no hand-run verb**
  (owner ruling 2026-09-05). Lenses flow out of the 2/1/0 partition fill, so
  the backend detector needs no button: it fires automatically inside the
  correlation-mutating transactions (the ordinal resolver + lens detector run
  in `contact_correlations.py` after an accept/flip) and in the startup sweep.
  `POST .../geology/models/{mid}/lenses/detect` survives as that reconcile's
  routine — the 3-D build depends on the body rows it maintains — but nothing
  in the UI drives it. The toolbar "Detect lenses" / "Delete all detected
  lenses" verbs were retired 2026-06-06.
* **Auto-correlate ranks by admixture, never gates on it** (owner ruling
  2026-09-06). Contact-level auto-correlate (`auto_correlate_contact_edges`)
  groups candidate ties by main soil code, then, within one adjacent
  column-pair, ranks competing candidates by depth residual PLUS a penalty
  (`ADMIXTURE_MISMATCH_PENALTY_M`, half the base depth window) when the two
  units' admixtures mismatch. Sets are compared order-independently on the
  `Admixture.canonical_key()` tokens; empty vs non-empty is a mismatch, empty
  vs empty is not. So a matching admixture ranks above a mismatching one at the
  same depth, but the penalty touches ranking / mutual-nearest-neighbour only:
  the depth-window admission test stays on the RAW residual, so a mismatch
  never turns a candidate inside the window into no candidate. The candidate
  carries an additive `admixture_match` flag for a future UI badge.
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
