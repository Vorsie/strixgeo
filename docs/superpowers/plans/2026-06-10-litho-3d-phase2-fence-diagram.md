# Litho 3D — Part b, Plan B1: Fence Diagram Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render every cross-section's validated 2D litho partition as coloured vertical walls in the existing Cesium 3D viewer — a "fence diagram" the engineer can rotate to sanity-check ties + correlations before watertight solids are built on top of them.

**Architecture:** Pure client-side. For each section we already have (a) the 2D partition (`computeSectionFill`, `partitionFill.ts`), (b) the section's world endpoints, and (c) each column investigation's along-position. A pure helper projects each partition region polygon from `(gap-fraction, elevation)` into world `(x, y, z)` and triangulates it; `Geology3DViewer` renders the panels as Cesium primitives in a new "Fence" view mode, toggled in `LithologyCanvas`. No backend, no new table.

**Tech Stack:** TypeScript, React, Cesium, Vitest. Reuses `computeSectionFill`, `projectionFoot`/`sectionProjection.ts`, `projectedToWgs84`, and the `buildTinPrimitive` pattern in `Geology3DViewer`.

---

## File Structure

- **Create** `desktop/src/renderer/src/utils/polygonTriangulate.ts` — pure ear-clipping triangulator for a simple (possibly concave) 2D polygon. Concave matters: carved-lens matrix regions are concave.
- **Create** `desktop/src/renderer/src/utils/polygonTriangulate.test.ts`
- **Create** `desktop/src/renderer/src/utils/fencePanels.ts` — pure: project + triangulate partition regions → world-space `FencePanel[]`.
- **Create** `desktop/src/renderer/src/utils/fencePanels.test.ts`
- **Create** `desktop/src/renderer/src/utils/sectionFenceData.ts` — pure: assemble one section's `PartitionColumn[]` + ordered along-list from litho layers + projected investigations (extracted from `PartitionFillOverlay`'s column logic).
- **Create** `desktop/src/renderer/src/utils/sectionFenceData.test.ts`
- **Modify** `desktop/src/renderer/src/shell/stages/geology/Geology3DViewer.tsx` — add an optional `fencePanels` prop + a `buildFencePrimitive` path in `rebuildSurfacePrimitives` (render walls when present).
- **Modify** `desktop/src/renderer/src/shell/stages/lithology/LithologyCanvas.tsx` — Fence/Solid view toggle, gather all sections' panels, pass to the viewer.
- **Create** `desktop/tests/e2e/flow_litho_fence_diagram.spec.ts` — toggle Fence mode on the seeded fixture, assert panels render.

Each task is self-contained: pure helpers (Tasks 1–3) are fully TDD'd; rendering + wiring (Tasks 4–6) mirror existing patterns; e2e is Task 7.

---

## Task 1: Concave-safe 2D polygon triangulation

**Files:**
- Create: `desktop/src/renderer/src/utils/polygonTriangulate.ts`
- Test: `desktop/src/renderer/src/utils/polygonTriangulate.test.ts`

A fence panel is a partition region polygon. Quads/pinches/lenses are convex, but a carved-lens *matrix* region is **concave** (it has a notch), so fan triangulation is wrong. Ear-clipping handles both. We triangulate in the section's 2D plane `(u, v)` and reuse the indices for the 3D verts (the panel is planar).

- [ ] **Step 1: Write the failing test**

```ts
// desktop/src/renderer/src/utils/polygonTriangulate.test.ts
import { describe, expect, it } from 'vitest'
import { triangulatePolygon2D, type Vec2 } from './polygonTriangulate'

/** Total area of a triangle list (shoelace, absolute). */
function triArea(pts: Vec2[], tris: [number, number, number][]): number {
  let a = 0
  for (const [i, j, k] of tris) {
    a += Math.abs(
      (pts[j].x - pts[i].x) * (pts[k].y - pts[i].y) -
        (pts[k].x - pts[i].x) * (pts[j].y - pts[i].y),
    ) / 2
  }
  return a
}

describe('triangulatePolygon2D', () => {
  it('triangulates a convex quad into 2 triangles covering its area', () => {
    const quad: Vec2[] = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 2 },
      { x: 0, y: 2 },
    ]
    const tris = triangulatePolygon2D(quad)
    expect(tris).toHaveLength(2)
    expect(triArea(quad, tris)).toBeCloseTo(8, 6) // 4 × 2
  })

  it('triangulates a CONCAVE polygon (a notched matrix) without covering the notch', () => {
    // A 4×4 square with a triangular notch cut into the right edge — area 16 − 2 = 14.
    const notched: Vec2[] = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 1 },
      { x: 2, y: 2 }, // notch apex (concave vertex)
      { x: 4, y: 3 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
    ]
    const tris = triangulatePolygon2D(notched)
    expect(tris.length).toBe(notched.length - 2) // n−2 triangles for a simple polygon
    expect(triArea(notched, tris)).toBeCloseTo(14, 6) // notch is NOT filled
  })

  it('returns [] for degenerate input (<3 points)', () => {
    expect(triangulatePolygon2D([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toEqual([])
  })
})
```

