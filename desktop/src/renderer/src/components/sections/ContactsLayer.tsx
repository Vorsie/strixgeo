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

import { useMemo } from 'react'

import type {
  BoreholeListItem,
  CptListItem,
  FormationContactResponse,
  GeologicalFormationResponse,
} from '../../api/client'
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
}

interface PolylineVertex {
  contactId: string
  screenX: number
  screenY: number
  sortKey: number
}

interface RenderedLayer {
  key: string
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
}

// Below this height (px) the layer is too small for a middle label
// to read — skip rendering the text but still draw the top segment.
const LAYER_LABEL_MIN_HEIGHT_PX = 14
// Avg glyph width at fontSize=9 — used by the truncation budget.
const APPROX_GLYPH_WIDTH_PX = 5

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
  const item = col.proj.item as CptListItem | BoreholeListItem
  if (col.kind === 'cpt') {
    return (item as CptListItem).max_depth_m
  }
  return (item as BoreholeListItem).total_depth_m
}

export default function ContactsLayer({
  contacts,
  formations,
  placedColumns,
  excludedBoreholeIds,
  levelToScreen,
  plotTop,
  plotBottom,
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
        layersOut.push({
          key: `${column.proj.item.id}-${contact.id}`,
          formationId: contact.formation_id,
          formationName: formation.name,
          color: formation.color,
          segLeftX: column.nudgedX - halfW,
          segRightX: column.nudgedX + halfW,
          segY,
          bodyTopY,
          bodyBottomY,
          labelX: column.nudgedX,
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

  if (layers.length === 0 && polylines.length === 0) return null

  return (
    <g pointerEvents="none">
      {/* Cross-column polylines (formation surfaces). Drawn first so
          the per-column top segments + name labels paint on top. */}
      {polylines.map(line => {
        if (line.vertices.length < 2) return null
        const path = line.vertices
          .map(
            (v, i) =>
              `${i === 0 ? 'M' : 'L'} ${v.screenX.toFixed(2)} ${v.screenY.toFixed(2)}`,
          )
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
          />
        )
      })}

      {/* Per-column horizontal segments at each contact top + name
          label in the layer's vertical middle. Each layer is one
          formation slab at one column. */}
      {layers.map(layer => {
        const labelY = (layer.bodyTopY + layer.bodyBottomY) / 2
        const layerHeight = layer.bodyBottomY - layer.bodyTopY
        const showLabel = layerHeight >= LAYER_LABEL_MIN_HEIGHT_PX
        const labelWidth = layer.segRightX - layer.segLeftX
        const display = showLabel ? truncateToWidth(layer.formationName, labelWidth) : ''
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
                strokeWidth={1.75}
                strokeOpacity={0.95}
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
              >
                {display}
              </text>
            )}
          </g>
        )
      })}
    </g>
  )
}
