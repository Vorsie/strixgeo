# Handoff — Geotech Fraction-Space Refinement: IMPLEMENT NOW — 2026-07-06

> **✅ IMPLEMENTED 2026-07-07** on worktree branch `feat-geotech-fraction-refinement`
> (off `feat-geotech-body-samples-3d`, UNPUSHED). Engine
> `desktop/.../utils/refineLithoPartition.ts` (pure port of the rev-8 `carvePanel`
> + two polish wins: pinch/lens → single dominant class, apex-reach void clamp).
> Frozen-CS1 gate (`refineLithoPartition.cs1frozen.test.ts`) at **zero cross-class
> overlap** ("one packing class per point" — same-class self-overlaps excluded as
> harmless + present in the accepted rev-8). Render harness
> (`refineLithoPartition.render.test.ts`, `GEOTECH_RENDER=1` →
> `geotech_refine_preview.html`) = the eyeball surface. In-app wiring done
> (SectionsCanvas flip + bundle → SectionPanel → PartitionFillOverlay, RF1-4 tests);
> **the in-app VISUAL is owner-dogfeed-pending** (green vitest/tsc/hook-order don't
> catch this god-component's TDZ/visual bugs). Backend bug FIXED (shared
> `application/geotech_edge_derivation.py`; DivideBoreholes derives borehole-mediated
> edges + re-resolves body_id; ADB-1..4 + 11 SAB/BH integration tests green). Full
> suite: 2149 vitest + 1583 backend unit + tsc + hook-order all green. §5 artifact
> classification: the pinch slivers + cross-class overlaps are eliminated (pinch
> single-fill); residual sub-visual voids are a mix of small carve-tapers (apex
> clamp reduces them) + engine #228 gaps (parallel session). §1 rule-8 (geo
> policy-b) + §4 #227 remain DEFERRED as designed.


**For a fresh implementation session.** The design was locked tonight in an
8-revision browser brainstorm with the owner on the REAL CS1 (dev DB). Every
rule below was forced by a real defect the owner caught — none is speculative.
Read this fully, then go through plan mode (the owner has already answered the
what/why; the plan is about HOW/sequencing).

