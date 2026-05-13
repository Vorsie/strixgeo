/**
 * Formation-contact overlay for the cross-section.
 *
 * Two render layers on top of each other:
 *
 *   1. **Per-column layer geometry.** For each anchor (CPT or
 *      borehole) we group its contacts by depth, then for each
 *      contact compute the layer it defines:
 *
 *         top    = contact.depth_top_m
 *         bottom = next-deeper contact's top at the same anchor,
 *                  OR the investigation's bottom depth (CPT
 *                  ``max_depth_m`` / borehole ``total_depth_m``),
 *                  OR fall through to plotBottom when neither is
 *                  known so the deepest layer still renders.
 *
 *      We render a HORIZONTAL line segment at the top across the
 *      column's visual band width and a FORMATION NAME label
 *      centred vertically inside the layer. Replaces the old
 *      "dot at each contact" affordance — engineers think in
 *      layer slabs, not in point picks.
 *
 *   2. **Cross-column surface polyline.** Same as before: one
 *      polyline per formation through the (column X, contact Y)
 *      vertices of every anchor that carries that formation,
 *      ordered left-to-right. This is the formation SURFACE — the
 *      thing a downstream Plaxis exporter actually wants to see —
 *      and is the value-add of the section view over isolated
 *      borelogs.
 *
 * Investigations without a contact for a given formation aren't
 * traversed by that formation's polyline (gap-filled by the line
 * connecting the surrounding columns).
 *
 * Deferred to later slices:
 *
 *   * Drag a layer top to change depth → PATCH contact.
 *   * Click on a layer to inspect / edit.
 *   * Different stroke per ``confidence`` (high / medium / low).
 *   * Cross-formation gap-filling rules (overlapping picks across
 *     boreholes that disagree).
 */

import { useCallback, useEffect, useMemo, useState } from 'react'

import type {
  FormationContactResponse,
  GeologicalFormationResponse,
} from '../../api/client'
import { SNAP_TOLERANCE_PX } from './cptChannels'
import HoverReadoutCard from './HoverReadoutCard'
import type { PlacedColumn } from './utils'

interface Props {
  contacts: readonly FormationContactResponse[]
  formations: readonly GeologicalFormationResponse[]
  /** Every CPT and borehole placed on the section, in projection
   * order. The component looks up each contact's anchor by id to
   * pull screen X + surface elevation + visual band width. */
  placedColumns: readonly PlacedColumn[]
  /** Borehole IDs the active model excludes from contact rendering.
   * Mirrors ``GeologicalModel.excluded_borehole_ids`` — contacts
   * whose ``borehole_id`` is in this set get skipped at render
   * time. The DB rows persist; re-including the borehole brings the
   * polyline + per-column layers back without a refetch. */
  excludedBoreholeIds?: ReadonlySet<string>
  levelToScreen: (level: number) => number
  plotTop: number
  plotBottom: number
  /** Fires on the drag's mouseup with the contact id and its new
   * depth_top_m. Caller PATCHes the contact and refreshes its local
   * contacts state. When absent the per-contact hit-strip stays
   * unmounted — the lines are non-interactive in read-only mode.
   *
   * ``snapped`` reports whether the final depth landed on a snap
   * candidate (only relevant on borehole anchors with stratigraphy
   * observations). Drives the contact's source / confidence
   * update — debt #22/#23. */
  onUpdateContactDepth?: (
    contactId: string,
    newDepthM: number,
    snapped: boolean,
  ) => Promise<void>
  /** Snap-target depths per anchor id, used by the drag interaction
   * to mirror BoreholeColumn's snap-to-stratigraphy behaviour: when a
   * borehole anchor has candidates here, the dragged depth snaps to
   * the nearest one within ``SNAP_TOLERANCE_PX``. Empty map / absent
   * entry → free drag. */
  snapDepthsByAnchorId?: ReadonlyMap<string, readonly number[]>
  /** Looks up qc + Rf at a given depth for a CPT anchor. Used to
   * decorate the drag readout with the same depth-series values
   * ContactPickBar surfaces on hover — engineers want to see what
   * the cone reported at the depth they're picking. Returning null
   * (or the values being null) drops the qc / Rf lines from the
   * readout but still shows depth + mTAW. */
  getCptValuesAtDepth?: (
    cptId: string,
    depthM: number,
  ) => { qc: number | null; rf: number | null } | null
}

