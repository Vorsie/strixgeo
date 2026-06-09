# Plan — lens/onlap carve-out: make the partition fill a TRUE volumetric partition

**Status:** ready for a fresh session. Branch off `develop` (which already has all the
prerequisite fixes below). Owner directive: volumetric CPT extraction needs every point in
the cross-section to belong to **exactly one body** — no overlaps anywhere.

---

## 0. Read first (context a fresh session won't have)

- Memory: `memory/project_partition_fill_pinchout_matrix.md` (UPDATE 7 = the shipped
  contact-correlation model). The partition fill is the **source of truth for body shape; 3D
  ports it.** So the 2D fill must itself be a true partition.
- Code: `desktop/src/renderer/src/utils/partitionFill.ts` (the fill) +
  `components/sections/PartitionFillOverlay.tsx` (the renderer) +
  `utils/partitionFill.test.ts` (tests incl. the `assertTiles` invariant).
- The model: `computeSectionFill(columns, edges)` resolves **per-gap / per-side**. Each unit's
  shape toward a neighbour is decided by how many of its 2 bounding contacts are correlated:
  **2 → band (quad), 1 → onlap, 0 → lens** (`classifyTermination`). `reduceColumn` pulls the
  0-contact lenses (recording their ORIGINAL depths); `emitGap` matches bands, walks intervals,
  emits pinches + carry-through bands, and appends lenses/onlaps.

### What is already TRUE on `develop` (do NOT re-solve)
- **main × main overlaps = 0** — fixed by the carry-through-top slope (CT3 / gap-11).
- **lens × lens = 0, pinch × pinch = 0** — fixed by recording a lens's original (not
  flood-mutated) depth (LL1). So **no two minority bodies overlap each other.**
- The boundary-node drag clamps to its gap (MB5); the per-gap/per-side model is in place.

### The ONE remaining overlap class (this plan's target)
Lenses and onlaps are emitted as `kind: 'lens'` **overlays**, drawn on top of the main
regions. The matrix quad still spans the full gap *underneath* them. So:
- `lens × quad` ≈ 808 / `lens × pinch` ≈ 250 per the busiest section (CS1). These are the
  by-design overlays — but **volumetrically a point inside a lens is also inside the matrix
  body.** That is exactly "the lens data ends up in a main body."

Goal: convert these overlays into a **true partition** — the matrix region's polygon excludes
the lens's space (a notch), so each point is in exactly one region/body.

---

## 1. Two approaches — pick deliberately

### Approach A — geometric carve (this plan's primary)
Subtract each overlay triangle from the main region it overlays (a notch on the matrix
polygon). The 2D fill becomes a genuine non-overlapping partition; `assertTiles` (with lenses
no longer excluded) validates it. **Downside:** matrix polygons become **concave**, which the
future 3D port must handle (see §6 risk).

### Approach B — extraction-time priority (lighter alternative — evaluate first)
Keep overlays as overlays; define a rule: a 3D point belongs to the **overlay** (lens/onlap)
if it's inside one, else the main region. No polygon surgery, mains stay convex quads, the 3D
mesh sweeps overlays as separate prisms. The *effective* partition is unambiguous via priority.
**Downside:** the 2D polygons still overlap, so `assertTiles` can't validate it directly (needs
a priority-aware checker), and any downstream consumer must know the priority rule.

**Recommendation:** if the (not-yet-built) 3D/extraction pipeline can apply an overlay-wins
priority when assigning a point to a body, **do B** — far less code and risk, no concave
polygons. Do **A** only if the 3D mesh genuinely needs non-overlapping prism geometry (no
priority logic downstream). The rest of this plan details **A** (the harder one) since that's
what was asked; §1-B is a real fork to confirm with the owner before building.

---

## 2. Approach A — the carve algorithm

A post-pass in `emitGap`, run **after** all mains + overlays are emitted, **before**
`return regions` (currently ~line 1497, after the lens/onlap append loops).

### Why a uniform edge-notch is enough (no polygon-boolean needed)
- Every overlay is a **triangle with two vertices on a single column edge** (fraction 0 or 1)
  and one apex at an interior fraction (`LENS_PINCH_FRACTION = 0.45` for left lenses, `0.55`
  for right; onlaps similar via `buildOnlapPolygon`).
- A LEFT overlay occupies `[0, 0.45]`; a RIGHT overlay `[0.55, 1]`. They can never reach the
  opposite half, so **a lens only ever overlaps a region it shares a column edge with** — i.e.
  every `lens × pinch` overlap is *same-side* (left lens over a left pinch, etc.). Verified:
  the geometry forbids opposite-side overlap.
