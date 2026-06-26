# Geotech packing-density BODY model — design

**Date:** 2026-06-26
**Status:** design (brainstormed with owner; pending agent review + owner approval)
**Supersedes:** the per-CPT carve render (`subdivideRegionsByGeotech` + the
2026-06-26 carve/borehole-projection/sliver-cull commits). Those are **retired**
by this design — see §9.

---

## 1. Problem

The geotech stage subdivides each litho unit into NAD packing classes. The current
render (`subdivideRegionsByGeotech`) takes the raw per-CPT packing bands and
reconciles them **geometrically** per section gap. On real data this shatters: a
diagnostic on the owner's dogfeed section produced **459 regions, 130 of them
sub-resolution slivers** (degenerate zero-height polygons, tiny lens overlays,
thin spikes). Solid-rendering, sliver-culling, and coarsening are all band-aids on
a structurally wrong unit.

The deeper issue, surfaced by the owner: **the packing band is not a render detail —
it is the analytical backbone.** It is

1. what a **lab test** is assigned to (lab samples come from boreholes), and
2. what **CPT data** is grouped by for parameter analytics (φ′/Dr/stiffness
   populations, p-q regressions, grain-size comparisons).

A fragmented render means fragmented *data*: a lab test falls on a sliver seam, and
"group CPT by packing body" returns 459 noise-bodies. The unit has to be right
because three consumers depend on it: render, lab containment, CPT analytics.

## 2. The decision (owner, 2026-06-26)

A **geotech packing body is a litho body one level down** — a connected,
single-NAD-class spatial region *within* a single litho unit — built by the **same
pipeline** as a litho body, just subdivided by packing class. Specifically:

- **Connected same-class bodies** (granularity): a litho unit splits into a few
  connected packing bodies (e.g. medium-dense / dense), joined across tests — not
  one-class-per-unit (too coarse) and not the raw per-CPT carve (fragmented).
- **True 3D entities**: a body spans the model in 3D; a section is a *slice*
  through it. This is required for analytics grouping across the whole model.
- **Non-smoothed**: the raw per-CPT packing (including meter-scale matig/dicht
  oscillation) is kept verbatim. Some users want that detail. Cleanup is the
  engineer's job, not an auto-smoother.
- **Manual curation, litho-style**: after the auto pass, the user **merges**
  adjacent bodies (collapse an oscillation into one unit), **drops** thin slivers,
  and **draws/deletes correlations** — the exact litho-stage editing gestures.

## 3. Architecture — reuse the litho pipeline end-to-end

| Layer | What it is | Reuses |
|---|---|---|
| **Entity** | Packing body = single-NAD-class connected region inside one litho unit; 3D. | litho `BodyOrm` / `litho_layer.body_id` on the geotech model |
| **Inputs / inheritance** | On geotech build, inherit the litho model wholesale — layers, **correlations**, bodies. CPT packing bands (raw) subdivide each litho unit. | geotech build (`SubdivideAllBodies`) + litho-correlation copy |
| **Connectivity (auto)** | Within each litho-correlated body, same-class packing bands tie across the tie → resolver → geotech `body_id`. | `LithoContactCorrelationEdge` + `ResolveLithoInstances` |
| **Boreholes** | Pass 1: excluded from formation. Pass 2: divided geometrically by the bodies, clipped to the borehole's litho frame. | voxel label (3D) / body-surface interpolation (2D) |
| **2D render** | The connected-body **partition** (`computeSectionFill` on geotech layers + geotech edges), clean *by connectivity*. | `computeSectionFill` (the litho partition engine) |
| **3D** | Voxel builder labels space by geotech `body_id`. On-demand "Build". | the litho voxel builder |
| **Curation** | Litho editing gestures on the geotech model — merge / drop / correlate. | existing litho gestures |
| **Analytics** | Lab + CPT group by geotech `body_id` via spatial containment. | `parameter_group` (Slice 3) |

**The load-bearing reframe:** the geotech render is **not** a special 2D carve of
the litho partition. It is the **body partition of the geotech model itself** —
the identical machinery litho uses for its bodies. The carve was a detour that
reconciled per-CPT geometry instead of rendering connected bodies.

## 4. Inputs & litho inheritance

On entering / building the geotech stage, the geotech model inherits the litho
model so the engineer does not redo work:

- **Litho frame**: each litho unit's geometry bounds the packing bands (a packing
  body can never cross a litho boundary — enforced because the geotech
  `litho_layer` rows are already geo/litho-bounded by `SubdivideAllBodies`).
- **Litho correlations are copied as the connectivity framework.** Every litho
  correlation edge ("litho body L is the same unit across tests A and B") is the
  scaffold on which packing connectivity is built (§5). The owner's existing litho
  correlations therefore **seed packing connectivity for free**.
- **CPT packing bands**: the raw qc-derived NAD segmentation per CPT (non-smoothed,
  the existing `SubdivideAllBodies` per-CPT output). One `litho_layer` per band.

## 5. Connectivity (auto) — the piece that was missing

The earlier body-partition attempt produced **187 singletons (79%)** because the
geotech edges were sparse (full-NAD-sequence-match only). The fix is to drive
connectivity off the **inherited litho correlations + same class**:

> For each litho correlation edge linking litho body `L` across tests `A` and `B`:
> for each packing band `g_A ⊂ L` on `A` and `g_B ⊂ L` on `B` with
> `g_A.nad_class == g_B.nad_class` and overlapping depth within `L`, emit a geotech
> correlation edge `g_A ↔ g_B`.