interface PolylineVertex {
  contactId: string
  screenX: number
  screenY: number
  sortKey: number
}

interface RenderedLayer {
  key: string
  contactId: string
  anchorId: string
  anchorKind: 'cpt' | 'borehole'
  formationId: string
  formationName: string
  color: string
  /** Horizontal segment extent + Y. */
  segLeftX: number
  segRightX: number
  segY: number
  /** Layer body vertical extent (clamped to plot area). */
  bodyTopY: number
  bodyBottomY: number
  /** Column anchor X for the name label. */
  labelX: number
  /** Anchor metadata needed by the drag handler — saved on the layer
   * so we don't re-walk placedColumns on every mousemove. */
  surfaceElevationM: number
  pxPerMetre: number
  surfaceY: number
  /** Original (un-dragged) depth, kept on the layer so the drag
   * commit can no-op when the user releases at the same depth. */
  originalDepthM: number
}

interface DragState {
  contactId: string
  anchorId: string
  anchorKind: 'cpt' | 'borehole'
  surfaceElevationM: number
  pxPerMetre: number
  surfaceY: number
  startClientY: number
  startSegY: number
  /** Latest drag-derived depth (live during the drag, set by the
   * document mousemove handler). Used to (a) re-render the segment +
   * label, (b) override the corresponding polyline vertex's Y, and
   * (c) feed the commit on mouseup. */
  currentDepthM: number
  /** Whether the latest currentDepthM came from a snap candidate.
   * Drives the contact's source / confidence on commit
   * (debt #22/#23). */
  currentSnapped: boolean
  /** Cached display info to keep the floating readout self-contained
   * without re-querying placedColumns. */
  color: string
  formationName: string
  segLeftX: number
  segRightX: number
  labelX: number
  plotTop: number
  plotBottom: number
}

// Below this height (px) the layer is too small for a middle label
// to read — skip rendering the text but still draw the top segment.
const LAYER_LABEL_MIN_HEIGHT_PX = 14
// Avg glyph width at fontSize=9 — used by the truncation budget.
const APPROX_GLYPH_WIDTH_PX = 5
// Vertical hit-strip half-height (px) around each top segment — wide
// enough that the line is grabbable without precision aiming, narrow
// enough that adjacent layers don't fight for the same pointer.
const DRAG_HIT_HALF_HEIGHT_PX = 5

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function truncateToWidth(text: string, widthPx: number): string {
  // Reserve a couple of px on each side as padding inside the band.
  const usable = Math.max(0, widthPx - 4)
  const maxChars = Math.max(3, Math.floor(usable / APPROX_GLYPH_WIDTH_PX))
  if (text.length <= maxChars) return text
  return `${text.slice(0, Math.max(1, maxChars - 1))}…`
}

function itemBottomDepth(col: PlacedColumn): number | null {
  // PlacedColumn is a discriminated union by ``kind`` — TypeScript
  // narrows col.proj.item to the right shape inside each branch,
  // no cast needed (debt #28).
  if (col.kind === 'cpt') {
    return col.proj.item.max_depth_m
  }
  return col.proj.item.total_depth_m
}

