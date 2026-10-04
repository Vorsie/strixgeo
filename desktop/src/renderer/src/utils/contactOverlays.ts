// Detail-pane contact overlays — pure helper.
//
// Given the active geological + lithostratigraphic models, returns the
// list of horizontal lines to render on a CPT or borehole detail chart
// so the engineer keeps depth context (formation tops + litho-unit tops)
// while reading the qc / Ic / drill-log trace. Each overlay is faded and
// labelled with the formation name + colour.
//
// Pure: no React, no side effects, no API. Lives in utils/ so both
// CptChart and BoreholeLog can use the same shape.

import type {
  FormationContactResponse,
  GeologicalFormationResponse,
} from '../api/client'

/**
 * One horizontal contact line to render on a detail chart.
 *
 * ``depth_m`` is depth below ground surface (positive down), matching
 * the chart's Y axis. ``color`` is the formation's stored colour
 * (hex / CSS string — used verbatim for stroke + label). ``label`` is
 * the formation display name. ``source`` distinguishes geology from
 * litho overlays so the renderer can stagger labels or pick a different
 * stroke style per source if desired.
 */
export interface ContactOverlay {
  depth_m: number
  color: string
  label: string
  source: 'geology' | 'litho'
  // Stable id so React can key on it across renders. Composed of
  // ``source:contact_id`` so the same DB row keeps the same key
  // whether it's read off the geology list or the litho list.
  key: string
}

export type InvestigationKind = 'cpt' | 'borehole'

/**
 * Build the overlay list for a single investigation across both models.
 *
 * Returns overlays sorted by depth ascending. Contacts whose
 * formation can't be resolved (deleted formation, dangling row) are
 * skipped silently — the chart is informative-only and shouldn't
 * blow up on stale state.
 *
 * @param contacts          All geology contacts in the active geological model.
 * @param formations        All formations in the active geological model.
 * @param lithoContacts     All contacts in the active litho model (may be empty).
 * @param lithoFormations   All formations in the active litho model (may be empty).
 * @param investigationId   The selected CPT or borehole id.
 * @param investigationKind Which key on the contact rows to match
 *                          (``cpt_id`` vs ``borehole_id``).
 * @returns                 Overlay list, ascending by depth_m.
 */
export function buildContactOverlays(
  contacts: readonly FormationContactResponse[],
  formations: readonly GeologicalFormationResponse[],
  lithoContacts: readonly FormationContactResponse[],
  lithoFormations: readonly GeologicalFormationResponse[],
  investigationId: string,
  investigationKind: InvestigationKind,
): ContactOverlay[] {
  const geoById = new Map(formations.map(f => [f.id, f]))
  const lithoById = new Map(lithoFormations.map(f => [f.id, f]))

  const out: ContactOverlay[] = []

  // Anchor predicate — a contact belongs to this investigation when
  // the matching anchor column equals investigationId. Synthetic
  // pinch-out contacts have neither cpt_id nor borehole_id and are
  // never bound to a single investigation, so they don't appear in
  // detail-pane overlays.
  for (const c of contacts) {
    const anchored =
      investigationKind === 'cpt' ? c.cpt_id === investigationId : c.borehole_id === investigationId
    if (!anchored) continue
    const f = geoById.get(c.formation_id)
    if (!f) continue
    out.push({
      depth_m: c.depth_top_m,
      color: f.color,
      label: f.name,
      source: 'geology',
      key: `geology:${c.id}`,
    })
  }

  for (const c of lithoContacts) {
    const anchored =
      investigationKind === 'cpt' ? c.cpt_id === investigationId : c.borehole_id === investigationId
    if (!anchored) continue
    const f = lithoById.get(c.formation_id)
    if (!f) continue
    out.push({
      depth_m: c.depth_top_m,
      color: f.color,
      label: f.name,
      source: 'litho',
      key: `litho:${c.id}`,
    })
  }

  out.sort((a, b) => a.depth_m - b.depth_m)
  return out
}

/**
 * Which overlay sources the detail pane draws.
 *
 * ``geology`` = stratigraphic boundaries (formation contacts of the
 * geological model); ``litho`` = lithological boundaries (contacts of the
 * lithostratigraphic model). Per-user UI chrome, never project data.
 */
export interface ContactOverlayVisibility {
  geology: boolean
  litho: boolean
}

/** Both sources visible: the behaviour before the switches existed. */
export const DEFAULT_CONTACT_OVERLAY_VISIBILITY: Readonly<ContactOverlayVisibility> = {
  geology: true,
  litho: true,
}

/**
 * Drop the overlays whose source the user switched off.
 *
 * Kept separate from ``buildContactOverlays`` so the builder stays a pure
 * description of the models and the visibility choice stays a view filter.
 *
 * @param overlays   Overlays from ``buildContactOverlays``.
 * @param visibility Per-source on/off switches.
 * @returns          The overlays of the visible sources, order kept. The
 *                   input array itself when both sources are visible.
 */
export function filterContactOverlays(
  overlays: readonly ContactOverlay[],
  visibility: Readonly<ContactOverlayVisibility>,
): readonly ContactOverlay[] {
  if (visibility.geology && visibility.litho) return overlays
  return overlays.filter(o => visibility[o.source])
}