- [ ] **Step 2: Run it; confirm it fails**

Run: `cd desktop && npx vitest run src/renderer/src/utils/polygonTriangulate.test.ts`
Expected: FAIL — `triangulatePolygon2D` is not defined.

- [ ] **Step 3: Implement the ear-clipping triangulator**

```ts
// desktop/src/renderer/src/utils/polygonTriangulate.ts
/**
 * Pure ear-clipping triangulation of a simple 2D polygon (convex OR concave),
 * given as a ring with no repeated last point. Returns vertex-index triples
 * into the input array. Concave-safe: a carved-lens matrix region has a notch,
 * which fan triangulation would wrongly fill. Winding-agnostic (normalises to
 * CCW internally). Returns [] for fewer than 3 points or a fully-degenerate ring.
 */

/** A point in the section's 2D plane (u = along/fraction axis, v = elevation). */
export interface Vec2 {
  x: number
  y: number
}

/** Signed area × 2 of a ring (> 0 ⇒ counter-clockwise). */
function signedArea2(poly: readonly Vec2[]): number {
  let s = 0
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    s += a.x * b.y - b.x * a.y
  }
  return s
}

/** Is point p inside triangle (a, b, c)? (barycentric sign test, CCW triangle). */
function pointInTriangle(p: Vec2, a: Vec2, b: Vec2, c: Vec2): boolean {
  const d1 = (p.x - b.x) * (a.y - b.y) - (a.x - b.x) * (p.y - b.y)
  const d2 = (p.x - c.x) * (b.y - c.y) - (b.x - c.x) * (p.y - c.y)
  const d3 = (p.x - a.x) * (c.y - a.y) - (c.x - a.x) * (p.y - a.y)
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0
  return !(hasNeg && hasPos)
}

export function triangulatePolygon2D(polygon: readonly Vec2[]): [number, number, number][] {
  const n = polygon.length
  if (n < 3) return []

  // Work on an index list so the returned triples point back into `polygon`.
  // Normalise to CCW so the convex/ear tests below have a consistent sign.
  const ccw = signedArea2(polygon) >= 0
  const idx: number[] = []
  for (let i = 0; i < n; i++) idx.push(ccw ? i : n - 1 - i)

  const triangles: [number, number, number][] = []
  let guard = 0
  const maxGuard = n * n + 10 // ear-clipping terminates in ≤ n−2 clips; bound defensively
  while (idx.length > 3 && guard++ < maxGuard) {
    let clipped = false
    for (let i = 0; i < idx.length; i++) {
      const iPrev = idx[(i - 1 + idx.length) % idx.length]
      const iCur = idx[i]
      const iNext = idx[(i + 1) % idx.length]
      const a = polygon[iPrev]
      const b = polygon[iCur]
      const c = polygon[iNext]
      // Convex corner? (CCW cross > 0). Skip reflex corners.
      const cross = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)
      if (cross <= 0) continue
      // No other vertex inside the candidate ear?
      let containsOther = false
      for (let j = 0; j < idx.length; j++) {
        const k = idx[j]
        if (k === iPrev || k === iCur || k === iNext) continue
        if (pointInTriangle(polygon[k], a, b, c)) {
          containsOther = true
          break
        }
      }
      if (containsOther) continue
      triangles.push([iPrev, iCur, iNext])
      idx.splice(i, 1)
      clipped = true
      break
    }
    if (!clipped) break // degenerate / self-touching ring — stop with what we have
  }
  if (idx.length === 3) triangles.push([idx[0], idx[1], idx[2]])
  return triangles
}
```

- [ ] **Step 4: Run it; confirm it passes**

Run: `cd desktop && npx vitest run src/renderer/src/utils/polygonTriangulate.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Type-check**

Run: `cd desktop && npx tsc --noEmit -p tsconfig.web.json`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add desktop/src/renderer/src/utils/polygonTriangulate.ts desktop/src/renderer/src/utils/polygonTriangulate.test.ts
git commit -m "feat(litho-3d): concave-safe 2D polygon triangulator for fence panels"
```

---

## Task 2: Project partition regions into world-space fence panels

**Files:**
- Create: `desktop/src/renderer/src/utils/fencePanels.ts`
- Test: `desktop/src/renderer/src/utils/fencePanels.test.ts`

Each `SectionRegion` from `computeSectionFill` lives in `(gap-fraction, elevation)`. For gap `gapIndex` the bounding columns are `orderedColumns[gapIndex]` (left) and `[gapIndex+1]` (right), each with an `alongM`. We map `fraction → along` linearly, `projectionFoot(section, along) → world (x, y)`, `elevation → z`, then triangulate in `(along, elevation)`.