export default function ContactsLayer({
  contacts,
  formations,
  placedColumns,
  excludedBoreholeIds,
  levelToScreen,
  plotTop,
  plotBottom,
  onUpdateContactDepth,
  snapDepthsByAnchorId,
  getCptValuesAtDepth,
}: Props): JSX.Element | null {
  // Pre-index lookups + filter excluded boreholes once. Both render
  // halves (polyline + per-column layers) consume the same set.
  const { layers, polylines } = useMemo(() => {
    if (contacts.length === 0) {
      return { layers: [], polylines: [] } as {
        layers: RenderedLayer[]
        polylines: {
          formationId: string
          color: string
          name: string
          vertices: PolylineVertex[]
        }[]
      }
    }

    const formationById = new Map<string, GeologicalFormationResponse>()
    for (const f of formations) formationById.set(f.id, f)

    // First filter: only contacts whose anchor we can place AND
    // whose anchor isn't excluded. The output is a per-anchor list
    // sorted by depth ascending — the natural form for both render
    // halves.
    type AnchorContact = {
      contact: FormationContactResponse
      column: PlacedColumn
      surfaceElevationM: number
    }
    const byAnchor = new Map<string, AnchorContact[]>()
    for (const col of placedColumns) {
      const item = col.proj.item as { id: string; elevation_m: number | null }
      if (item.elevation_m === null) continue
      const colContacts: AnchorContact[] = []
      for (const c of contacts) {
        const anchorId = c.borehole_id ?? c.cpt_id
        if (anchorId !== item.id) continue
        if (c.borehole_id && excludedBoreholeIds?.has(c.borehole_id)) continue
        colContacts.push({
          contact: c,
          column: col,
          surfaceElevationM: item.elevation_m,
        })
      }
      if (colContacts.length > 0) {
        colContacts.sort((a, b) => a.contact.depth_top_m - b.contact.depth_top_m)
        byAnchor.set(item.id, colContacts)
      }
    }

    // Pass 1: per-column layers. Each contact's layer extends to the
    // next contact OR the investigation's bottom depth.
    const layersOut: RenderedLayer[] = []
    for (const colContacts of byAnchor.values()) {
      for (let i = 0; i < colContacts.length; i += 1) {
        const entry = colContacts[i]
        const { contact, column, surfaceElevationM } = entry
        const formation = formationById.get(contact.formation_id)
        if (!formation) continue
        const topDepth = contact.depth_top_m
        const nextDepth = colContacts[i + 1]?.contact.depth_top_m
        const bottomCap = itemBottomDepth(column)
        // bottomDepth: nearest-known lower bound. Fall-through order
        // matches geological convention — next pick wins, then the
        // investigation's recorded bottom, finally the visible plot
        // bottom so the deepest layer still renders something.
        const bottomDepth =
          nextDepth !== undefined ? nextDepth : bottomCap ?? Number.POSITIVE_INFINITY
        const topLevel = surfaceElevationM - topDepth
        const bottomLevel =
          bottomDepth === Number.POSITIVE_INFINITY
            ? Number.NEGATIVE_INFINITY
            : surfaceElevationM - bottomDepth
        const segY = levelToScreen(topLevel)
        const bodyTopY = clamp(segY, plotTop, plotBottom)
        const bodyBottomY =
          bottomLevel === Number.NEGATIVE_INFINITY
            ? plotBottom
            : clamp(levelToScreen(bottomLevel), plotTop, plotBottom)
        if (bodyBottomY < bodyTopY) continue
        const halfW = column.width / 2
        // px-per-metre derived from levelToScreen — deeper points map
        // to larger Y in the flipped section transform. We need this
        // both at render time (to draw the segment after a drag
        // override) and in the drag move handler.
        const pxPerMetre =
          levelToScreen(surfaceElevationM - 1) - levelToScreen(surfaceElevationM)
        const surfaceY = levelToScreen(surfaceElevationM)
        layersOut.push({
          key: `${column.proj.item.id}-${contact.id}`,
          contactId: contact.id,
          anchorId: column.proj.item.id,
          anchorKind: column.kind,
          formationId: contact.formation_id,
          formationName: formation.name,
          color: formation.color,
          segLeftX: column.nudgedX - halfW,
          segRightX: column.nudgedX + halfW,
          segY,
          bodyTopY,
          bodyBottomY,
          labelX: column.nudgedX,
          surfaceElevationM,
          pxPerMetre,
          surfaceY,
          originalDepthM: topDepth,
        })
      }
    }

    // Pass 2: cross-column polylines, one per formation. Same shape
    // as before but without the dot markers — the per-column top
    // segments already mark each anchor, dots would be redundant.
    type PolyAcc = { color: string; name: string; vertices: PolylineVertex[] }
    const byFormation = new Map<string, PolyAcc>()
    for (const colContacts of byAnchor.values()) {
      for (const entry of colContacts) {
        const { contact, column, surfaceElevationM } = entry
        const formation = formationById.get(contact.formation_id)
        if (!formation) continue
        const screenY = levelToScreen(surfaceElevationM - contact.depth_top_m)
        if (screenY < plotTop || screenY > plotBottom) continue
        const acc =
          byFormation.get(contact.formation_id) ??
          ({ color: formation.color, name: formation.name, vertices: [] } as PolyAcc)
        acc.vertices.push({
          contactId: contact.id,
          screenX: column.nudgedX,
          screenY,
          sortKey: column.nudgedX,
        })
        byFormation.set(contact.formation_id, acc)
      }
    }
    const polylinesOut: {
      formationId: string
      color: string
      name: string
      vertices: PolylineVertex[]
    }[] = []
    for (const [formationId, acc] of byFormation) {
      acc.vertices.sort((a, b) => a.sortKey - b.sortKey)
      polylinesOut.push({
        formationId,
        color: acc.color,
        name: acc.name,
        vertices: acc.vertices,
      })
    }

    return { layers: layersOut, polylines: polylinesOut }
  }, [
    contacts,
    formations,
    placedColumns,
    excludedBoreholeIds,
    levelToScreen,
    plotTop,
    plotBottom,
  ])

  // Drag state lives in the component so its update path is
  // explicit. Document-level mousemove + mouseup listeners attach
  // only while a drag is active.
  const [drag, setDrag] = useState<DragState | null>(null)

  // Apply snap-to-stratigraphy (matches the click path's behaviour
  // on borehole anchors). Falls through to the raw depth when there's
  // no snap candidate within ``SNAP_TOLERANCE_PX`` or the anchor has
  // no candidates registered.
  const snapDepth = useCallback(
    (
      rawDepth: number,
      anchorId: string,
      pxPerMetre: number,
    ): { depth: number; snapped: boolean } => {
      if (pxPerMetre === 0) return { depth: rawDepth, snapped: false }
      const candidates = snapDepthsByAnchorId?.get(anchorId)
      if (!candidates || candidates.length === 0) {
        return { depth: rawDepth, snapped: false }
      }
      let bestDepth = rawDepth
      let bestPxDistance = SNAP_TOLERANCE_PX + 1
      let bestSnapped = false
      for (const cand of candidates) {
        const px = Math.abs((cand - rawDepth) * pxPerMetre)
        if (px <= SNAP_TOLERANCE_PX && px < bestPxDistance) {
          bestPxDistance = px
          bestDepth = cand
          bestSnapped = true
        }
      }
      return { depth: bestDepth, snapped: bestSnapped }
    },
    [snapDepthsByAnchorId],
  )

  // Document-level move/up while a drag is active. clientY delta
  // converts to a Y delta in SVG space (the SVG is in a relative
  // container; absolute scale is 1:1 so we don't need to walk the
  // bounding rect). Recomputing depth from start values keeps the
  // math drift-free as the cursor wanders far from the line.
  //
  // Three defensive cancel paths cover the case where the user
  // releases the mouse OUTSIDE the browser viewport (``mouseup``
  // never reaches our document listener):
  //   1. ``e.buttons === 0`` at the top of handleMove — when the
  //      cursor comes back into the window with no button held,
  //      we know the release happened off-screen.
  //   2. ``window.blur`` — if the user switches apps mid-drag the
  //      window loses focus; cancel without committing.
  //   3. ``pxPerMetre === 0`` guard — pathological collapsed
  //      viewport (VEX edge case); prevents Infinity from ever
  //      reaching the commit path.
  useEffect(() => {
    if (drag === null) return
    function cancel(): void {
      setDrag(null)
    }
    function handleMove(e: MouseEvent): void {
      if (e.buttons === 0) {
        cancel()
        return
      }
      if (drag!.pxPerMetre === 0) return
      const draggedSegY = drag!.startSegY + (e.clientY - drag!.startClientY)
      const rawDepth = (draggedSegY - drag!.surfaceY) / drag!.pxPerMetre
      // Depth ≥ 0 — contacts can't sit above the surface. No upper
      // bound here: the user may want to push a contact past the
      // test's recorded total depth if they're correcting a typo.
      const clamped = Math.max(0, rawDepth)
      const { depth, snapped } = snapDepth(
        clamped,
        drag!.anchorId,
        drag!.pxPerMetre,
      )
      setDrag(prev =>
        prev === null
          ? null
          : { ...prev, currentDepthM: depth, currentSnapped: snapped },
      )
    }
    function handleUp(): void {
      const final = drag
      setDrag(null)
      if (!final || !onUpdateContactDepth) return
      if (final.pxPerMetre === 0) return
      // No-op commit when the depth didn't change (e.g. a click that
      // never moved). Saves a server round-trip + spurious history.
      const start = (final.startSegY - final.surfaceY) / final.pxPerMetre
      if (Math.abs(final.currentDepthM - start) < 1e-6) return
      void onUpdateContactDepth(
        final.contactId,
        final.currentDepthM,
        final.currentSnapped,
      )
    }
    document.addEventListener('mousemove', handleMove)
    document.addEventListener('mouseup', handleUp)
    window.addEventListener('blur', cancel)
    return () => {
      document.removeEventListener('mousemove', handleMove)
      document.removeEventListener('mouseup', handleUp)
      window.removeEventListener('blur', cancel)
    }
  }, [drag, snapDepth, onUpdateContactDepth])

  const startDrag = useCallback(
    (layer: RenderedLayer, e: React.MouseEvent<SVGRectElement>) => {
      if (!onUpdateContactDepth) return
      // Only the left button starts a drag — right-click is reserved
      // for the section's column context menu.
      if (e.button !== 0) return
      e.preventDefault()
      e.stopPropagation()
      setDrag({
        contactId: layer.contactId,
        anchorId: layer.anchorId,
        anchorKind: layer.anchorKind,
        surfaceElevationM: layer.surfaceElevationM,
        pxPerMetre: layer.pxPerMetre,
        surfaceY: layer.surfaceY,
        startClientY: e.clientY,
        startSegY: layer.segY,
        currentDepthM: layer.originalDepthM,
        // The drag starts at the contact's existing depth; the user
        // hasn't moved yet, so we treat it as "not snapped" — only
        // the act of dragging onto a candidate stamps it as such.
        currentSnapped: false,
        color: layer.color,
        formationName: layer.formationName,
        segLeftX: layer.segLeftX,
        segRightX: layer.segRightX,
        labelX: layer.labelX,
        plotTop,
        plotBottom,
      })
    },
    [onUpdateContactDepth, plotTop, plotBottom],
  )

  if (layers.length === 0 && polylines.length === 0) return null

  // Per-render override: when a layer is the dragged one, replace
  // its segY + label position with the drag's live depth.
  function applyDragOverride(layer: RenderedLayer): RenderedLayer {
    if (drag === null || drag.contactId !== layer.contactId) return layer
    const newSegY = drag.surfaceY + drag.currentDepthM * drag.pxPerMetre
    // Preserve the layer body extent — the dragged contact's bottom
    // moves with the segment, but adjacent layers don't reshape
    // until commit. Visually it's the "ghost" pattern from
    // ContactPickBar: while dragging, the segment + label follow the
    // cursor, neighbours stay put.
    const bodyBottomY = layer.bodyBottomY
    return {
      ...layer,
      segY: newSegY,
      bodyTopY: clamp(newSegY, plotTop, plotBottom),
      bodyBottomY,
    }
  }

  return (
    <g>
      {/* Cross-column polylines (formation surfaces). Drawn first so
          the per-column top segments + name labels paint on top. */}
      {polylines.map(line => {
        if (line.vertices.length < 2) return null
        const path = line.vertices
          .map((v, i) => {
            // Live-override the dragged vertex's Y so the surface
            // line tracks the drag instead of snapping at commit.
            const y =
              drag !== null && drag.contactId === v.contactId
                ? drag.surfaceY + drag.currentDepthM * drag.pxPerMetre
                : v.screenY
            return `${i === 0 ? 'M' : 'L'} ${v.screenX.toFixed(2)} ${y.toFixed(2)}`
          })
          .join(' ')
        return (
          <path
            key={`poly-${line.formationId}`}
            d={path}
            stroke={line.color}
            strokeWidth={1}
            strokeOpacity={0.55}
            strokeDasharray="4 3"
            fill="none"
            pointerEvents="none"
          />
        )
      })}

      {/* Per-column horizontal segments at each contact top + name
          label in the layer's vertical middle. Each layer is one
          formation slab at one column. The drag hit-strip sits on
          top of the segment and the visible line + label paint
          underneath. */}
      {layers.map(rawLayer => {
        const layer = applyDragOverride(rawLayer)
        const labelY = (layer.bodyTopY + layer.bodyBottomY) / 2
        const layerHeight = layer.bodyBottomY - layer.bodyTopY
        const showLabel = layerHeight >= LAYER_LABEL_MIN_HEIGHT_PX
        const labelWidth = layer.segRightX - layer.segLeftX
        const display = showLabel ? truncateToWidth(layer.formationName, labelWidth) : ''
        const isDragged = drag !== null && drag.contactId === layer.contactId
        return (
          <g key={layer.key}>
            {/* Top segment — only when the top sits inside the plot
                area, otherwise the layer extends off the top edge
                and the segment would draw on the chrome. */}
            {layer.segY >= plotTop && layer.segY <= plotBottom && (
              <line
                x1={layer.segLeftX}
                x2={layer.segRightX}
                y1={layer.segY}
                y2={layer.segY}
                stroke={layer.color}
                strokeWidth={isDragged ? 2.5 : 1.75}
                strokeOpacity={0.95}
                pointerEvents="none"
              />
            )}
            {showLabel && (
              <text
                x={layer.labelX}
                y={labelY}
                fontSize={9}
                fill={layer.color}
                fontWeight={500}
                textAnchor="middle"
                dominantBaseline="middle"
                pointerEvents="none"
              >
                {display}
              </text>
            )}
            {/* Transparent hit-strip — wider than the visible line so
                the user can grab without precision aiming. Rendered
                only when a commit handler is wired; without one the
                lines stay non-interactive. */}
            {onUpdateContactDepth &&
              layer.segY >= plotTop - DRAG_HIT_HALF_HEIGHT_PX &&
              layer.segY <= plotBottom + DRAG_HIT_HALF_HEIGHT_PX && (
                <rect
                  x={layer.segLeftX}
                  y={layer.segY - DRAG_HIT_HALF_HEIGHT_PX}
                  width={layer.segRightX - layer.segLeftX}
                  height={DRAG_HIT_HALF_HEIGHT_PX * 2}
                  fill="transparent"
                  style={{ cursor: isDragged ? 'grabbing' : 'ns-resize' }}
                  onMouseDown={e => startDrag(rawLayer, e)}
                  data-contact-id={layer.contactId}
                  data-testid="contact-drag-strip"
                />
              )}
          </g>
        )
      })}

      {/* Drag readout — depth + mTAW always, plus qc + Rf when the
          contact is anchored at a CPT (mirrors ContactPickBar so the
          drag flow surfaces the same depth-series values as the
          hover-pick flow). Same card shape used elsewhere. */}
      {drag !== null && (() => {
        const elevation = drag.surfaceElevationM - drag.currentDepthM
        const lines = [
          { text: `depth ${drag.currentDepthM.toFixed(2)} m`, color: drag.color },
          {
            text: `${elevation >= 0 ? '+' : ''}${elevation.toFixed(2)} m TAW`,
            color: drag.color,
          },
        ]
        if (drag.anchorKind === 'cpt' && getCptValuesAtDepth) {
          const v = getCptValuesAtDepth(drag.anchorId, drag.currentDepthM)
          if (v) {
            lines.push({
              text: `qc ${v.qc === null ? '—' : `${v.qc.toFixed(2)} MPa`}`,
              color: '#111827',
            })
            lines.push({
              text: `Rf ${v.rf === null ? '—' : `${v.rf.toFixed(2)} %`}`,
              color: '#b45309',
            })
          }
        }
        return (
          <g pointerEvents="none">
            <HoverReadoutCard
              x={drag.segRightX + 8}
              y={drag.surfaceY + drag.currentDepthM * drag.pxPerMetre}
              plotTop={drag.plotTop}
              plotBottom={drag.plotBottom}
              lines={lines}
            />
          </g>
        )
      })()}
    </g>
  )
}