**⚠ PARALLEL-SESSION COORDINATION (owner runs TWO Claude terminals):**
- **This session** implements the geotech stage refinement. It must NOT modify
  `desktop/src/renderer/src/utils/partitionFill.ts` — a SECOND session
  (docs/superpowers/2026-07-06-litho-sliver-research-brief.md, debt #228) owns
  that file to fix engine sliver overlaps. New files + the backend are yours.
- Work in a **git worktree on a fresh branch** (memory:
  `feedback_concurrent_agent_shared_worktree` — two sessions on one HEAD
  interleave commits). Current branch `feat-geotech-body-samples-3d` is 158+
  commits ahead of develop, unpushed.
- The dev desktop app may be running on :8765 (dev DB `groundmodel` :5433) and
  a throwaway http.server on :8801 — touch neither.

---

## 1. THE DESIGN (owner-locked 2026-07-06, with the defect that forced each rule)

**Core principle:** *the geotech partition is the LITHO partition refined in
thickness-fraction space. Litho boundaries are INVARIANT; each litho region is
subdivided internally by NAD packing class only.* (The previous approach — run
`computeSectionFill` directly on geotech sub-band layers + LCS-derived edges —
is proven wrong: it cannot express lens-in-pack, deforms litho boundaries, and
drops all borehole-mediated connectivity. See §3 diagnosis.)

The refinement rules, in application order per litho region:

1. **Sub-band source:** the persisted geotech `litho_layer` rows (policy-B
   aggregated), matched to the region's side columns by ELEVATION containment
   against the region's edge slice, **hard-guarded by soil code** (a sand
   region may only carry ZAND-coded sub-bands — tolerance drift otherwise
   pulls a neighbouring silt class in; owner caught this as "silt transitioning
   into a sand lens").
2. **Fractions, not elevations:** sub-band boundaries are expressed as
   fractions of the litho unit's thickness at each column and interpolate in
   fraction space across the region — stripes follow lens shapes and vanish at
   the apex together (owner: S10 "3 stacked lenses" → one striped lens).
3. **Material-space slice mapping:** at every x-sample, slice the region
   polygon by EVEN-ODD interval pairing; map fractions through the SOLID
   material thickness, skipping concave voids. Never flatten to the outer
   envelope (that overfilled every concave region — the systemic "looks even
   worse" bug) and never bunch bands into one part (envelope mapping did).
   Emit ALL slice pieces (a dropped piece = a black hole), pair pieces across
   samples with a MONOTONE two-pointer (greedy pairing crosses), and a
   die/born transition may only reach its midpoint apex if that apex is INSIDE
   the region polygon (else it pokes into the neighbour region).
4. **Class alignment = position-aware weighted LCS:** same class only bands
   when the two spans vertically overlap in fraction space, + dip slack
   (¼ mean span thickness + 0.1). A class-only LCS paired a DEEP n7 with a
   SHALLOW n7 across the n8 between them → steep climbing band (owner, B3↔S9).
   Mirrors litho's own `matchColumns` lesson.
5. **Unmatched spans (the interval fill):**
   - class matches a bracketing pair band → **merge into that band's fill**
     (clean onlap, NO separate shape — never render both a taper and a lens);
   - other classes → **horizontal overlay lens** at their own stratigraphic
     position (reach ~0.45, opaque, litho-lens convention);
   - the interval void fills with the two bracketing classes meeting at the
     **home-side class boundary carried across** (NOT 50/50 — a thin n22 crust
     must stay thin; the basal n23 stays continuous; owner, S13).
6. **Horizontal class extrapolation everywhere:** a side with no packing data
   scans OUTWARD for the nearest classified column at the same elevations
   (same mental model as litho connecting horizontally below TD). NO
   "unclassified" state. The under-TD SUBSTRATE quads are class-subdivided the
   same way (donor class boundaries extend at constant elevation — owner's B4
   rule: "n22 sideways, denser n23 below"), with substrate strips clipped at
   midpoints toward neighbours (coincident cluster columns otherwise overlap
   strips visibly).
7. **Degenerate-gap guard:** columns closer than a strip width make the gap
   width negative and MIRROR the fraction mapping — skip sub-pixel gaps.
8. **Geo aggregate — policy (b), litho-content-aware boundary:** between geo
   picks, the interpolated geo boundary DEFLECTS around litho bodies whose
   lithology contradicts the formation's known content (owner's S9 case: the
   TIN crossed a silt where the Paleogene is pure clay). Requires a
   per-formation lithology-content attribute (engineer-set; e.g. "Formatie
   van Kortrijk = pure clay") — new, additive data. Design the attribute +
   deflection in the plan; it may ship as a later slice.

**The watertightness invariant is a TEST:** port the brainstorm's polygon
overlap detector as a unit invariant — no two refinement polygons overlap
(excluding by-design opaque overlays: enclosed lenses + engine lens regions),
run on the frozen CS1 fixture. Also extend the CS1 gate with it.

## 2. REFERENCE IMPLEMENTATION (port, don't re-derive)

`desktop/src/renderer/src/utils/partitionFill.geotechBrainstorm.test.ts`
(**untracked — do not delete**) — the `carvePanel` function IS the algorithm,
iterated 8 times against the owner's eyes on real data. Productionize as a pure
`desktop/src/renderer/src/utils/refineLithoPartition.ts` (new file):
`(regions: SectionRegion[], geotechColumns, nadMeta, lithoSoilMap) →
RefinedRegion[]` — engine output in, refined polygons out, no I/O. The render
integrates it on the geotech axis in place of the direct geotech-model fill
(`SectionsCanvas.tsx:278-297` axis-conditional block + `PartitionFillOverlay`).
Inputs: litho regions from the LITHO model (already fetched on the litho axis),
geotech layers (already fetched), NAD formation metadata.
Supporting throwaways: `scripts/throwaway_geotech_brainstorm_extract.py`
(extraction shapes), `scripts/throwaway_cs1_partition_extract.py`,
`scripts/throwaway_carve_overlaps.txt` (detector output format).
The served preview: `geotech_brainstorm_preview.html` (repo root) — panel 3 is
the accepted target render (rev 8), modulo §5's open polish list.

## 3. THE BACKEND BUG — fix regardless of render (body identity / samples / 3D)

Proven by debugging-scientist on the dev DB (2026-07-06, full evidence in the
session): **geotech correlation edges are derived BEFORE boreholes are
materialised**, so every litho edge with a borehole endpoint is skipped —
`SubdivideAllBodies` Phase 8 materialises CPT columns only
(`subdivide_all_bodies.py:505-550`), Phase 9's
`_derive_geotech_edges_from_litho` gets an empty `_stack(borehole)`
(`:830-836`, counted in `skipped_empty_stack`); `DivideBoreholes` later stamps
`body_id` but emits ZERO edges. On CS1 the litho chain S13↔B4↔B6↔S6 is
entirely borehole-mediated → geotech edge count in that cluster: 0. Fix
directions (plan decides): derive edges AFTER borehole materialisation and/or
have DivideBoreholes emit edges for adopted-class bands. Even though the NEW
render no longer consumes those edges for shape, the persisted edge/body graph
feeds sample assignment, the inspector, and the 3D geotech build.
Also: B6's top KLEI band has `body_id = NULL` (orphan); stale comments claim
the geotech partition is "litho-framed" (`correlationOverlayAxis.ts:8-13`,
`SectionsCanvas.tsx:423-424`) — after this work they become TRUE again; fix
them; memory `project_geotech_stage_body_centric.md` says full-sequence match
but code is LCS (`aligned_same_class_pairs`) — update memory.

## 4. RELATED DEBT

- **#227** — geotech manual edits (drag/clamp at litho envelope, delete/merge/
  split, small-lens merge suggestion). AFTER the refinement ships.
- **#228** — litho engine sliver overlaps (the PARALLEL session's scope; you
  consume `computeSectionFill` output as-is and must tolerate hairline slivers
  until it lands — do not fix them yourself).

