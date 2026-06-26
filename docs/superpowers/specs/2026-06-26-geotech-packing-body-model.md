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

**Recurring same-class bands → ONE body (owner decision, 2026-06-26).** When a
packing class recurs within one correlated litho body (S6 sand =
*matig → [silt interbed] → matig → dicht*), every matig band ties to the
neighbour's matig band(s), so the resolver's connected-components unions them into
a single geotech body — even across the interbed. **This is intended:** it is one
packing population for analytics; the engineer **splits it manually** if they judge
the zones distinct (the manual curation in §8). The auto rule therefore deliberately
emits a same-class edge for *every* overlapping pair (one-to-many is fine — it is
exactly what produces the single connected body); no closest-midpoint tie-break is
needed. The architect's "spanning physically distinct bands" concern is resolved by
this choice: spanning is the desired default, splitting is the manual override.

The same-class filter also automatically satisfies the SAB-7 guard (no cross-class
edge → loose can never over-merge into dense) — confirmed in agent review. The old
`aligned_same_sequence_pairs` helper is deleted.

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
2. **Pass 2 — the bodies divide the boreholes geometrically, at BUILD time
   (resolved in agent review).** After the CPT bodies + `body_id`s are resolved, a
   new `SubdivideAllBodies` sub-phase (**"Phase 8c"**) materialises borehole
   geotech `litho_layer` rows by **TIN-interpolating each body's packing-transition
   surface** (reuse `domain/services/.../geotech_split_surface.py
   ::interpolate_split_elevations`, control points = the CPTs' band-base
   elevations) onto the borehole XY, then slicing the borehole into one band per
   intersecting body, **clipped to the borehole's own litho frame** (`group_segs`
   already gives the geo/litho-bounded extent). The band carries the dividing
   body's `body_id` + NAD class. Build-time materialisation is required because lab
   containment needs **persisted** geometry to read.
   - This **replaces** today's nearest-CPT class extrapolation (`SubdivideAllBodies`
     Phase 8b) — that path is removed.
   - `interpolate_split_elevations` needs ≥3 non-collinear CPTs for a TIN; it falls
     back to a flat mean for 2-CPT / collinear groups — still cleaner than today's
     proportional projection. No new failure mode, no schema change.
   - The 2D render then "just works": the borehole column carries real geotech
     layers (with `body_id`), so `computeSectionFill` fills across it like any other
     column. (This resolves the architect's 2D-circularity concern — boreholes are
     materialised at build time, not interpolated at render time.)
   - In 3D the voxel grid labels the borehole's location natively from the same
     bodies; 2D and 3D agree because both read the same materialised layers.

This is **why lab containment works**: lab samples are taken from boreholes, so a
borehole *must* carry packing bodies for a lab test to resolve to one. Phase 8c is
the mechanism. (It supersedes the 2026-06-26 "borehole adopts nearest-CPT class
sequence" projection, which created slivers by projecting per-column class stacks
instead of letting the *bodies'* geometry pass through.)

## 7. Render

- **2D section** = `computeSectionFill(geotechLayers, geotechEdges)` — the
  connected-body partition. Clean *because the bodies connect* (dense edges from
  §5), not because of carve geometry. The litho frame is implicit in the layers'
  bounds (the geotech `litho_layer` rows are already geo/litho-bounded by the
  build, so a band can't cross a litho boundary — enforced at build time, not
  render time). **`subdivideRegionsByGeotech` is deleted.**
  - **Wiring (agent review):** the render swap is an *axis-conditional data
    source*, not just a deletion. `SectionsCanvas` today hardcodes
    `activeSectionModelId = lithoModelId` / `sectionLayers = lithoLayers` *even on
    the geotech axis* precisely to avoid the old singleton problem. On the geotech
    axis this becomes: `sectionLayers` = geotech layers, `correlationModelId` =
    geotech model id, `formationColorById/LabelById` = the NAD maps. The overlay's
    `computeSectionFill` call is unchanged — it renders whatever layers + edges it
    receives. Remove the `geotechSubLayersByInv` / `geotechCptInvIds` / carve
    props. The `dominantNad` helper may survive as a no-edge fallback colourer
    (decide in the plan).
- **3D** = the litho voxel builder pointed at the geotech model, labelling space by
  geotech `body_id`. On-demand "Build", same UX as litho. **Wiring (agent review):**
  needs a geotech-flavoured request-assembly path — `buildVoxelRequest` /
  `assembleLithoSectionInputs` must produce geotech layers + geotech edges per
  section (the `PartitionUnit.layerId`s reference geotech `litho_layer.id`s, so the
  LCS match must use geotech edges). `BuildVoxelLithoModel.execute(model_id, …)`
  itself takes the geotech `model_id` cleanly; the colour lookup
  (`sectionFenceData.ts`) must handle NAD formation names.
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
persist; this changes how they're *derived*, not the stored shape; confirmed in
agent review against `bundle_restore_core.py`). **Stale-state UX note:** a bundle
saved under the old auto-edge rule carries edges that won't match the new
connectivity until the user re-runs "Subdivide all bodies" — surface a hint or
auto-resweep on open (plan decides which). Not a data-corruption risk.