- Therefore subtracting an overlay from its matrix is always a **notch on the shared column
  edge** → one concave polygon, never a hole, never a split. No Greiner-Hormann / Weiler-
  Atherton needed.

### Steps
```
carveOverlays(regions):                       // regions = ONE gap's regions
  mains    = regions.filter(kind in {quad, pinch})
  overlays = regions.filter(kind === 'lens')   // lenses AND onlaps
  // group notches per (matrix, edge-fraction)
  for O in overlays:
    side  = O has >=2 verts at fraction~0 ? 0 : (>=2 at ~1 ? 1 : skip)
    apex  = the single vertex of O at an interior fraction   // (apexFrac, apexElev)
    [ob, ot] = min/max elevation of O's two edge vertices
    M = mains.find(m => m has >=2 verts at fraction==side
                        AND span(m, side) ⊇ [ob, ot])        // the matrix it sits in
    if !M: continue (defensive — log in dev)
    record notch {ob, ot, apexFrac, apexElev} on (M, side)
  for each M with notches:
    M.polygon = insertNotches(M.polygon, side, notchesOnThatEdge)
  // overlays are LEFT UNCHANGED — they fill the notches. Now it's a true partition.
```

### `insertNotches(polygon, edgeFrac, notches)`
Walk the ring; when traversing the edge whose BOTH endpoints are at `edgeFrac`, insert each
notch's detour in the traversal's elevation order:
```
out = []
for (a, b) in edges(polygon):              // consecutive, wrapping
  out.push(a)
  if a.fraction≈edgeFrac && b.fraction≈edgeFrac:
    dir = sign(b.elevation - a.elevation)  // are we going up or down this edge?
    for n in notches sorted to match dir (asc if dir>0, desc if dir<0):
      near = dir>0 ? n.ob : n.ot           // first hit going a→b
      far  = dir>0 ? n.ot : n.ob
      out.push({fraction: edgeFrac, elevation: near},
               {fraction: n.apexFrac, elevation: n.apexElev},
               {fraction: edgeFrac, elevation: far})
return out
```
This carves each notch (`near → apex → far`) into the column edge. Works for a **quad** (edge
= the 2 frac-0 or frac-1 verts) and a **pinch** (its one full edge), and for **stacked**
notches (sorted by elevation). The lens triangle ⊆ the matrix at that edge, so the apex
(frac 0.45) lies inside the matrix → valid concave result.

---

## 3. Flip the invariant — `assertTiles` includes lenses

`partitionFill.test.ts`, `assertTiles` (~line 106): change the default
`excludeKinds = new Set(['lens'])` → `new Set()` (empty). After carving, lenses are true
tiles: matrix-with-notch + lens-triangle partition the column with no gap and no overlap. So
the invariant must now check ALL kinds. **This is the all-paths guard** — any residual overlap
in any category (A/B/C) fails it by construction.

Gotcha: the apex sits at fraction 0.45 (and 0.55). `assertTiles` samples 24 interior fractions
`(s+0.5)/24` to avoid the exact 0.5 seam. Confirm none land exactly on 0.45/0.55 (they don't:
0.4375 and 0.4583 bracket 0.45). If a future apex fraction coincides with a sample, widen the
same way the 0.5 seam is handled (comment at ~line 127).

Optional but recommended: a **dev-only runtime assertion** in `computeSectionFill` that runs
the same overlap scan and `console.warn`s (never throws in prod) if any two regions overlap
> ~5 cm. This catches configs no fixture covers (gap-11 and lens×lens were both real-data-only).

---

## 4. TDD sequence (red → green each)

1. **CARVE1** — a single left lens in a quad. After `pf(...)`, assert (a) the matrix region's
   polygon has the notch (a vertex at fraction 0.45 = the apex), and (b) `assertTiles` with
   **no exclusions** passes (matrix-with-notch + lens tile cleanly). RED today (overlay
   overlaps the quad). Implement `carveOverlays` → GREEN.
2. **CARVE2** — lens in a **pinch** (same-side). Assert no overlap + tiles.
3. **CARVE3** — **stacked** lenses on one matrix edge (two lenses at different elevations).
   Assert both notches present, ordered, no overlap.
4. **CARVE4** — lenses on **both** column edges of the same matrix quad. Both notched.
5. **CARVE5** — an **onlap** (apex on a tie-line, not own-mid) carves the same way.
6. **Flip `assertTiles` default to include lenses**, run the WHOLE partition suite. Every
   existing fixture with a lens now validates the full partition. Reconcile only assertions
   that *explicitly* relied on the overlay (e.g. any that checked a lens overlaps its matrix);
   the lens kind/apex/elevation assertions stay (the lens region is unchanged).