- [ ] **Step 1: Write the failing test**

```ts
// desktop/src/renderer/src/utils/fencePanels.test.ts
import { describe, expect, it } from 'vitest'
import { buildFencePanels, type FenceColumn, type FenceRegion } from './fencePanels'

// A horizontal section: start (0,0) → end (100,0), so along == world x, world y == 0.
const section = { start_x: 0, start_y: 0, end_x: 100, end_y: 0 }

describe('buildFencePanels', () => {
  it('projects a quad region into a vertical wall panel in world space', () => {
    const columns: FenceColumn[] = [
      { investigationId: 'L', alongM: 0 },
      { investigationId: 'R', alongM: 100 },
    ]
    const regions: FenceRegion[] = [
      {
        formationId: 'ZAND',
        bodyId: 'b1',
        gapIndex: 0,
        polygon: [
          { fraction: 0, elevation: 5 },
          { fraction: 1, elevation: 5 },
          { fraction: 1, elevation: 0 },
          { fraction: 0, elevation: 0 },
        ],
      },
    ]
    const panels = buildFencePanels(section, columns, regions)
    expect(panels).toHaveLength(1)
    expect(panels[0].formationId).toBe('ZAND')
    expect(panels[0].bodyId).toBe('b1')
    // Vertices in project CRS [x, y, elevation]: fraction 0→x0, fraction 1→x100, y always 0.
    const xs = panels[0].vertices.map((v) => v[0]).sort((a, b) => a - b)
    expect(xs[0]).toBeCloseTo(0, 6)
    expect(xs[xs.length - 1]).toBeCloseTo(100, 6)
    expect(panels[0].vertices.every((v) => Math.abs(v[1]) < 1e-6)).toBe(true) // y == 0
    const zs = panels[0].vertices.map((v) => v[2])
    expect(Math.min(...zs)).toBeCloseTo(0, 6)
    expect(Math.max(...zs)).toBeCloseTo(5, 6)
    expect(panels[0].triangles).toHaveLength(2) // quad → 2 triangles
  })

  it('places the gap-midpoint (fraction 0.5) halfway between the two columns', () => {
    const columns: FenceColumn[] = [
      { investigationId: 'L', alongM: 20 },
      { investigationId: 'R', alongM: 60 },
    ]
    const regions: FenceRegion[] = [
      {
        formationId: 'KLEI',
        bodyId: null,
        gapIndex: 0,
        polygon: [
          { fraction: 0, elevation: 1 },
          { fraction: 0.5, elevation: 1 }, // midpoint apex
          { fraction: 0, elevation: -1 },
        ],
      },
    ]
    const panels = buildFencePanels(section, columns, regions)
    const apex = panels[0].vertices.find((v) => Math.abs(v[2] - 1) < 1e-6 && v[0] > 20.001)!
    expect(apex[0]).toBeCloseTo(40, 6) // along 20 + 0.5*(60−20) = 40
  })

  it('skips a region whose gapIndex has no bounding column pair', () => {
    const columns: FenceColumn[] = [{ investigationId: 'L', alongM: 0 }]
    const regions: FenceRegion[] = [
      { formationId: 'ZAND', bodyId: null, gapIndex: 0, polygon: [
        { fraction: 0, elevation: 1 }, { fraction: 1, elevation: 1 }, { fraction: 0, elevation: 0 },
      ] },
    ]
    expect(buildFencePanels(section, columns, regions)).toEqual([]) // no column at index 1
  })
})
```

- [ ] **Step 2: Run it; confirm it fails**

Run: `cd desktop && npx vitest run src/renderer/src/utils/fencePanels.test.ts`
Expected: FAIL — `buildFencePanels` not defined.

- [ ] **Step 3: Implement**

