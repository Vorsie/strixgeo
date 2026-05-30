// Pure helpers for the surface-crossings banner → section-view focus
// flow (dogfeed 2026-05-30).
//
// Given a crossing issue (a list of offending contact ids), resolve:
//   * Which investigations (boreholes / CPTs) are anchored by those
//     contacts.
//   * Which cross-sections contain at least one of those anchors
//     within their projection buffer.
//
// Used by the Geology + Sections inspectors' crossings-banner click
// handler to decide between (a) direct navigation (single candidate)
// and (b) opening the section-picker dialog (multiple candidates).
//
// Pure functions, no React. Behaviour pinned in
// ``crossingFocus.test.ts`` so a future refactor cannot quietly drop
// the "all sections containing ANY offending anchor" rule.

import type {
  CrossSectionResponse,
  FormationContactResponse,
} from '../api/client'
import { projectPointOntoLine } from './sectionProjection'

/** Minimal anchor shape — matches both ``*ListItem`` (always-non-null
 *  coords) and ``*Response`` (nullable). Lets the helper accept either
 *  source without an explicit cast. */
interface AnchorPoint {
  id: string
  location_x: number | null
  location_y: number | null
}

/**
 * Sections that contain at least one offending anchor within their
 * projection buffer.
 *
 * The candidate list is returned in the same order as ``sections``
 * (stable for the picker dialog). Sections that don't carry the
 * crossing's contacts are excluded — they have no offending column
 * to pan to.
 *
 * Returns an empty list when no contact resolves to an anchor (the
 * contact ids referenced rows that have since been deleted, or
 * anchors are missing coordinates).
 */
export function resolveCandidateCrossingSections(
  contactIds: readonly string[],
  contacts: readonly FormationContactResponse[],
  sections: readonly CrossSectionResponse[],
  boreholes: readonly AnchorPoint[],
  cpts: readonly AnchorPoint[],
): CrossSectionResponse[] {
  if (contactIds.length === 0) return []
  const offending = contacts.filter(c => contactIds.includes(c.id))
  if (offending.length === 0) return []
  const anchorPoints: Array<{ x: number; y: number }> = []
  for (const c of offending) {
    if (c.borehole_id) {
      const bh = boreholes.find(b => b.id === c.borehole_id)
      if (bh && bh.location_x !== null && bh.location_y !== null) {
        anchorPoints.push({ x: bh.location_x, y: bh.location_y })
      }
    } else if (c.cpt_id) {
      const cpt = cpts.find(p => p.id === c.cpt_id)
      if (cpt && cpt.location_x !== null && cpt.location_y !== null) {
        anchorPoints.push({ x: cpt.location_x, y: cpt.location_y })
      }
    }
  }
  if (anchorPoints.length === 0) return []
  return sections.filter(s =>
    anchorPoints.some(p => {
      const proj = projectPointOntoLine(s, p.x, p.y)
      return proj !== null && Math.abs(proj.offset) <= s.projection_buffer_m
    }),
  )
}