**Critical sequencing (agent review — both reviewers):** the backend edge rule (§5)
+ borehole division (§6) land and are **validated on real data FIRST**; the
frontend render swap + carve deletion land **only after** connectivity is proven on
the real section. Shipping the frontend swap on sparse edges would regress straight
back to the singleton render. See §10.

## 10. Risks & validation

- **Connectivity density is the make-or-break** (both reviewers: the engine has no
  "same-body, no edge" fallback — `computeSectionFill` matches purely on edges, so
  dense §5 edges are the single load-bearing assumption). **Quantitative gate** on
  the owner's real `GEO-10/170-S6 → B6 → B4 → GEO-23/125-S13` section (the same
  diagnostic that measured today's 459 regions / 130 slivers):
  - geotech **connected bodies ≪ today** — target **< 30** for that section (vs the
    459 fragments), and the model-wide `SubdivideAllBodiesResult.body_count` falls
    sharply vs the 187-singleton baseline;
  - rendered partition has **0 sub-resolution slivers** (vs 130 today);
  - run this **right after the backend edge rule lands, before any frontend work**
    (a log/diagnostic scan, no UI needed). This is the go/no-go for the frontend
    swap, not a synthetic fixture.
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

## 12. Resolved in agent review (2026-06-26)

- **Voxel builder reuse:** `BuildVoxelLithoModel.execute(model_id, …)` parameterises
  cleanly on the geotech `model_id`; the only new wiring is a geotech-flavoured
  request-assembly path (geotech layers + geotech edges per section) + NAD colour
  lookup. (§7.)
- **Pass-2 borehole division:** build-time materialisation into geotech
  `litho_layer` rows via `interpolate_split_elevations` (Phase 8c) — lab containment
  reads persisted geometry. (§6.)
- **§5 auto-edge rule location:** stays in `SubdivideAllBodies`
  (`_derive_geotech_edges_from_litho`) — a focused swap of `aligned_same_sequence_pairs`
  for a same-class depth-overlap loop; no new use case needed.
- **Recurring same-class → one body**, split manually. (§5.)

## 13. Risks the plan must carry forward (agent review)

- **`SAB-10b` connectivity-ratio test** may need its expected count updated — the
  new rule emits more edges (possibly >1 geotech edge per litho edge); the `≥0.5`
  assertion still passes but scan for exact-count asserts.
- **TDD trigger for §5:** a 2-CPT scene where S6 = `[matig, dicht]` and S13 =
  `[matig, matig, dicht]` — old rule emits 0 edges, new rule emits the matig + dicht
  ties. Write that failing test first.
- **Backend-before-frontend coupling** (§10) is the top sequencing risk — encode it
  as an explicit gate in the plan.
