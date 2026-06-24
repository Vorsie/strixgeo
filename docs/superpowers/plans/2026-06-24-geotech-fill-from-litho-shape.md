# Geotech fill = litho partition, subdivided by NAD — Implementation Plan

> **For agentic workers:** executed inline this session with render verification.

**Goal:** The geotech section fill must have the EXACT same shape/connectivity as
the litho fill, only subdivided INSIDE each body by NAD packing class.

**Why the current approach fails:** the geotech axis runs `computeSectionFill` on
the GEOTECH layers + GEOTECH edges. The geotech edge derivation
(`_derive_geotech_edges_from_litho`, depth-mapped, drops cross-NAD edges) produces
terrible connectivity — real data: 236 geotech bodies, 187 singletons (79%), vs a
well-connected litho model. `pairScore` keys on `formationId` (= NAD class), so a
loose sand on one test never bands to a dense sand on the neighbour. Result:
"fill changes colour at random" + "units connected in litho not in geotech".

**Architecture:** Build the partition from the LITHO layers + LITHO edges (so the
geotech fill is the litho fill, exactly). Then a pure transform subdivides each
litho region into NAD sub-bands using the geotech sub-layer depths on the two
columns bounding each gap. The geotech split surface (loose/dense boundary) is the
straight line connecting the two columns' split elevations — clean sub-quads, no
diagonal artifacts. NAD edges/bodies are NOT used for rendering (they remain for
the future Parameters stage).

**Tech Stack:** TS pure util + Vitest; PartitionFillOverlay; SectionsCanvas wiring.

---

### Task 1: Pure subdivision util

**Files:**
- Create: `desktop/src/renderer/src/utils/geotechSubdivide.ts`
- Test: `desktop/src/renderer/src/utils/geotechSubdivide.test.ts`

`subdivideRegionsByGeotech(regions, orderedColumns, subLayersByInv)`:
- `regions`: litho `SectionRegion[]` (carry `gapIndex`, `formationId` litho, `bodyId`, `polygon`, `kind`).
- `orderedColumns`: `PartitionColumn[]` (carry `investigationId`, `surfaceElevM`) — index = column order; gap i is between column i and i+1.
- `subLayersByInv`: `Map<invId, {topDepthM, baseDepthM, formationId}[]>` (NAD formation), sorted shallow→deep.

For each region:
- `kind==='quad'`: read band top/base elevation at left (fraction 0) and right
  (fraction 1) from the polygon. Collect each column's NAD sub-layers overlapping
  that band (converted depth→elev via the column `surfaceElevM`). If **both sides
  have the same count** → emit one sub-quad per band, split at the paired
  (leftSplitElev, rightSplitElev); `formationId` ← the NAD sub-layer. If counts
  differ (lateral variation / extrapolation drift) → keep the region as ONE band,
  `formationId` ← the NAD class covering the largest elevation overlap on the
  deeper column (graceful fallback — shape preserved, NAD-coloured).
- `kind` `pinch`/`lens`: single-column body. Tag `formationId` ← the NAD sub-layer
  with the largest overlap on the region's own column at the region's mid-elevation;
  do not subdivide (minority, triangle subdivision is artifact-prone).
- A region whose body has no geotech sub-layers (e.g. no-qc) → keep verbatim
  (formationId stays litho → falls back to its litho colour / the caller's null map).

Output: `SectionRegion[]` with `formationId` replaced by NAD formation ids,
`gapIndex`/`bodyId`/`kind`/`polygon` preserved (sub-quads share the parent bodyId).

**Tests (GS-* ):** consistent 2-way split → 2 sub-quads with the split line at the
paired elevations; one-class body → 1 band recoloured; count-mismatch → fallback 1
band with dominant NAD; pinch region → tagged by dominant NAD, not subdivided;
empty sub-layers → region unchanged.

### Task 2: Wire the subdivision into PartitionFillOverlay

**Files:** Modify `desktop/src/renderer/src/components/sections/PartitionFillOverlay.tsx`

- New optional prop `geotechSubLayersByInv?: ReadonlyMap<string, GeotechSubLayer[]>`.
- In `sectionFillData`, after `computeSectionFill(...)`, when the prop is present
  run `subdivideRegionsByGeotech(sectionRegions, orderedColumns, prop)` and return
  the subdivided regions. Everything downstream (screen projection, colour via
  `formationColorById`, labels) is unchanged — it already colours by
  `region.formationId`, which is now the NAD formation id.
- Add the prop to the data memo deps.

### Task 3: Wire SectionsCanvas → SectionPanel → overlay on the geotech axis

**Files:** Modify `SectionPanel.tsx`, `SectionsCanvas.tsx`

- SectionPanel: new prop `geotechSubLayersByInv?`. On the geotech axis the
  `PartitionFillOverlay` must receive the LITHO layers + LITHO edges for the SHAPE
  and the geotech sub-layers for the subdivision; on the litho axis nothing
  changes. Thread `lithoLayers`/`contactEdges` so that, when
  `axisMode==='geotechnical'`, they are the litho shape source (passed from Canvas
  via the existing props now carrying litho data on the geotech axis) — keep
  `formationColorById`/`formationLabelById` as the NAD maps (already derived from
  the geotech `formations`).
- SectionsCanvas: on the geotech axis pass litho layers/edges as the partition
  shape source and build `geotechSubLayersByInv` from `geotechLayers`.

### Task 4: Verify against real data via render

Render `PartitionFillOverlay` with the real test.strix litho regions + geotech
sub-layers (throwaway harness → SVG → screenshot), and DIFF the geotech render
against the litho render: same band envelopes, NAD subdivision inside, no
random colour changes, no litho-connected-but-geotech-disconnected bodies.
Only then is the task done.
