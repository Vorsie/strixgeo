/**
 * SVG overlay that fills the litho section as a TRUE PARTITION between adjacent
 * columns (``utils/partitionFill``) — every point belongs to exactly one body,
 * with NO overlaps and NO empty spaces (owner directive 2026-06-05: the 2D
 * section defines the 3D model, so an overlap/gap in 2D becomes one in 3D).
 *
 * Replaces ``MorphFillOverlay`` (which painted per-body envelope bands then
 * overpainted pinch triangles with z-order — a visual fake-partition whose
 * envelopes overlapped and whose pinch/band mismatches left gaps). Here each
 * adjacent gap is tiled by ``computePartitionFill``: a monotonic alignment of
 * the two columns' unit stacks emits regions bounded by SHARED interfaces, so
 * an interrupted body renders as its real pieces (a matched quad + a separate
 * pinch) and the tiling is structurally hole-free + overlap-free.
 *
 * Two independent drag gestures live here:
 *
 * 1. **Lens-apex drag** (amber handle, ``ApexDrag``): shapes the pinch point of
 *    an enclosed lens (one-column body). Stores the apex in ``upper_nodes``
 *    (left lens) or ``lower_nodes`` (right lens) on the LENS body.
 *
 * 2. **Matched-boundary drag** (slate/blue handle, ``BoundaryDrag``): moves the
 *    shared boundary between two CONSECUTIVE MAIN regions (kind ``'quad'`` or
 *    ``'pinch'``, NOT ``'lens'``) in the same gap. Dragging it inserts a single
 *    control point into BOTH polygons on the shared edge so the fill remains a
 *    true partition after the bend. Stores the control point in ``lower_nodes``
 *    on the UPPER body — safe because an upper body in a matched pair is a
 *    two-column body, never a lens, so its ``lower_nodes`` are otherwise unused
 *    by the lens-apex code path.
 */

import { useEffect, useMemo, useRef, useState } from 'react'

import type { BodyBoundaryNode, BodyListItem, LithoLayerResponse } from '../../api/client'
import {
  computePartitionFill,
  type LensApexOverride,
  type MorphColumn,
  type MorphUnit,
  type PartitionRegion,
} from '../../utils/partitionFill'
import type { Props } from './MorphFillOverlay'
import type { PlacedColumn } from './utils'

const FILL_OPACITY = 0.62
// A lens (one-test body enclosed in a matrix) is drawn a touch more solid so it
// reads as a unit CUT OUT of the continuous matrix it sits on, not a faint wash.
const LENS_OPACITY = 0.85
const STROKE_OPACITY = 0.45
const FALLBACK_COLOR = '#888888'
const EDGE_STUB_PX = 64
const OPEN_END_M = 5
/** Minimum on-screen region height (px) to carry a label legibly. */
const LABEL_MIN_H = 14
// Lens-apex drag handle radius + its transparent hit halo.
const APEX_R = 5
const APEX_HIT_R = 11
// Matched-boundary drag handle — distinct colour from the amber lens apex so
// the two gestures are visually independent.
const BOUNDARY_R = 3
const BOUNDARY_HIT_R = 10
const BOUNDARY_COLOR = '#38bdf8' // sky-400 (slate/blue)

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x))

interface ColumnScreen {
  rightX: number
  leftX: number
  along: number
}

/** A live lens-apex drag. ``side`` 'left' = lens on the left column (wedges
 *  right, stored in upper_nodes); 'right' = lens on the right column. */
interface ApexDrag {
  bodyId: string
  side: 'left' | 'right'
  x: number
  y: number
}

/**
 * A live matched-boundary drag: the shared edge between the upper body (above)
 * and the lower body (below) within the same gap.
 *
 * ``minY`` / ``maxY`` are the clamp bounds — the upper body's top y (minY,
 * smallest screen-y = highest elevation) and the lower body's base y (maxY,
 * largest screen-y = deepest elevation).  These keep the drag from crossing a
 * neighbour body and ensure both the upper and lower bodies keep >0 thickness.
 */