```ts
// desktop/src/renderer/src/utils/fencePanels.ts
import type { PartitionPoint } from './partitionFill'
import { triangulatePolygon2D, type Vec2 } from './polygonTriangulate'
import { projectionFoot, type SectionEndpoints } from './sectionProjection'

/** One section column: an investigation and its along-section position (metres). */
export interface FenceColumn {
  investigationId: string
  alongM: number
}

/** A partition region carrying which gap (column pair) it sits in. */
export interface FenceRegion {
  formationId: string
  bodyId: string | null
  /** Index of the LEFT bounding column in the ordered column list. */
  gapIndex: number
  /** Polygon in (gap-fraction 0..1, absolute elevation mTAW). */
  polygon: readonly PartitionPoint[]
}

/**
 * One filled wall panel of the fence, in project CRS.
 *
 * ``vertices`` are ``[x_m, y_m, elevation_m]`` (same convention as
 * ``FormationSurfaceResponse.vertices``); ``triangles`` index into them.
 */
export interface FencePanel {
  formationId: string
  bodyId: string | null
  vertices: [number, number, number][]
  triangles: [number, number, number][]
}

/**
 * Project each partition region into a world-space wall panel.
 *
 * For region in gap ``g``: the left column is ``orderedColumns[g]`` and the right
 * is ``orderedColumns[g+1]``. A polygon point's ``fraction`` maps linearly to an
 * along-section distance between the two columns; ``projectionFoot`` turns that
 * into world ``(x, y)``; ``elevation`` is the z. Triangulation runs in the
 * section's 2D plane ``(along, elevation)`` (concave-safe) and the indices are
 * reused for the 3D vertices, which is valid because the panel is planar.
 *
 * Parameters
 * ----------
 * section : SectionEndpoints
 *     The section's world endpoints (start/end x,y in project CRS).
 * orderedColumns : readonly FenceColumn[]
 *     Columns left→right with their along positions (same order fed to
 *     ``computeSectionFill``).
 * regions : readonly FenceRegion[]
 *     Partition regions from ``computeSectionFill`` (carry ``gapIndex``).
 *
 * Returns
 * -------
 * FencePanel[]
 *     One panel per region that has a valid bounding column pair and ≥3 vertices.
 */
export function buildFencePanels(
  section: SectionEndpoints,
  orderedColumns: readonly FenceColumn[],
  regions: readonly FenceRegion[],
): FencePanel[] {
  const panels: FencePanel[] = []
  for (const region of regions) {
    const left = orderedColumns[region.gapIndex]
    const right = orderedColumns[region.gapIndex + 1]
    if (!left || !right) continue

    const plane: Vec2[] = []
    const vertices: [number, number, number][] = []
    let ok = true
    for (const p of region.polygon) {
      const along = left.alongM + p.fraction * (right.alongM - left.alongM)
      const foot = projectionFoot(section, along)
      if (!foot) {
        ok = false
        break
      }
      vertices.push([foot.x, foot.y, p.elevation])
      plane.push({ x: along, y: p.elevation })
    }
    if (!ok || vertices.length < 3) continue

    const triangles = triangulatePolygon2D(plane)
    if (triangles.length === 0) continue
    panels.push({
      formationId: region.formationId,
      bodyId: region.bodyId,
      vertices,
      triangles,
    })
  }
  return panels
}
```

> **Note on `SectionRegion` field name:** `computeSectionFill` returns regions carrying a gap index. Confirm the exact field (`gapIndex`) in `partitionFill.ts`'s `SectionRegion` type and adapt the `FenceRegion` mapping in Task 4 if the name differs (e.g. `gap`). The pure helper here takes the normalised `FenceRegion` shape, so only the Task-4 adapter changes.

- [ ] **Step 4: Run it; confirm it passes**

Run: `cd desktop && npx vitest run src/renderer/src/utils/fencePanels.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Type-check + commit**

Run: `cd desktop && npx tsc --noEmit -p tsconfig.web.json` (expect exit 0)

```bash
git add desktop/src/renderer/src/utils/fencePanels.ts desktop/src/renderer/src/utils/fencePanels.test.ts
git commit -m "feat(litho-3d): project partition regions into world-space fence panels"
```

---

## Task 3: Assemble one section's partition input (columns + along list)

**Files:**
- Create: `desktop/src/renderer/src/utils/sectionFenceData.ts`
- Test: `desktop/src/renderer/src/utils/sectionFenceData.test.ts`

`PartitionFillOverlay.tsx` (lines ~533–571) builds `PartitionColumn[]` from accepted litho layers + placed columns. Extract that into a pure helper so the fence (which needs it for *every* section) and the overlay can share it. The helper also returns the `FenceColumn[]` (ordered investigationId + alongM) the projection needs.

- [ ] **Step 1: Write the failing test**

```ts
// desktop/src/renderer/src/utils/sectionFenceData.test.ts
import { describe, expect, it } from 'vitest'
import { assembleSectionPartitionInput, type FenceLayerInput, type FenceProjectedColumn } from './sectionFenceData'

const projected: FenceProjectedColumn[] = [
  { investigationId: 'A', alongM: 10, surfaceElevM: 12 },
  { investigationId: 'B', alongM: 50, surfaceElevM: 13 },
]
const layers: FenceLayerInput[] = [
  { investigationId: 'A', layerId: 'a1', formationId: 'ZAND', bodyId: 'z', topDepthM: 0, baseDepthM: 2, accepted: true },
  { investigationId: 'A', layerId: 'a2', formationId: 'KLEI', bodyId: null, topDepthM: 2, baseDepthM: 5, accepted: true },
  { investigationId: 'B', layerId: 'b1', formationId: 'ZAND', bodyId: 'z', topDepthM: 0, baseDepthM: 4, accepted: true },
  { investigationId: 'B', layerId: 'bX', formationId: 'KLEI', bodyId: null, topDepthM: 4, baseDepthM: 6, accepted: false }, // dropped
]

