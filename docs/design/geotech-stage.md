# Geotech Stage — current design (ACTIVE MILESTONE)

> Current state only. The 2026-06-24 "connected NAD-band section render"
> (`subdivideRegionsByGeotech` / `carveRegionByGeotech`) is SUPERSEDED by the
> fraction-space refinement below.

Sequencing decision (owner, 2026-06-29): **the geotech subdivision stage is
worked out FIRST**; the provenance-based parameter-suggestion slice is a noted
future MVP candidate revisited only after this stage (rationale in
`CLAUDE.local.md` → Active Focus).

## 1. Subdivision (shipped 2026-06-24, develop)

Body-centric Option A: `SubdivideAllBodies` use case — policy-B aggregator +
TIN split-surface + geotech `litho_layer`/edge/`BodyOrm` materialisation via
the litho machinery, **same-position-edges-only** to prevent NAD-class
over-merge. Surface: "Subdivide all bodies" toolbar verb +
`GeotechnicalCanvas` + `GeotechnicalInspector` roster.

Real-data validated on `test.strix`: 14 sections, 273 body groups, 20 %
consistent-split / 73 % one-class / 7 % borehole-only.

Deferred: e2e spec/fixture (F6); `parameter_group` analytical layer (#223,
Slice 3, waits for lab-test import).

## 2. Fraction-space refinement — the geotech render model (shipped 2026-07-07)

Worktree `feat-geotech-fraction-refinement` off `feat-geotech-body-samples-3d`,
**UNPUSHED**. Owner-locked after the 8-rev CS1 brainstorm — handoff doc:
`docs/superpowers/2026-07-06-geotech-fraction-refinement-handoff.md`.

**The geotech partition is the LITHO partition refined in thickness-fraction
space** — litho boundaries INVARIANT; each region subdivided internally by NAD
packing class.

* The geotech axis builds the partition from the LITHO model (layers + edges)
  and refines it via the pure
  `desktop/.../utils/refineLithoPartition.ts` (`refineLithoPartition` +
  `refineSubstrateQuads`; a faithful port of the accepted rev-8 `carvePanel`,
  plus pinch/lens→single-dominant-class + apex-reach void clamp).
* **Invariant = the always-on frozen-CS1 gate at ZERO cross-class overlap**
  ("one packing class per point").
* In-app wiring: SectionsCanvas flip + a `geotechRefinement` bundle →
  SectionPanel → `PartitionFillOverlay` (view-only refined render).
  ⚠ **Visual is owner-dogfeed-pending** — green vitest/tsc don't catch this
  god-component's TDZ/visual bugs.
* Backend fix that rode along: geotech edges were derived before boreholes
  materialised (S13↔B4↔B6↔S6 got 0 edges); `DivideBoreholes` now re-runs the
  shared `application/geotech_edge_derivation.py` after borehole-band fill +
  re-resolves `body_id` (fixes the B6 NULL orphan).

Deferred: rule-8 geo policy-b (needs a per-formation `lithology_content`
attribute); #227 manual geotech edits; #228 litho engine slivers (parallel
session).

## 3. Connecting geotech units (built 2026-06-25, develop UNPUSHED)

All four phases shipped (~31 commits, subagent-driven, two-stage-reviewed):

* (A) auto rule = **full NAD-class-SEQUENCE match within a litho body**
  (`_derive_geotech_edges_from_litho` rewrite + pure helper
  `domain/services/geotech_packing_edges.py`);
* (B) render connects sub-bands by resolver `body_id` (`geotechSubdivide.ts`);
* (C) `ReSubdivideConfirmDialog` prompts before a re-subdivide clears
  connections;
* (D) manual "Correlate packing" gesture reusing the litho correlate machine
  pointed at the geotech model (same-class + same-litho-body guard
  `utils/geotechPackingConnect.ts`, `requestGeotechLayersRefetch` nonce,
  toolbar verb).

META-RULE real-data verified: 226 auto edges, 0 cross-class, 0 null-class.
See `memory/project_geotech_stage_body_centric.md`.

## Open dogfeed items (owner)

Tracked in `CLAUDE.local.md` → Active Focus: visual/gesture dogfeed of the
connect flow, the fraction-refinement render, the NAD `gradient_snap` default
decision, and the NAD-boundary line weight call.