interface BoundaryDrag {
  upperBodyId: string
  lowerBodyId: string
  /** Screen x of the drag cursor. */
  x: number
  /** Screen y of the drag cursor, clamped to [minY, maxY]. */
  y: number
  /** Minimum screen-y allowed (= upper body's top elevation in screen coords). */
  minY: number
  /** Maximum screen-y allowed (= lower body's base elevation in screen coords). */
  maxY: number
  /** This gap's screen x-edges — used to splice the control node by along range
   *  on save so shaping one gap doesn't wipe a sibling gap's bend. */
  leftX: number
  rightX: number
}

/** A region already mapped to screen polygon points, tagged with its gap edges. */
interface ScreenRegion {
  region: PartitionRegion
  points: { x: number; y: number }[]
  leftX: number
  rightX: number
  minX: number
  maxX: number
  minY: number
  maxY: number
}

/**
 * One shared boundary between two consecutive main (non-lens) regions in the
 * same gap.  Carries the information needed to render + drag its handle.
 */
interface SharedBoundary {
  upperBodyId: string
  lowerBodyId: string
  /** Index of the upper region in ``screenRegions``. */
  upperIdx: number
  /** Index of the lower region in ``screenRegions``. */
  lowerIdx: number
  /** Natural midpoint of the shared edge in screen coords (no override). */
  naturalX: number
  naturalY: number
  /** Resolved control-point x (live drag or stored node, else ``naturalX``). */
  cpX: number
  /** Resolved control-point y (live drag or stored node, else ``naturalY``). */
  cpY: number
  /** Screen-y clamp bounds (upper body's top y and lower body's base y). */
  minY: number
  maxY: number
  leftX: number
  rightX: number
}