describe('assembleSectionPartitionInput', () => {
  it('builds ordered PartitionColumns from accepted layers + projected columns', () => {
    const { columns, orderedColumns } = assembleSectionPartitionInput(projected, layers)
    expect(orderedColumns.map((c) => c.investigationId)).toEqual(['A', 'B']) // sorted by alongM
    expect(orderedColumns[0].alongM).toBe(10)
    expect(columns).toHaveLength(2)
    const colA = columns.find((c) => c.investigationId === 'A')!
    expect(colA.surfaceElevM).toBe(12)
    expect(colA.units.map((u) => u.formationId)).toEqual(['ZAND', 'KLEI']) // sorted shallow→deep
    expect(colA.units[0].layerId).toBe('a1')
  })

  it('drops non-accepted layers and columns with no accepted layers', () => {
    const { columns } = assembleSectionPartitionInput(projected, [layers[3]]) // only B's rejected layer
    expect(columns).toEqual([])
  })

  it('drops a projected column whose surface elevation is null', () => {
    const noElev: FenceProjectedColumn[] = [{ investigationId: 'A', alongM: 10, surfaceElevM: null }]
    const { columns } = assembleSectionPartitionInput(noElev, layers)
    expect(columns).toEqual([])
  })
})
```

- [ ] **Step 2: Run it; confirm it fails**

Run: `cd desktop && npx vitest run src/renderer/src/utils/sectionFenceData.test.ts`
Expected: FAIL — `assembleSectionPartitionInput` not defined.

- [ ] **Step 3: Implement**

```ts
// desktop/src/renderer/src/utils/sectionFenceData.ts
import type { FenceColumn } from './fencePanels'
import type { PartitionColumn, PartitionUnit } from './partitionFill'

/** A projected investigation column on a section (output of investigationsOnSection + elevation). */
export interface FenceProjectedColumn {
  investigationId: string
  alongM: number
  surfaceElevM: number | null
}

/** An accepted-or-not litho layer keyed to an investigation. */
export interface FenceLayerInput {
  investigationId: string
  layerId: string
  formationId: string
  bodyId: string | null
  topDepthM: number
  baseDepthM: number
  accepted: boolean
}

/**
 * Build the ordered ``PartitionColumn[]`` (input to ``computeSectionFill``) plus
 * the matching ``FenceColumn[]`` (investigationId + alongM) for one section.
 *
 * Mirrors the column assembly in ``PartitionFillOverlay`` but pure + reusable:
 * keeps only accepted layers, drops columns with no accepted layers or a null
 * surface elevation, sorts columns by along-position and each column's units
 * shallow→deep.
 *
 * Parameters
 * ----------
 * projectedColumns : readonly FenceProjectedColumn[]
 *     Investigations projected onto the section (any order).
 * layers : readonly FenceLayerInput[]
 *     Litho layers across the project (filtered to these columns internally).
 *
 * Returns
 * -------
 * { columns: PartitionColumn[]; orderedColumns: FenceColumn[] }
 *     ``columns`` and ``orderedColumns`` share the same order (left→right by along).
 */
