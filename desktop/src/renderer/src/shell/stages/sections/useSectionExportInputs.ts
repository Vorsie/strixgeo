// The shell reads the closed-geometry / PDF exporters share: the anchor-ordered
// investigation list and the geotech mass-identity map, plus both axes' models,
// layers and formations. Consumed by the Export hub's ``useExportHub`` (D-Series
// partition assembly) and by the cross-section PDF sheet builder (``useSheetPayload``)
// — it needs BOTH axes so the sheet's fill toggle can render litho or geotech
// from one hook (installer #35 moved every export into the Export stage).

import { useMemo } from 'react'

import type {
  BoreholeListItem,
  CptListItem,
  ProjectResponse,
} from '../../../api/client'
import type {
  GeologicalFormationResponse,
  GeologicalModelResponse,
  LithoLayerResponse,
} from '../../../api/clients/geology.types'
import type { InvestigationLocation } from '../../../utils/assembleLithoSectionInputs'
import { buildPackingClassOf } from '../../../utils/geotechHierarchicalFill/packingClassOf'
import { useShell } from '../../ShellContext'

/** Everything the Sections-stage exporters (D-Series + the PDF sheet) read. */
export interface SectionExportInputs {
  project: ProjectResponse
  visibleCpts: CptListItem[]
  visibleBoreholes: BoreholeListItem[]
  /** CPT-then-borehole anchor order — the composition the build feeds too. */
  investigations: InvestigationLocation[]
  /** Geotech formation id → canonical class key (one mass one body). */
  packingClassOf: ReadonlyMap<string, string>
  activeLithoModel: GeologicalModelResponse | null
  activeGeotechModel: GeologicalModelResponse | null
  lithoLayers: LithoLayerResponse[]
  geotechLayers: LithoLayerResponse[]
  lithoFormations: GeologicalFormationResponse[]
  geotechFormations: GeologicalFormationResponse[]
}

/**
 * Read the Sections-stage export inputs off the shell bus.
 *
 * Returns
 * -------
 * SectionExportInputs
 *     The anchor-ordered investigations, the geotech packing-class map, and
 *     both axes' model / layers / formations.
 */
export function useSectionExportInputs(): SectionExportInputs {
  const {
    project,
    visibleCpts,
    visibleBoreholes,
    geoModel: {
      activeLithoModel,
      activeGeotechModel,
      lithoLayers,
      geotechLayers,
      lithoFormations,
      geotechFormations,
    },
  } = useShell()

  // Canonical anchor order — CPTs first, then boreholes — the same composition
  // ``useProjectBodyRecompute`` feeds the build with, so an export's columns
  // land in the same order the built model's do.
  const investigations = useMemo<InvestigationLocation[]>(
    () => [
      ...visibleCpts.map(c => ({
        id: c.id,
        location_x: c.location_x,
        location_y: c.location_y,
        elevation_m: c.elevation_m,
      })),
      ...visibleBoreholes.map(b => ({
        id: b.id,
        location_x: b.location_x,
        location_y: b.location_y,
        elevation_m: b.elevation_m,
      })),
    ],
    [visibleCpts, visibleBoreholes],
  )

  // Geotech mass identity (owner 2026-08-21: one mass one body). Only the
  // framed geotech fill reads it; a litho export ignores it.
  const packingClassOf = useMemo(
    () =>
      buildPackingClassOf(
        geotechFormations.map(
          f =>
            [
              f.id,
              { nadClass: f.nad_class ?? null, soilCode: f.litho_main_soil_code ?? null },
            ] as const,
        ),
      ),
    [geotechFormations],
  )

  // Stable object identity across renders (only re-created when an input
  // changes) so a downstream ``useCallback`` keyed on the whole result does not
  // rebuild every render — which would spin the sheet preview's build effect.
  return useMemo(
    () => ({
      project,
      visibleCpts,
      visibleBoreholes,
      investigations,
      packingClassOf,
      activeLithoModel,
      activeGeotechModel,
      lithoLayers,
      geotechLayers,
      lithoFormations,
      geotechFormations,
    }),
    [
      project,
      visibleCpts,
      visibleBoreholes,
      investigations,
      packingClassOf,
      activeLithoModel,
      activeGeotechModel,
      lithoLayers,
      geotechLayers,
      lithoFormations,
      geotechFormations,
    ],
  )
}