/** Render the partition fill (+ labels, open-end stubs, context menu). */
export default function PartitionFillOverlay({
  lithoLayers,
  placedColumns,
  formationColorById,
  formationLabelById,
  showBands,
  levelToScreen,
  plotTop,
  plotBottom,
  plotLeft,
  plotRight,
  alongToScreenX,
  screenXToAlong,
  screenToLevel,
  boundariesByBodyId,
  onSaveBoundary,
  bodies,
  onBodyContextMenu,
}: Props): JSX.Element {
  const rootRef = useRef<SVGGElement>(null)
  const [drag, setDrag] = useState<ApexDrag | null>(null)
  const [boundaryDrag, setBoundaryDrag] = useState<BoundaryDrag | null>(null)
  const bodyById = useMemo(() => new Map((bodies ?? []).map((b) => [b.id, b])), [bodies])

  // Lens-apex drag: live-track the apex, persist the shape on mouse-up. The
  // apex is stored on the body's boundary (upper_nodes = right-wedging / left
  // lens, lower_nodes = left-wedging / right lens), reusing the same store the
  // morph apex used so a shaped lens survives a reload.
  useEffect(() => {
    if (!drag) return
    const svg = rootRef.current?.ownerSVGElement
    const move = (e: MouseEvent): void => {
      const rect = svg?.getBoundingClientRect()
      setDrag({
        bodyId: drag.bodyId,
        side: drag.side,
        x: e.clientX - (rect?.left ?? 0),
        y: e.clientY - (rect?.top ?? 0),
      })
    }
    const up = (): void => {
      if (onSaveBoundary && screenXToAlong && screenToLevel) {
        const apex: BodyBoundaryNode = {
          along_m: screenXToAlong(drag.x),
          elevation_m: screenToLevel(drag.y),
        }
        const existing = boundariesByBodyId?.get(drag.bodyId)
        const upper = drag.side === 'left' ? [apex] : (existing?.upper_nodes ?? [])
        const lower = drag.side === 'right' ? [apex] : (existing?.lower_nodes ?? [])
        onSaveBoundary(drag.bodyId, upper, lower, 'straight')
      }
      setDrag(null)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  }, [drag, onSaveBoundary, screenXToAlong, screenToLevel, boundariesByBodyId])

  // Matched-boundary drag: live-track the shared-edge control point and clamp
  // it so it never crosses a neighbour body.  On mouse-up, write the control
  // point into ``lower_nodes`` on the UPPER body (safe: an upper body in a
  // matched pair is a two-column body, never a lens — its lower_nodes are
  // otherwise unused by the lens-apex code path).
  useEffect(() => {
    if (!boundaryDrag) return
    const svg = rootRef.current?.ownerSVGElement
    const move = (e: MouseEvent): void => {
      const rect = svg?.getBoundingClientRect()
      const rawY = e.clientY - (rect?.top ?? 0)
      // Clamp so the upper body keeps >0 thickness (minY) and the lower body
      // keeps >0 thickness (maxY).  1 px margin on each bound avoids zero-height.
      const clampedY = Math.max(boundaryDrag.minY + 1, Math.min(boundaryDrag.maxY - 1, rawY))
      setBoundaryDrag({
        ...boundaryDrag,
        x: e.clientX - (rect?.left ?? 0),
        y: clampedY,
      })
    }
    const up = (): void => {
      if (onSaveBoundary && screenXToAlong && screenToLevel) {
        const node: BodyBoundaryNode = {
          along_m: screenXToAlong(boundaryDrag.x),
          elevation_m: screenToLevel(boundaryDrag.y),
        }
        // Preserve upper_nodes (the lens-apex path writes there). Splice
        // lower_nodes by gap: keep this upper body's control nodes that live in
        // OTHER gaps, replace only the one in THIS gap — a continuous body bends
        // independently in each gap it spans.
        const existing = boundariesByBodyId?.get(boundaryDrag.upperBodyId)
        const kept = (existing?.lower_nodes ?? []).filter((n) => {
          if (!alongToScreenX) return false
          const sx = alongToScreenX(n.along_m)
          return sx < boundaryDrag.leftX || sx > boundaryDrag.rightX
        })
        onSaveBoundary(
          boundaryDrag.upperBodyId,
          existing?.upper_nodes ?? [],
          [...kept, node],
          'straight',
        )
      }
      setBoundaryDrag(null)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  }, [
    boundaryDrag,
    onSaveBoundary,
    screenXToAlong,
    screenToLevel,
    boundariesByBodyId,
    alongToScreenX,
  ])

  // Build each column's gap-free unit stack + its screen x-edges (identical to
  // the morph overlay — the partition consumes the same MorphColumn input).
  const { orderedInvs, colByInv, screenByInv } = useMemo(() => {
    const unitsByInv = new Map<string, MorphUnit[]>()
    for (const layer of lithoLayers) {
      if (layer.status !== 'accepted') continue
      const inv = layer.cpt_id ?? layer.borehole_id
      if (!inv) continue
      const unit: MorphUnit = {
        topDepthM: layer.depth_top_m,
        baseDepthM: layer.depth_base_m,
        formationId: layer.formation_id,
        bodyId: layer.body_id ?? null,
      }
      const bucket = unitsByInv.get(inv)
      if (bucket) bucket.push(unit)
      else unitsByInv.set(inv, [unit])
    }

    const cols = new Map<string, MorphColumn>()
    const screen = new Map<string, ColumnScreen>()
    const ordered: string[] = []
    for (const col of placedColumns as readonly PlacedColumn[]) {
      const elev = col.proj.item.elevation_m
      if (elev === null || elev === undefined) continue
      const id = col.proj.item.id
      const units = (unitsByInv.get(id) ?? []).slice().sort((a, b) => a.topDepthM - b.topDepthM)
      if (units.length === 0) continue
      const halfW = col.width / 2
      cols.set(id, { investigationId: id, surfaceElevM: elev, units })
      screen.set(id, {
        rightX: col.nudgedX + halfW,
        leftX: col.nudgedX - halfW,
        along: col.proj.along,
      })
      ordered.push(id)
    }
    ordered.sort((a, b) => (screen.get(a)?.along ?? 0) - (screen.get(b)?.along ?? 0))
    return { orderedInvs: ordered, colByInv: cols, screenByInv: screen }
  }, [lithoLayers, placedColumns])

  const clampY = (y: number): number => Math.max(plotTop, Math.min(plotBottom, y))

  // Open-end stub length: ~5 m of section (dogfeed 2026-06-05), derived from the
  // horizontal scale so it stays 5 m through zoom; clamped so it never vanishes.
  const openEndPx = alongToScreenX
    ? Math.max(8, OPEN_END_M * Math.abs(alongToScreenX(1) - alongToScreenX(0)))
    : EDGE_STUB_PX

  // ---- Compute every gap's partition once, mapped to screen polygons. ------
  // (fraction 0..1 → x between the two columns' facing edges; elevation → y.)
  //
  // After the initial mapping, a POST-BEND pass inserts control points into each
  // pair of consecutive MAIN (non-lens) regions that share an edge in the same
  // gap.  Inserting the SAME point into BOTH polygons keeps the fill a true
  // partition after the bend: the upper region's base edge and the lower
  // region's top edge remain identical.
  const screenRegions = useMemo(() => {
    if (!showBands) return [] as ScreenRegion[]
    const out: ScreenRegion[] = []
    for (let i = 0; i < orderedInvs.length - 1; i += 1) {
      const leftId = orderedInvs[i]
      const rightId = orderedInvs[i + 1]
      const left = colByInv.get(leftId)
      const right = colByInv.get(rightId)
      const lScreen = screenByInv.get(leftId)
      const rScreen = screenByInv.get(rightId)
      if (!left || !right || !lScreen || !rScreen) continue
      const leftX = lScreen.rightX
      const rightX = rScreen.leftX
      if (rightX <= leftX) continue

      // Lens apex overrides for this gap: a left-column-only body keys its apex
      // in upper_nodes, a right-column-only body in lower_nodes (morph
      // convention). The live drag wins over the stored shape so the lens
      // follows the cursor.
      const leftIds = new Set(left.units.map((u) => u.bodyId).filter((id): id is string => !!id))
      const rightIds = new Set(right.units.map((u) => u.bodyId).filter((id): id is string => !!id))
      const overrides = new Map<string, LensApexOverride>()
      const addOverride = (bodyId: string, side: 'left' | 'right'): void => {
        if (drag && drag.bodyId === bodyId && drag.side === side) {
          overrides.set(bodyId, {
            fraction: clamp01((drag.x - leftX) / (rightX - leftX)),
            elevation: screenToLevel ? screenToLevel(drag.y) : 0,
          })
          return
        }
        const b = boundariesByBodyId?.get(bodyId)
        // Lens-apex reads upper_nodes (left lens) or lower_nodes (right lens).
        // Matched-boundary reads lower_nodes on the UPPER body — that path is
        // handled separately in the post-bend pass below; do NOT consume it here.
        const node = (side === 'left' ? b?.upper_nodes : b?.lower_nodes)?.[0]
        if (node && alongToScreenX) {
          overrides.set(bodyId, {
            fraction: clamp01((alongToScreenX(node.along_m) - leftX) / (rightX - leftX)),
            elevation: node.elevation_m,
          })
        }
      }
      // Only build lens apex overrides for ONE-column bodies (lenses).
      for (const id of leftIds) if (!rightIds.has(id)) addOverride(id, 'left')
      for (const id of rightIds) if (!leftIds.has(id)) addOverride(id, 'right')

      for (const region of computePartitionFill(left, right, overrides)) {
        let minX = Infinity
        let maxX = -Infinity
        let minY = Infinity
        let maxY = -Infinity
        const points = region.polygon.map((p) => {
          const x = leftX + p.fraction * (rightX - leftX)
          // Inline clamp (not the clampY closure) so the memo deps stay the
          // primitives plotTop/plotBottom rather than a per-render function id.
          const y = Math.max(plotTop, Math.min(plotBottom, levelToScreen(p.elevation)))
          if (x < minX) minX = x
          if (x > maxX) maxX = x
          if (y < minY) minY = y
          if (y > maxY) maxY = y
          return { x, y }
        })
        out.push({ region, points, leftX, rightX, minX, maxX, minY, maxY })
      }

      // ----- POST-BEND PASS for matched-boundary control points. -----
      // Within this gap, find consecutive MAIN (non-lens) regions.  The
      // partition algorithm emits main regions top→bottom first, lenses last, so
      // we can scan the tail of ``out`` for the regions just added.
      //
      // For each consecutive main pair (upper, lower):
      //   • Resolve a control point (live drag > stored lower_nodes node).
      //   • Insert the point into the BASE edge of the upper polygon and the TOP
      //     edge of the lower polygon.  The SAME (cx, cy) goes into both, so the
      //     boundary is still a shared edge — the partition invariant is
      //     preserved.
      //
      // Polygon edge conventions (from partitionFill.ts buildQuadPolygon):
      //   Quad:  [topL, topR, baseR, baseL] — BASE = last two verts (idx n-2, n-1).
      //   Pinch: last two verts are also the base.  TOP = first two verts (idx 0, 1).
      //
      // We identify the base edge as polygon[n-2] → polygon[n-1] and the top
      // edge as polygon[0] → polygon[1].  Inserting cp BETWEEN those two verts
      // keeps the polygon's winding order correct.

      // Collect the indices of main (non-lens) regions added in THIS gap.
      const mainIdxInGap: number[] = []
      for (let k = out.length - 1; k >= 0; k--) {
        if (out[k].leftX !== leftX || out[k].rightX !== rightX) break
        if (out[k].region.kind !== 'lens') mainIdxInGap.unshift(k)
      }

      for (let mi = 0; mi + 1 < mainIdxInGap.length; mi += 1) {
        const upperIdx = mainIdxInGap[mi]
        const lowerIdx = mainIdxInGap[mi + 1]
        const upper = out[upperIdx]
        const lower = out[lowerIdx]
        if (!upper.region.bodyId || !lower.region.bodyId) continue

        const uId = upper.region.bodyId
        const lId = lower.region.bodyId

        // Natural midpoint of the shared edge (average of the upper's base edge
        // midpoint — screen polygon points at n-2 and n-1).
        const uPts = upper.points
        const n = uPts.length
        const naturalX = (uPts[n - 2].x + uPts[n - 1].x) / 2
        const naturalY = (uPts[n - 2].y + uPts[n - 1].y) / 2

        // Clamp bounds: upper's top y (screen) and lower's base y (screen).
        // Screen y increases downward, so upper top = upper.minY, lower base = lower.maxY.
        const clampMinY = upper.minY + 1
        const clampMaxY = lower.maxY - 1

        // Resolve the control point: live drag wins, then stored node.
        let cpX = naturalX
        let cpY = naturalY
        let hasOverride = false

        if (
          boundaryDrag &&
          boundaryDrag.upperBodyId === uId &&
          boundaryDrag.lowerBodyId === lId
        ) {
          // x is not clamped to gap interior here because the drag handler
          // clamps the y; x follows the cursor but is clamped to the gap.
          cpX = Math.max(leftX + 1, Math.min(rightX - 1, boundaryDrag.x))
          cpY = boundaryDrag.y // already clamped in the mousemove handler
          hasOverride = true
        } else if (boundariesByBodyId && alongToScreenX && screenToLevel) {
          const storedBnd = boundariesByBodyId.get(uId)
          // Match the first lower_node whose along_m maps to a screen x inside
          // this gap.  A multi-gap body can carry one node per gap.
          const storedNode = storedBnd?.lower_nodes.find((node) => {
            const nx = alongToScreenX(node.along_m)
            return nx >= leftX && nx <= rightX
          })
          if (storedNode) {
            cpX = Math.max(leftX + 1, Math.min(rightX - 1, alongToScreenX(storedNode.along_m)))
            cpY = Math.max(clampMinY, Math.min(clampMaxY, levelToScreen(storedNode.elevation_m)))
            hasOverride = true
          }
        }

        if (!hasOverride) continue // no override → natural straight edge, no bend needed

        // Insert cp into upper's BASE edge (between pts[n-2] and pts[n-1]).
        const cp = { x: cpX, y: cpY }
        upper.points = [
          ...uPts.slice(0, n - 1), // [0 .. n-2] inclusive = everything up to last
          cp,
          uPts[n - 1], // baseL
        ]

        // Insert cp into lower's TOP edge (between pts[0] and pts[1]).
        const lPts = lower.points
        lower.points = [lPts[0], cp, ...lPts.slice(1)]

        // Recompute minX/maxX/minY/maxY for both regions after mutation.
        for (const sr of [upper, lower]) {
          let mxn = Infinity
          let mxx = -Infinity
          let myn = Infinity
          let myx = -Infinity
          for (const pt of sr.points) {
            if (pt.x < mxn) mxn = pt.x
            if (pt.x > mxx) mxx = pt.x
            if (pt.y < myn) myn = pt.y
            if (pt.y > myx) myx = pt.y
          }
          sr.minX = mxn
          sr.maxX = mxx
          sr.minY = myn
          sr.maxY = myx
        }
      }
    }
    return out
  }, [
    orderedInvs,
    colByInv,
    screenByInv,
    showBands,
    levelToScreen,
    plotTop,
    plotBottom,
    drag,
    boundaryDrag,
    boundariesByBodyId,
    alongToScreenX,
    screenToLevel,
  ])

  // One label per BODY at its tallest visible region, clamped to the viewport so
  // it survives a zoom onto a single test (dogfeed 2026-06-05).
  const labels = useMemo(() => {
    const bestByBody = new Map<string, ScreenRegion>()
    for (const sr of screenRegions) {
      const id = sr.region.bodyId
      if (!id) continue
      if (sr.maxY - sr.minY < LABEL_MIN_H) continue
      const prev = bestByBody.get(id)
      if (!prev || sr.maxY - sr.minY > prev.maxY - prev.minY) bestByBody.set(id, sr)
    }
    const out: { key: string; x: number; y: number; text: string }[] = []
    for (const [id, sr] of bestByBody) {
      const text = formationLabelById?.get(sr.region.formationId)
      if (!text) continue
      const loX = plotLeft != null ? Math.max(sr.minX, plotLeft) : sr.minX
      const hiX = plotRight != null ? Math.min(sr.maxX, plotRight) : sr.maxX
      if (hiX - loX < 4) continue // not horizontally visible
      out.push({ key: id, x: (loX + hiX) / 2, y: (sr.minY + sr.maxY) / 2, text })
    }
    return out
  }, [screenRegions, formationLabelById, plotLeft, plotRight])

  // Collect every shared boundary between consecutive main (non-lens) regions
  // in each gap so the render pass can draw the grab handles.
  //
  // Grouping strategy: walk ``screenRegions`` in order; each entry carries
  // ``leftX``/``rightX`` that identifies its gap.  Within a gap the partition
  // algorithm emits main regions top→bottom first, lenses last.  We track the
  // last non-lens region per (leftX, rightX) key and emit a SharedBoundary when
  // the next non-lens region in the same gap arrives.
  //
  // Handle position is the midpoint of the current control point (live drag or
  // stored, else the natural midpoint of the shared edge = upper's last two
  // points averaged).
  const sharedBoundaries = useMemo((): SharedBoundary[] => {
    if (!onSaveBoundary) return [] // handles are only useful when saving is wired
    const out: SharedBoundary[] = []
    // last main-region index seen per gap key "<leftX>:<rightX>"
    const lastMainByGap = new Map<string, number>()

    for (let idx = 0; idx < screenRegions.length; idx += 1) {
      const sr = screenRegions[idx]
      if (sr.region.kind === 'lens') continue
      if (!sr.region.bodyId) continue

      const gapKey = `${sr.leftX}:${sr.rightX}`
      const prevIdx = lastMainByGap.get(gapKey)
      if (prevIdx !== undefined) {
        const upper = screenRegions[prevIdx]
        const lower = sr
        const uId = upper.region.bodyId!
        const lId = lower.region.bodyId!

        // Natural midpoint of the shared edge = midpoint of upper's last two
        // polygon vertices (the base edge: baseR → baseL).
        const uPts = upper.points
        const nu = uPts.length
        const naturalX = (uPts[nu - 2].x + uPts[nu - 1].x) / 2
        const naturalY = (uPts[nu - 2].y + uPts[nu - 1].y) / 2

        // Clamp bounds for the drag (upper's top y = upper.minY; lower's base y = lower.maxY).
        const minY = upper.minY + 1
        const maxY = lower.maxY - 1

        // Resolved control point: live drag > stored node > natural midpoint.
        let cpX = naturalX
        let cpY = naturalY
        if (
          boundaryDrag &&
          boundaryDrag.upperBodyId === uId &&
          boundaryDrag.lowerBodyId === lId
        ) {
          cpX = Math.max(sr.leftX + 1, Math.min(sr.rightX - 1, boundaryDrag.x))
          cpY = boundaryDrag.y
        } else if (boundariesByBodyId && alongToScreenX && levelToScreen) {
          const storedBnd = boundariesByBodyId.get(uId)
          const storedNode = storedBnd?.lower_nodes.find((node) => {
            const nx = alongToScreenX(node.along_m)
            return nx >= sr.leftX && nx <= sr.rightX
          })
          if (storedNode) {
            cpX = Math.max(sr.leftX + 1, Math.min(sr.rightX - 1, alongToScreenX(storedNode.along_m)))
            cpY = Math.max(minY, Math.min(maxY, levelToScreen(storedNode.elevation_m)))
          }
        }

        out.push({
          upperBodyId: uId,
          lowerBodyId: lId,
          upperIdx: prevIdx,
          lowerIdx: idx,
          naturalX,
          naturalY,
          cpX,
          cpY,
          minY,
          maxY,
          leftX: sr.leftX,
          rightX: sr.rightX,
        })
      }
      lastMainByGap.set(gapKey, idx)
    }
    return out
  }, [screenRegions, boundaryDrag, boundariesByBodyId, alongToScreenX, levelToScreen, onSaveBoundary])

  return (
    <g ref={rootRef} data-testid="partition-fill-overlay" style={{ pointerEvents: 'none' }}>
      {screenRegions.map((sr, i) => {
        const color = formationColorById.get(sr.region.formationId) ?? FALLBACK_COLOR
        const d = `${sr.points.map((p, j) => `${j === 0 ? 'M' : 'L'} ${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ')} Z`
        const body = sr.region.bodyId ? bodyById.get(sr.region.bodyId) : undefined
        const interactive = Boolean(onBodyContextMenu && body)
        // A lens carries a draggable apex (its pinch point = polygon[1]). Side
        // comes from the source corner: fraction 0 → left lens, 1 → right lens.
        const apex = sr.region.kind === 'lens' ? sr.points[1] : undefined
        const side: 'left' | 'right' = sr.region.polygon[0].fraction === 0 ? 'left' : 'right'
        const canShape = Boolean(apex && onSaveBoundary && sr.region.bodyId)
        return [
          <path
            key={`pf-${i}`}
            data-testid={`partition-region-${sr.region.bodyId ?? 'nobody'}`}
            d={d}
            fill={color}
            fillOpacity={sr.region.kind === 'lens' ? LENS_OPACITY : FILL_OPACITY}
            stroke={color}
            strokeOpacity={STROKE_OPACITY}
            strokeWidth={0.75}
            style={interactive ? { pointerEvents: 'auto', cursor: 'context-menu' } : undefined}
            onContextMenu={
              interactive
                ? (e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    const rect = rootRef.current?.ownerSVGElement?.getBoundingClientRect()
                    onBodyContextMenu?.(
                      body as BodyListItem,
                      e.clientX - (rect?.left ?? 0),
                      e.clientY - (rect?.top ?? 0),
                    )
                  }
                : undefined
            }
          />,
          canShape && apex ? (
            <g key={`pf-apex-${i}`}>
              {/* Transparent hit halo so the small handle is easy to grab. */}
              <circle
                data-testid={`partition-lens-apex-hit-${sr.region.bodyId}`}
                cx={apex.x}
                cy={apex.y}
                r={APEX_HIT_R}
                fill="transparent"
                style={{ pointerEvents: 'auto', cursor: 'grab' }}
                onMouseDown={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  setDrag({ bodyId: sr.region.bodyId as string, side, x: apex.x, y: apex.y })
                }}
              />
              <circle
                data-testid={`partition-lens-apex-${sr.region.bodyId}`}
                cx={apex.x}
                cy={apex.y}
                r={APEX_R}
                fill="#f59e0b"
                stroke="#0f172a"
                strokeWidth={1}
                style={{ pointerEvents: 'none' }}
              />
            </g>
          ) : null,
        ]
      })}

      {labels.map((l) => (
        <text
          key={`pf-label-${l.key}`}
          x={l.x}
          y={l.y}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={11}
          fontWeight={600}
          fill="#e2e8f0"
          stroke="#0f172a"
          strokeWidth={2.5}
          paintOrder="stroke"
          style={{ pointerEvents: 'none' }}
        >
          {l.text}
        </text>
      ))}

      {/* Matched-boundary drag handles: one per shared edge between consecutive
          main regions in a gap.  The handle sits at the current control point
          (live drag cursor / stored lower_nodes node / natural midpoint).  The
          hit halo (larger transparent circle) makes the small handle easy to
          grab.  Both circles set pointerEvents auto on the group so the g root's
          pointerEvents:none doesn't suppress them. */}
      {sharedBoundaries.map((sb) => (
        <g key={`pf-bnd-${sb.upperBodyId}-${sb.lowerBodyId}`}>
          <circle
            data-testid={`partition-boundary-hit-${sb.upperBodyId}-${sb.lowerBodyId}`}
            cx={sb.cpX}
            cy={sb.cpY}
            r={BOUNDARY_HIT_R}
            fill="transparent"
            style={{ pointerEvents: 'auto', cursor: 'ns-resize' }}
            onMouseDown={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setBoundaryDrag({
                upperBodyId: sb.upperBodyId,
                lowerBodyId: sb.lowerBodyId,
                x: sb.cpX,
                y: sb.cpY,
                minY: sb.minY,
                maxY: sb.maxY,
                leftX: sb.leftX,
                rightX: sb.rightX,
              })
            }}
          />
          <circle
            data-testid={`partition-boundary-handle-${sb.upperBodyId}-${sb.lowerBodyId}`}
            cx={sb.cpX}
            cy={sb.cpY}
            r={BOUNDARY_R}
            fill={BOUNDARY_COLOR}
            stroke="#0f172a"
            strokeWidth={1}
            style={{ pointerEvents: 'none' }}
          />
        </g>
      ))}

      {/* Open-end stubs: the first / last column's PARTITION continues
          off-section as a short ~5 m parallel strip, one rect per unit so the
          edge stays a partition (no envelope overlap). */}
      {showBands &&
        (
          [
            { id: orderedInvs[0], dir: -1 as const },
            { id: orderedInvs[orderedInvs.length - 1], dir: 1 as const },
          ] as const
        ).flatMap(({ id, dir }, edgeIdx) => {
          if (!id) return []
          const col = colByInv.get(id)
          const cScreen = screenByInv.get(id)
          if (!col || !cScreen) return []
          const edgeX = dir < 0 ? cScreen.leftX : cScreen.rightX
          const outerX = dir < 0 ? edgeX - openEndPx : edgeX + openEndPx
          const x0 = Math.min(edgeX, outerX)
          const w = Math.abs(outerX - edgeX)
          if (w <= 0.5) return []
          return col.units.map((u, ui) => {
            const color = formationColorById.get(u.formationId) ?? FALLBACK_COLOR
            const yT = clampY(levelToScreen(col.surfaceElevM - u.topDepthM))
            const yB = clampY(levelToScreen(col.surfaceElevM - u.baseDepthM))
            return (
              <rect
                key={`pf-edge-${edgeIdx}-${ui}`}
                data-testid={`partition-edge-${edgeIdx}-${id}-${ui}`}
                x={x0}
                y={yT}
                width={w}
                height={Math.max(0.5, yB - yT)}
                fill={color}
                fillOpacity={FILL_OPACITY}
                stroke={color}
                strokeOpacity={STROKE_OPACITY}
                strokeWidth={0.5}
              />
            )
          })
        })}
    </g>
  )
}