export function assembleSectionPartitionInput(
  projectedColumns: readonly FenceProjectedColumn[],
  layers: readonly FenceLayerInput[],
): { columns: PartitionColumn[]; orderedColumns: FenceColumn[] } {
  const unitsByInv = new Map<string, PartitionUnit[]>()
  for (const layer of layers) {
    if (!layer.accepted) continue
    const unit: PartitionUnit = {
      topDepthM: layer.topDepthM,
      baseDepthM: layer.baseDepthM,
      formationId: layer.formationId,
      bodyId: layer.bodyId,
      layerId: layer.layerId,
    }
    const bucket = unitsByInv.get(layer.investigationId)
    if (bucket) bucket.push(unit)
    else unitsByInv.set(layer.investigationId, [unit])
  }

  const ordered = [...projectedColumns].sort((a, b) => a.alongM - b.alongM)
  const columns: PartitionColumn[] = []
  const orderedColumns: FenceColumn[] = []
  for (const col of ordered) {
    if (col.surfaceElevM === null) continue
    const units = (unitsByInv.get(col.investigationId) ?? [])
      .slice()
      .sort((a, b) => a.topDepthM - b.topDepthM)
    if (units.length === 0) continue
    columns.push({ investigationId: col.investigationId, surfaceElevM: col.surfaceElevM, units })
    orderedColumns.push({ investigationId: col.investigationId, alongM: col.alongM })
  }
  return { columns, orderedColumns }
}
```

- [ ] **Step 4: Run it; confirm it passes + type-check + commit**

Run: `cd desktop && npx vitest run src/renderer/src/utils/sectionFenceData.test.ts` (expect PASS)
Run: `cd desktop && npx tsc --noEmit -p tsconfig.web.json` (expect exit 0)

```bash
git add desktop/src/renderer/src/utils/sectionFenceData.ts desktop/src/renderer/src/utils/sectionFenceData.test.ts
git commit -m "feat(litho-3d): pure section partition-input assembler for the fence"
```

---

## Task 4: All-sections fence assembly (glue)

**Files:**
- Create: `desktop/src/renderer/src/utils/buildProjectFence.ts`
- Test: `desktop/src/renderer/src/utils/buildProjectFence.test.ts`

Combine Tasks 2+3 + `computeSectionFill` over every section: for each section, project its investigations (`investigationsOnSection`), assemble the partition input, run `computeSectionFill`, normalise each region to `FenceRegion`, and `buildFencePanels`. Returns a flat `FencePanel[]` for the whole project fence.

- [ ] **Step 1: Confirm the region field name + edge type.** Open `partitionFill.ts` and read the `computeSectionFill` signature + the `SectionRegion` type it returns. Note the exact gap-index field name and the `edges` argument type. Open `api/clients/` to find the call that lists a section's approved correlation edges (per CLAUDE.md: `listCorrelations`). Record both — they parameterise the adapter below.

- [ ] **Step 2: Write the failing test** (mock `computeSectionFill` indirectly by feeding a one-section project with two columns + a through-going body so a panel comes out)

```ts
// desktop/src/renderer/src/utils/buildProjectFence.test.ts
import { describe, expect, it } from 'vitest'
import { buildProjectFence, type FenceSectionInput } from './buildProjectFence'

// One horizontal section, two columns, one through-going ZAND body correlated
// across them (shared bodyId ⇒ a band) → expect ≥1 ZAND panel spanning the gap.
const input: FenceSectionInput[] = [
  {
    section: { start_x: 0, start_y: 0, end_x: 100, end_y: 0 },
    projectedColumns: [
      { investigationId: 'A', alongM: 0, surfaceElevM: 10 },
      { investigationId: 'B', alongM: 100, surfaceElevM: 10 },
    ],
    layers: [
      { investigationId: 'A', layerId: 'a1', formationId: 'ZAND', bodyId: 'z', topDepthM: 0, baseDepthM: 5, accepted: true },
      { investigationId: 'B', layerId: 'b1', formationId: 'ZAND', bodyId: 'z', topDepthM: 0, baseDepthM: 5, accepted: true },
    ],
    edges: [{ a: 'a1', b: 'b1' }],
  },
]

describe('buildProjectFence', () => {
  it('produces fence panels spanning the gap for a correlated through-going body', () => {
    const panels = buildProjectFence(input)
    expect(panels.length).toBeGreaterThan(0)
    const zand = panels.filter((p) => p.formationId === 'ZAND')
    expect(zand.length).toBeGreaterThan(0)
    const xs = zand.flatMap((p) => p.vertices.map((v) => v[0]))
    expect(Math.min(...xs)).toBeCloseTo(0, 4)
    expect(Math.max(...xs)).toBeCloseTo(100, 4)
  })

  it('returns [] for a project with no sections', () => {
    expect(buildProjectFence([])).toEqual([])
  })
})
```

- [ ] **Step 3: Implement** (adapt `computeSectionFill`'s region field name from Step 1)

```ts
// desktop/src/renderer/src/utils/buildProjectFence.ts
import { buildFencePanels, type FencePanel, type FenceRegion } from './fencePanels'
import { computeSectionFill, type CorrelationEdge } from './partitionFill'
import { assembleSectionPartitionInput, type FenceLayerInput, type FenceProjectedColumn } from './sectionFenceData'
import type { SectionEndpoints } from './sectionProjection'

/** Everything needed to fence one section. */
export interface FenceSectionInput {
  section: SectionEndpoints
  projectedColumns: readonly FenceProjectedColumn[]
  layers: readonly FenceLayerInput[]
  edges: readonly CorrelationEdge[]
}

/**
 * Build the whole-project fence: one set of wall panels per section, flattened.
 *
 * For each section: assemble the partition input (accepted layers + ordered
 * columns), run ``computeSectionFill`` with that section's approved edges,
 * normalise each region to a ``FenceRegion`` (carrying its gap index), and
 * project to world-space panels. Sections with <2 columns yield nothing.
 */
