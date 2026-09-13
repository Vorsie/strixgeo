// The single source of truth for HOW a section's export partition is configured
// from the shell's export inputs — so the Export hub assembles the same drawn
// polygons the Sections toolbar used to (owner ruling, installer #35: "a section
// export from the hub equals the one the toolbar made").
//
// The closed-geometry exports (D-Stability .stix, D-Sheet .shi) and the PDF
// sheet all POST the section's fill, computed in the renderer. Which model, which
// layer set, and whether the fill is FRAMED on the litho model (the geotech axis)
// is axis-dependent — and it MUST be derived identically wherever the export
// runs, or the hub would ship a different partition than the toolbar did. This
// module is that derivation, extracted verbatim from the toolbar's
// ``useDseriesExportItems`` so the two cannot drift. ``buildSectionExportPartition``
// consumes the result; ``useSheetPayload`` reaches it through the same path.

import type { SectionModelAxis } from '../../../hooks/useSections'
import type { GeologicalModelResponse } from '../../../api/clients/geology.types'
import type { LithoLayerLike, SectionLike } from '../../../utils/assembleLithoSectionInputs'
import type { InvestigationLocation } from '../../../utils/assembleLithoSectionInputs'
import type { SectionExportPartitionParams } from '../sections/buildSectionExportPartition'

/**
 * The shell-level export inputs the partition is configured from.
 *
 * Every field carries the meaning it has on the shell bus / in
 * ``useSectionExportInputs`` — deliberately, so the hub configures an export
 * exactly the way the Sections toolbar did.
 */
export interface SectionExportContext {
  /** The open project's id. */
  projectId: string
  /** Active model per axis — the export must contain THIS axis's contacts. */
  activeGeologicalModel: GeologicalModelResponse | null
  activeLithoModel: GeologicalModelResponse | null
  activeGeotechModel: GeologicalModelResponse | null
  /** CPT-then-borehole anchor order — the composition the build feeds too. */
  investigations: readonly InvestigationLocation[]
  /** The litho model's accepted layer rows. */
  lithoLayers: readonly LithoLayerLike[]
  /** The geotech model's band rows. */
  geotechLayers: readonly LithoLayerLike[]
  /** Geotech formation id → canonical class key (one mass one body). */
  packingClassOf: ReadonlyMap<string, string>
  /** The project's view_state bag (voxel-spacing prefs live there). */
  viewState: Record<string, unknown> | null | undefined
}

/**
 * The active model for one axis.
 *
 * Parameters
 * ----------
 * ctx : SectionExportContext
 *     The shell export inputs.
 * axis : SectionModelAxis
 *     Which model level the section is being exported on.
 *
 * Returns
 * -------
 * GeologicalModelResponse | null
 *     The axis's active model, or ``null`` when that level has none.
 */
export function axisModelFor(
  ctx: SectionExportContext,
  axis: SectionModelAxis,
): GeologicalModelResponse | null {
  switch (axis) {
    case 'geological':
      return ctx.activeGeologicalModel
    case 'lithostratigraphic':
      return ctx.activeLithoModel
    case 'geotechnical':
      return ctx.activeGeotechModel
  }
}

/**
 * Configure the drawn partition for one section on one axis.
 *
 * The geotech axis FRAMES the fill on the litho model (owner ruling 2026-08-18,
 * "densities on top of lithos"): with the frame the export carries the
 * hierarchical packing bands the geotech axis renders, so the exported model IS
 * the section the engineer looks at. The litho / geological axes use the model's
 * own whole-section partition and pass no frame.
 *
 * Parameters
 * ----------
 * ctx : SectionExportContext
 *     The shell export inputs.
 * section : SectionLike | null
 *     The section being exported, or ``null`` when none is chosen.
 * axis : SectionModelAxis
 *     The model level to export on.
 * logLabel : string
 *     Log channel for the assembly (a diagnostic label; not part of the
 *     partition's geometry).
 *
 * Returns
 * -------
 * SectionExportPartitionParams | null
 *     The params to hand ``buildSectionExportPartition``, or ``null`` when the
 *     axis has no active model or no section is chosen — either means "refuse",
 *     never "post an empty model".
 */
export function sectionExportPartitionArgs(
  ctx: SectionExportContext,
  section: SectionLike | null,
  axis: SectionModelAxis,
  logLabel: string,
): SectionExportPartitionParams | null {
  const axisModel = axisModelFor(ctx, axis)
  if (axisModel === null || section === null) return null
  const isGeotech = axis === 'geotechnical'
  return {
    projectId: ctx.projectId,
    modelId: axisModel.id,
    section,
    investigations: ctx.investigations,
    layers: isGeotech ? ctx.geotechLayers : ctx.lithoLayers,
    viewState: ctx.viewState,
    logLabel,
    // On the geotech axis the drawn fill is the packing bands framed on the
    // litho units, so the export must be framed the same way or it would not be
    // the section the engineer is looking at.
    frameModelId: isGeotech ? (ctx.activeLithoModel?.id ?? null) : null,
    frameLayers: isGeotech ? ctx.lithoLayers : undefined,
    packingClassOf: isGeotech ? ctx.packingClassOf : undefined,
  }
}
