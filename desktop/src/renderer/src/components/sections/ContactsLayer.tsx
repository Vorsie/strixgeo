/**
 * Formation-contact overlay for the cross-section.
 *
 * Reads the active geological model's contacts and renders one
 * polyline per formation across the section, with each vertex at
 * the (column X, surface elevation − contact depth) of the borehole
 * or CPT that anchors the contact.
 *
 * Investigations without a contact for a given formation aren't
 * traversed by that formation's polyline — the line jumps from the
 * last borehole that has the formation to the next one (gap-filled
 * by linear interpolation in screen space). That matches DOV's
 * lengteprofiel convention: a formation top is "known" wherever a
 * borehole picked it and is interpolated everywhere else.
 *
 * v1 scope:
 *
 *   * Polyline per formation, in formation colour.
 *   * Small filled circle at each anchor vertex (CPT vs borehole
 *     shape doesn't matter here — the underlying column glyph /
 *     band already conveys the kind).
 *   * Formation name label near the rightmost vertex so the user
 *     can read the section without hovering each line.
 *
 * Deferred to later slices:
 *
 *   * Drag a vertex to change depth → PATCH contact.
 *   * Click on a line segment to inspect / edit.
 *   * Different stroke per ``confidence`` (high / medium / low).
 *   * Cross-formation gap-filling rules (overlapping picks across
 *     boreholes that disagree).
 */

import { useMemo } from 'react'

import type {
  FormationContactResponse,
  GeologicalFormationResponse,
} from '../../api/client'
import type { PlacedColumn } from './utils'

interface Props {
  contacts: readonly FormationContactResponse[]
  formations: readonly GeologicalFormationResponse[]
  /** Every CPT and borehole placed on the section, in projection
   * order. The component looks up each contact's anchor by id to
   * pull screen X + surface elevation. */
  placedColumns: readonly PlacedColumn[]
  levelToScreen: (level: number) => number
  plotTop: number
  plotBottom: number
}

interface ContactVertex {
  contactId: string
  screenX: number
  screenY: number
  /** Along-section X (the column's nudgedX); sort key for the
   * polyline. */
  sortKey: number
}

export default function ContactsLayer({
  contacts,
  formations,
  placedColumns,
  levelToScreen,
  plotTop,
  plotBottom,
}: Props): JSX.Element | null {
  // Build per-formation polylines. Each contact resolves its anchor
  // column (borehole or CPT) by id; without a placed column or a
  // known surface elevation the contact has no screen position and
  // gets skipped.
  const polylines = useMemo(() => {
    if (contacts.length === 0) return [] as {
      formationId: string
      color: string
      name: string
      vertices: ContactVertex[]
    }[]

    // Lookup: column id → its placed-column screen position +
    // surface elevation. The column.proj.item has elevation_m.
    type Anchor = { screenX: number; surfaceElevationM: number }
    const anchorById = new Map<string, Anchor>()
    for (const col of placedColumns) {
      const item = col.proj.item as { id: string; elevation_m: number | null }
      if (item.elevation_m === null) continue
      anchorById.set(item.id, {
        screenX: col.nudgedX,
        surfaceElevationM: item.elevation_m,
      })
    }

    const formationById = new Map<string, GeologicalFormationResponse>()
    for (const f of formations) formationById.set(f.id, f)

    // Per-formation accumulator. We collect vertices keyed by
    // formation id, sort by screenX at the end, then turn into a
    // polyline path.
    const byFormation = new Map<string, ContactVertex[]>()
    for (const c of contacts) {
      const anchorId = c.borehole_id ?? c.cpt_id
      if (!anchorId) continue
      const anchor = anchorById.get(anchorId)
      if (!anchor) continue
      // depth_top_m is measured downward from the surface; level
      // is surface elevation minus that depth.
      const level = anchor.surfaceElevationM - c.depth_top_m
      const screenY = levelToScreen(level)
      if (screenY < plotTop || screenY > plotBottom) continue
      const list = byFormation.get(c.formation_id) ?? []
      list.push({
        contactId: c.id,
        screenX: anchor.screenX,
        screenY,
        sortKey: anchor.screenX,
      })
      byFormation.set(c.formation_id, list)
    }

    const out: {
      formationId: string
      color: string
      name: string
      vertices: ContactVertex[]
    }[] = []
    for (const [formationId, vertices] of byFormation) {
      const formation = formationById.get(formationId)
      if (!formation) continue
      vertices.sort((a, b) => a.sortKey - b.sortKey)
      out.push({
        formationId,
        color: formation.color,
        name: formation.name,
        vertices,
      })
    }
    // Render order: formations with the leftmost first vertex
    // render first, so labels on the right edge of the canvas
    // belong to the rightmost lines (visual reading order).
    out.sort((a, b) => a.vertices[0].sortKey - b.vertices[0].sortKey)
    return out
  }, [contacts, formations, placedColumns, levelToScreen, plotTop, plotBottom])

  if (polylines.length === 0) return null

  return (
    <g pointerEvents="none">
      {polylines.map(line => {
        if (line.vertices.length === 0) return null
        const path = line.vertices
          .map(
            (v, i) =>
              `${i === 0 ? 'M' : 'L'} ${v.screenX.toFixed(2)} ${v.screenY.toFixed(2)}`,
          )
          .join(' ')
        const last = line.vertices[line.vertices.length - 1]
        return (
          <g key={line.formationId}>
            <path
              d={path}
              stroke={line.color}
              strokeWidth={1.5}
              strokeOpacity={0.9}
              fill="none"
            />
            {line.vertices.map(v => (
              <circle
                key={v.contactId}
                cx={v.screenX}
                cy={v.screenY}
                r={3}
                fill={line.color}
                stroke="#ffffff"
                strokeWidth={1}
              />
            ))}
            {/* Formation name label to the right of the last
                vertex so the eye can scan the section and follow
                each line back to its name. ``pointerEvents`` is
                inherited "none" from the parent so the label
                doesn't intercept clicks intended for the columns
                below. */}
            <text
              x={last.screenX + 6}
              y={last.screenY + 3}
              fontSize={9}
              fill={line.color}
              fontWeight={500}
            >
              {line.name}
            </text>
          </g>
        )
      })}
    </g>
  )
}
