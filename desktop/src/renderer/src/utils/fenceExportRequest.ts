// Assemble the fence-diagram DXF export request from what the 3-D viewer is
// currently painting (owner ballot 2026-08-26 — fence-diagram export).
//
// WHY THE REQUEST CARRIES THE GEOMETRY. Fence walls are built in the renderer
// (``buildProjectFence`` → ``buildFencePanels``) from the section partition
// engine, which has no server-side twin. The server therefore cannot rebuild
// them, and the export endpoint receives them.
//
// WHY IT ALSO CARRIES NAMES AND COLOURS. Both are presentation-boundary values:
// a litho unit's label comes from ``formatLithoDisplayName`` (translated from
// the raw soil code at render time, never stored translated) and a geotech
// unit's colour comes from ``nadColoredFormations`` (the NAD packing colour,
// which overrides the inherited litho colour and is likewise never stored). If
// the server re-derived either, the DXF would disagree with the screen the
// engineer exported it from. So the caller passes the SAME formations array it
// handed the viewer, and what is exported is what was seen.
//
// Coordinates are left untouched: projected project-CRS metres, the space the
// panels are already in and the space the DXF is written in.

import type { GeologicalFormationResponse } from '../api/client'
import type { FencePanel } from './fencePanels'
import { formatLithoDisplayName } from './lithoLabels'

/** One fence wall in the export request. */
export interface FenceExportPanel {
  /** The wall's cross-section; the engine names the DXF layer per section (null: legacy, unsplit). */
  section_id: string | null
  /** The formation this wall belongs to. */
  formation_id: string
  /** The body this wall belongs to, when the fence carries body identity. */
  body_id: string | null
  /** Wall vertices as ``[x_m, y_m, elevation_m]`` in the project CRS. */
  vertices: number[][]
  /** Triangle vertex indices into ``vertices``. */
  triangles: number[][]
  /** Display name — becomes the DXF layer name. */
  name: string
  /** Display colour as ``#rrggbb`` — becomes the DXF layer's true colour. */
  color: string
}

/** Body of ``POST .../export/fence-dxf``. */
export interface FenceExportRequest {
  panels: FenceExportPanel[]
}

/** Grey, matching the viewer's fallback for a formation it cannot resolve. */
const UNKNOWN_FORMATION_COLOR = '#9ca3af'

/**
 * Build the fence-DXF export request from the rendered panels.
 *
 * Parameters
 * ----------
 * panels
 *     The fence walls the viewer is painting, exactly as ``buildProjectFence``
 *     produced them.
 * formations
 *     The formations array passed to the viewer for this same render — already
 *     presentation-coloured (NAD colours on the geotech pane). Anything else
 *     risks a DXF that disagrees with the screen.
 *
 * Returns
 * -------
 * FenceExportRequest
 *     One entry per drawable panel, in render order. Panels with no vertices
 *     or no triangles are dropped: they contribute no geometry, and an empty
 *     named layer in CAD reads as a unit missing from the model rather than as
 *     a unit that was never drawn here.
 *
 *     A panel whose formation is NOT in ``formations`` is kept, not dropped —
 *     it carries real geometry, and silently omitting it would punch an
 *     invisible hole in the deliverable. It is labelled by its raw id so the
 *     anomaly is visible in the layer list.
 */
export function buildFenceExportRequest(
  panels: readonly FencePanel[],
  formations: readonly GeologicalFormationResponse[],
): FenceExportRequest {
  const byId = new Map(formations.map(f => [f.id, f]))

  const exported: FenceExportPanel[] = []
  for (const panel of panels) {
    if (panel.vertices.length === 0 || panel.triangles.length === 0) continue

    const formation = byId.get(panel.formationId)
    exported.push({
      section_id: panel.sectionId ?? null,
      formation_id: panel.formationId,
      body_id: panel.bodyId,
      vertices: panel.vertices.map(v => [v[0], v[1], v[2]]),
      triangles: panel.triangles.map(t => [t[0], t[1], t[2]]),
      name: formationDisplayName(panel.formationId, formation),
      color: normaliseHex(formation?.color) ?? UNKNOWN_FORMATION_COLOR,
    })
  }

  return { panels: exported }
}

/** The label the legend shows for this formation — soil-code translated. */
function formationDisplayName(
  formationId: string,
  formation: GeologicalFormationResponse | undefined,
): string {
  if (!formation) return `Unknown unit ${formationId}`
  return formation.litho_main_soil_code != null
    ? formatLithoDisplayName(formation.litho_main_soil_code, formation.litho_admixtures ?? [])
    : formation.name
}

/** Formation colours arrive with or without the leading hash — settle it. */
function normaliseHex(color: string | undefined | null): string | null {
  if (!color) return null
  return color.startsWith('#') ? color : `#${color}`
}