export function buildProjectFence(sections: readonly FenceSectionInput[]): FencePanel[] {
  const all: FencePanel[] = []
  for (const s of sections) {
    const { columns, orderedColumns } = assembleSectionPartitionInput(s.projectedColumns, s.layers)
    if (columns.length < 2) continue
    const regions = computeSectionFill(columns, s.edges)
    const fenceRegions: FenceRegion[] = regions.map((r) => ({
      formationId: r.formationId,
      bodyId: r.bodyId,
      // NOTE: confirm the gap-index field name on SectionRegion (Step 1) — adapt here.
      gapIndex: r.gapIndex,
      polygon: r.polygon,
    }))
    all.push(...buildFencePanels(s.section, orderedColumns, fenceRegions))
  }
  return all
}
```

- [ ] **Step 4: Run it; confirm it passes + type-check + commit**

Run: `cd desktop && npx vitest run src/renderer/src/utils/buildProjectFence.test.ts` (expect PASS)
Run: `cd desktop && npx tsc --noEmit -p tsconfig.web.json` (expect exit 0)

```bash
git add desktop/src/renderer/src/utils/buildProjectFence.ts desktop/src/renderer/src/utils/buildProjectFence.test.ts
git commit -m "feat(litho-3d): assemble whole-project fence panels across sections"
```

---

## Task 5: Render fence panels in Geology3DViewer

**Files:**
- Modify: `desktop/src/renderer/src/shell/stages/geology/Geology3DViewer.tsx`

Add an optional `fencePanels?: FencePanel[]` prop. When present and non-empty, build one Cesium primitive per panel (mirror `buildTinPrimitive`: convert each `[x,y,z]` via `projectedToWgs84` + `Cesium.Cartesian3.fromDegrees`, build a `Cesium.Geometry` from positions + the panel's triangle indices, wrap in a `Primitive` with `PerInstanceColorAppearance`). Colour each panel by its formation's colour (same lookup the surface path uses). Add the panels in `rebuildSurfacePrimitives` after the ground surface. Panels are vertical, double-sided — set the appearance so back-faces render (`appearance` with `renderState` cull off, or emit both winding orders).

- [ ] **Step 1: Add the prop + colour map.** In `Geology3DViewerProps`, add `fencePanels?: FencePanel[]` (import `FencePanel` from `../../../utils/fencePanels`). The colour per panel: reuse the existing formation-colour parse (`Cesium.Color.fromCssColorString(formation.color)`), keyed by `panel.formationId` against the `formations` prop; fall back to `Cesium.Color.GRAY`.

- [ ] **Step 2: Add `buildFencePrimitive`.** Next to `buildTinPrimitive`, add a function with the same vertex→Cartesian conversion that takes `(panel: FencePanel, color, projectEpsg)` and returns a `Cesium.Primitive` (positions from `panel.vertices`, indices flattened from `panel.triangles`). Reuse the exact `projectedToWgs84` + `Cesium.Cartesian3.fromDegrees(lng, lat, z)` calls from `buildTinPrimitive`. Use `PerInstanceColorAppearance({ flat: true, translucent: true })` and a `renderState` that disables back-face culling so the wall is visible from both sides.

- [ ] **Step 3: Render in `rebuildSurfacePrimitives`.** After the ground-surface block and before the formation TINs, add:

```ts
// Fence diagram: vertical wall panels of the 2D partition (litho only).
if (fencePanels && fencePanels.length > 0) {
  for (const panel of fencePanels) {
    const color =
      Cesium.Color.fromCssColorString(
        formations.find((f) => f.id === panel.formationId)?.color ?? '',
      ) ?? Cesium.Color.GRAY
    const prim = buildFencePrimitive(panel, color, projectEpsg)
    if (prim) scene.primitives.add(prim)
  }
}
```

Thread `fencePanels` through to `rebuildSurfacePrimitives` (add it to the call sites + the function signature, default `undefined`), and add `fencePanels` to the effect dependency list that triggers `rebuildSurfacePrimitives` so toggling re-renders.

- [ ] **Step 4: Type-check + smoke-render.**

Run: `cd desktop && npx tsc --noEmit -p tsconfig.web.json` (expect exit 0)
Run: `cd desktop && npx vitest run` (expect the full suite still green — no existing test imports `fencePanels`).

- [ ] **Step 5: Commit**

```bash
git add desktop/src/renderer/src/shell/stages/geology/Geology3DViewer.tsx
git commit -m "feat(litho-3d): render fence-diagram wall panels in Geology3DViewer"
```

---

## Task 6: Fence/Solid toggle + data gathering in LithologyCanvas

**Files:**
- Modify: `desktop/src/renderer/src/shell/stages/lithology/LithologyCanvas.tsx`

Add a permanent **Fence / Solid** view toggle (local state, mirror the `splitMode` pattern). In Fence mode, gather every section's `FenceSectionInput` and pass `buildProjectFence(...)` to the viewer as `fencePanels`; in Solid mode pass `undefined` (today's surface render). Gather inputs from: `api.section.list(projectId)` (all sections), `api.cpt.list` + `api.borehole.list` (investigation coords + elevations), the litho layers already available for the active model, and each section's approved edges (`listCorrelations` per section — confirmed in Task 4 Step 1). Use `investigationsOnSection(section, investigations, excludedIds)` to project + filter, and `projectionFoot`-based `alongM` from each `ProjectedInvestigation.along`.

- [ ] **Step 1: Add the toggle.** Add `const [viewMode, setViewMode] = useState<'fence' | 'solid'>('solid')` and a small segmented control in the litho 3D pane toolbar (mirror the split-mode control). Label: "Fence" / "Solid". Add `data-testid="litho-view-mode-fence"` / `"litho-view-mode-solid"` for e2e.

- [ ] **Step 2: Gather fence inputs (memoised).** Build `FenceSectionInput[]` from sections + investigations + layers + per-section edges. Litho layers carry `cpt_id ?? borehole_id` → `investigationId`, `status === 'accepted'` → `accepted`, and `depth_top_m/depth_base_m/formation_id/body_id/id`. Investigation `elevation_m` → `surfaceElevM`. `investigationsOnSection(...).along` → `alongM`. Edges: map each `{contact_a_id, contact_b_id}` → `{a, b}`. Guard: only build when `viewMode === 'fence'` (avoid the cost in solid mode).

- [ ] **Step 3: Pass to the viewer.** `fencePanels={viewMode === 'fence' ? buildProjectFence(fenceInputs) : undefined}`. Keep `surfacesByFormationId` as-is so Solid mode is unchanged. When fence panels are present, the viewer shows walls; when undefined, surfaces.

- [ ] **Step 4: Type-check + test.**

Run: `cd desktop && npx tsc --noEmit -p tsconfig.web.json` (expect exit 0)
Run: `cd desktop && npx vitest run` (expect green)

- [ ] **Step 5: Commit**

```bash
git add desktop/src/renderer/src/shell/stages/lithology/LithologyCanvas.tsx
git commit -m "feat(litho-3d): Fence/Solid toggle + whole-project fence assembly in LithologyCanvas"
```

---

## Task 7: e2e — toggle Fence mode on the seeded fixture

**Files:**
- Create: `desktop/tests/e2e/flow_litho_fence_diagram.spec.ts`

The seeded fixture has a litho model with accepted layers + correlations. Open the litho 3D stage, switch to Fence mode, assert the Cesium canvas renders without error and the toggle reflects fence mode. (Geometry correctness is covered by the unit tests; e2e guards the wiring + no-crash.)

- [ ] **Step 1: Write the spec** (mirror an existing 3D-stage e2e; navigate to the lithology stage, click `litho-view-mode-fence`, assert the canvas is present and no error toast).

```ts
// desktop/tests/e2e/flow_litho_fence_diagram.spec.ts
import { test, expect } from './fixtures' // reuse the project's e2e harness
// ... open project, go to Lithology 3D stage, click [data-testid="litho-view-mode-fence"],
// assert the cesium canvas is visible and stays mounted (no error overlay).
```

- [ ] **Step 2: Run it**

Run: `cd desktop && .\scripts\run-e2e.ps1 flow_litho_fence_diagram` (close the dev app first — port 8765)
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add desktop/tests/e2e/flow_litho_fence_diagram.spec.ts
git commit -m "test(litho-3d): e2e Fence-mode toggle renders the fence diagram"
```