## 5. OPEN POLISH (owner's final circle-pass on rev 8 — resolve during implementation with real tests)

The owner circled ~14 remaining artifacts. Classify each during implementation
(some are #228 engine slivers, some carve-level, some possibly honest data):
small dark sliver wedges at multiple gaps (mostly #228-class); grey diamond
lenses inside sand mid-section (verify: thin KLEI litho lenses honestly
class-coloured, or a carve artifact); the bottom-left substrate internal
shading (donor-split seams); the far-right dense sand block (verify against
S1's actual classes); faint vertical quad-seam texture from per-sample-pair
emission (consider merging collinear quads or higher N). Definition of done is
the owner's: **perfection, not 95%** — final acceptance is the owner eyeballing
CS1 rendered by the production code, plus the overlap invariant at 0.

## 6. TESTS (non-negotiable, per project discipline)

Unit: the overlap invariant on frozen CS1 (port the detector); per-rule cases
mutation-verified (soil guard, weighted LCS position-awareness, home-boundary
split, material-space mapping on a concave fixture, horizontal extrapolation,
substrate donor slicing). Follow `strix-section-geometry-check` for anything
drawing at along-positions (warpedXToScreen, never raw). Integration: the
backend edge fix needs the borehole-mediated chain asserted (S13↔B4↔B6↔S6
becomes connected — extend `test_subdivide_all_bodies.py`). Run integration
via `.\scripts\run-integration-tests.ps1` ONLY (read stdout; wrapper wipes the
e2e fixture). Commit per-file, `--no-verify`, DO NOT push.