This replaces the strict full-sequence rule. It connects a matig band on S6 to the
matig band on S13 *within the same correlated sand body*, even when the full band
sequences differ (S6 has an extra silt interbed). Resolver → geotech `body_id`.

**Manual ties** add packing-specific correlations the auto pass missed — the
existing "Correlate packing" gesture, pointed at the geotech model.

The same-class key is correct here: we *want* different packing classes to stay
separate bodies (loose vs dense are different parameter populations); the engineer
merges them manually if they judge it one unit.

## 6. Boreholes — two-pass geometric division

Boreholes have no qc, so they have no measured packing. The owner's model:

1. **Pass 1 — form bodies from CPTs only.** Boreholes contribute nothing to body
   formation. (Change from today, where `SubdivideAllBodies` extrapolates a
   nearest-CPT class onto boreholes — that extrapolation is removed.)
2. **Pass 2 — the bodies divide the boreholes geometrically.** Within each litho
   unit at a borehole, the connected bodies' surfaces (interpolated between the
   CPTs that define them) slice the borehole's depth; each slice inherits the
   dividing body's `body_id` + NAD class, **clipped to the borehole's own litho
   frame**. In 3D this is automatic — the voxel grid labels the borehole's
   location by whichever body's voxels occupy it. In 2D the body-partition
   surfaces interpolate across the borehole column.

This is **why lab containment works**: lab samples are taken from boreholes, so a
borehole *must* carry packing bodies for a lab test to resolve to one. Pass 2 is
the mechanism. (It also supersedes the 2026-06-26 "borehole adopts nearest-CPT
class sequence" projection, which created slivers by projecting per-column class
stacks instead of letting the *bodies'* geometry pass through.)

## 7. Render

- **2D section** = `computeSectionFill(geotechLayers, geotechEdges)` — the
  connected-body partition. Clean *because the bodies connect* (dense edges from
  §5), not because of carve geometry. The litho frame is implicit in the layers'
  bounds. **`subdivideRegionsByGeotech` is deleted.**
- **3D** = the litho voxel builder pointed at the geotech model, labelling space by
  geotech `body_id`. On-demand "Build", same UX as litho.
- 2D and 3D are **consistent** because both derive from the same geotech layers +
  correlations — exactly the litho 2D/3D relationship.

## 8. Manual curation (litho-style)

Reuse the litho editing gestures on the geotech model:

- **Merge** two adjacent packing bodies into one (collapse an oscillation, or join
  matig+dicht into a "medium-dense" unit).
- **Drop / delete** a thin band or sliver (e.g. the 0.58 m silt interbed).
- **Correlate / un-correlate** packing bodies across tests.

Detail is preserved by default; curation is opt-in. A detail-hungry user keeps
every band; a summary-oriented user merges down to a few.

## 9. Migration — what is retired

The 2026-06-26 carve line is **removed**, not extended:

- Delete `desktop/.../utils/geotechSubdivide.ts` (`subdivideRegionsByGeotech`,
  `carveRegionByGeotech`, `projectSubsOntoBand`, the sliver cull, the borehole
  projection) + its tests.
- Remove the `geotechEdges` / `geotechCptInvIds` / solid-overlay plumbing added to
  `PartitionFillOverlay` / `SectionPanel` / `SectionsCanvas` for the carve.
- Change `SubdivideAllBodies`: (a) drop the nearest-CPT borehole extrapolation in
  favour of the §6 pass-2 geometric division; (b) replace the full-NAD-sequence
  auto-edge rule with the §5 litho-correlation-seeded same-class rule.
- Point the geotech 2D render at `computeSectionFill(geotechLayers, geotechEdges)`
  and the 3D Build at the voxel builder on the geotech model.

Legacy `.strix` bundles still restore (additive — the geotech layers/edges already
persist; this changes how they're *derived*, not the stored shape — confirm in the
plan).

## 10. Risks & validation

- **Connectivity density is the make-or-break.** If the inherited litho
  correlations + same-class rule don't connect enough, we are back to singletons.
  **Validation gate:** the owner's real `GEO-10/170-S6 → B6 → B4 → GEO-23/125-S13`
  section must yield a small number of connected bodies and a clean render (no
  sliver litter) — measured the same way the diagnostic measured the 459/130
  failure. This is the acceptance test, not a synthetic fixture.
- **Borehole division correctness** — lab containment depends on it; validate that
  a known lab-sample depth in a borehole resolves to the geologically correct body.
- **2D/3D consistency** — the section slice must match the voxel labelling.
- **Performance** — the 2D body partition runs per-frame (memoised, as litho is);
  the voxel build is on-demand. Re-measure on the real model; reuse the litho
  perf envelope.

## 11. Out of scope

- The analytics grouping itself (`parameter_group`, lab/CPT-by-body queries) —
  **Slice 3**, deferred until lab-test import lands. This design only lays the body
  foundation it will consume.
- Auto-smoothing of packing oscillation — **explicitly rejected** by the owner;
  cleanup is manual.
- Cross-litho-body packing connections — packing bodies stay within one litho unit.

## 12. Open questions for the plan

- Exact reuse boundary of the litho voxel builder for the geotech model (does it
  parameterise cleanly on `model_id`, or need a thin adapter?).
- Where pass-2 borehole division runs (build-time materialisation into geotech
  `litho_layer` rows vs render-time interpolation) — and how lab containment reads
  it (it needs persisted geometry, so likely build-time).
- Whether the §5 auto-edge rule lands in `SubdivideAllBodies` or a dedicated
  `DeriveGeotechConnectivity` use case.