---

## Self-Review

- **Spec coverage:** This plan implements spec §11.3 Milestone 1 (fence diagram, client-side, permanent Fence/Solid toggle) in full. Milestones 2–3 (solids, lenses) are explicitly out of this plan (§11.5 — they follow a builder spike).
- **Type consistency:** `FencePanel` (vertices/triangles) is defined in `fencePanels.ts` and consumed unchanged in Tasks 4–6. `FenceColumn`/`FenceRegion`/`FenceProjectedColumn`/`FenceLayerInput`/`FenceSectionInput` are each defined once and reused. `assembleSectionPartitionInput` is named identically across Tasks 3–4.
- **Known confirm-points (flagged inline, not placeholders):** the `SectionRegion` gap-index field name and the `listCorrelations` client signature are verified in Task 4 Step 1 before use — both are reads of existing code, recorded once, then applied. Everything downstream of them is concrete.
- **No backend:** confirmed — fence is pure client; no migration, no API, no ORM.

---

## Execution Handoff

Plan complete. Two execution options:

1. **Subagent-Driven (recommended)** — a fresh subagent per task, two-stage review between tasks (matches how Phase 1/1b were built).
2. **Inline Execution** — execute in this session with checkpoints.

After B1 lands and the fence view de-risks the viewer path, the next step is a short **builder spike** (prototype `body_between_surfaces` + `lens_carve` on a synthetic two-section fence) → then **Plan B2** (solids, spec milestones 2–3).