7. Overlay test (`PartitionFillOverlay.test.tsx`) green; `tsc -p tsconfig.web.json`;
   `python .claude/skills/strix-section-geometry-check/check_section_geometry.py
   src/renderer/src/utils/partitionFill.ts`.

Pure-module discipline (no IO / Date / random in partitionFill.ts). Node 22 for vitest. Run
tests from `desktop/`.

---

## 5. Real-data verification (the definitive "all paths covered")

Re-run the categorized overlap scan on the three real sections in `C:\Users\robin\Downloads\
test.strix` and expect **0 in EVERY category, including lenses**. Recipe (a throwaway
`.mjs` in `desktop/`, esbuild-bundle `partitionFill.ts`, project columns onto each section
line, `computeSectionFill`, then sample 24 fractions/gap and flag any region-pair overlap
> 0.05 m, categorised by `kind×kind`). The exact harness used to FIND these overlaps is in the
session history (search the transcript for `_oc2.mjs` / `_oc3.mjs`); reuse it but DROP the
`kind !== 'lens'` filter so lenses are included. Before the carve it reports
`{lens×quad: 808, lens×pinch: 250}` on CS1; after, expect `{}`.

Note: the harness needs `test.strix` (not in the repo). Don't commit it. The section-projection
math (project investigations onto `start_x/y → end_x/y`, keep within `projection_buffer_m`,
order by along-distance) is in the harness and mirrors `SectionPanel`'s projection.

---

## 6. Risks & gotchas

- **3D port assumes convex quads (BIGGEST risk).** Carving makes matrix polygons **concave**
  (a notch). The future 3D port (and any current renderer that triangulates the region polygon)
  must handle concave polygons — fan triangulation from vertex 0 will self-overlap on a concave
  ring. Check `PartitionFillOverlay.tsx`'s region `<polygon>`/path rendering: SVG `<polygon>`
  fills a concave ring correctly (even-odd/nonzero), so the 2D render is fine, but **flag the
  3D port explicitly** — it likely needs ear-clipping or to consume the notch. This risk is the
  main argument for Approach B (priority) if the 3D mesh can't take concave input.
- **Onlaps share `kind: 'lens'`** — they're carved by the same code (triangle on a column
  edge). Confirm `buildOnlapPolygon` produces the 2-edge-verts + 1-apex shape (it does).
- **Matrix-finding must be exact.** An overlay must map to the single matrix whose edge-span
  contains it. After the LL1 fix, lenses don't overlap each other, so there's no ambiguity —
  but assert it (the `M = mains.find(...)` should find exactly one; warn if zero or >1 in dev).
- **Keep the overlay regions.** They fill the notches. Only the matrix polygon changes. Lens
  rendering/identity (`bodyId`) is untouched.
- **`pinch` matrices have only one full edge.** A right-side overlay can't carve a left-pinch
  (no frac-1 edge) — but the geometry guarantees they never overlap (left/right halves are
  disjoint), so the matrix-finder will never pair them. Assert defensively.

---

## 7. Files to touch

- `desktop/src/renderer/src/utils/partitionFill.ts` — `carveOverlays` + `insertNotches`
  helpers; call `carveOverlays(regions)` at the end of `emitGap` (before `return regions`).
- `desktop/src/renderer/src/utils/partitionFill.test.ts` — flip `assertTiles` default
  `excludeKinds` to empty; add CARVE1–CARVE5; reconcile overlay-dependent assertions.
- (verify only) `desktop/src/renderer/src/components/sections/PartitionFillOverlay.tsx` —
  confirm concave region polygons render; the existing region `<path>`/`<polygon>` should be
  fine, but eyeball a carved matrix in the app.
- (future) the 3D port — must consume concave matrix polygons or apply Approach-B priority.

## 8. Definition of done
- `carveOverlays` shipped; `assertTiles` includes lenses; CARVE1–5 + all existing partition +
  overlay tests green; tsc + geometry-check clean.
- Real-data scan: **0 overlaps in every `kind×kind` category** on all three `test.strix`
  sections.
- A dogfeed pass on CS1 (the busiest) confirms lenses render as carved (not overlaid) and the
  app still looks right.
- Commit per-file; do NOT push (owner pushes). Update
  `memory/project_partition_fill_pinchout_matrix.md` with an UPDATE note.
