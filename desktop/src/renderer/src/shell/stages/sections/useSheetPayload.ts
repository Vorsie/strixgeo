/**
 * Assembles the ``SheetPayload`` from what the Sections stage already has:
 * the drawn partition (``buildSectionExportPartition`` — the D-Series path),
 * the column logs (the panel's own fetches), the axis formations, and every
 * investigation for the map. ``assembleSheetPayload`` is pure and tested;
 * ``useSheetPayload`` is the thin async hook around it that picks the axis from
 * the sheet's fill setting (litho / geotech) so the preview's fill toggle
 * actually re-draws.
 */
import { useCallback } from 'react'

import type { BoreholeDetailResponse } from '../../../api/clients/borehole'
import type { CptPlotResponse } from '../../../api/clients/cpt'
import type { CrossSectionResponse } from '../../../api/clients/section'
import { fetchSectionLogs } from '../../../components/sections/fetchSectionLogs'
import { getLanguage } from '../../../i18n/languageSelect'
import { splitInvestigationName } from '../../../sheet/investigationName'
import { assignProjectColours, normaliseProjectKey } from '../../../sheet/projectPalette'
import { LEVEL_PAD_M } from '../../../sheet/sheetConstants'
import type {
  SheetColumn,
  SheetMapPoint,
  SheetPayload,
  SheetProjectLegendRow,
  SheetSettings,
} from '../../../sheet/sheetPayload'
import { readBasemapId } from '../../../utils/basemapSources'
import type { SectionPartitionInput } from '../../../utils/buildVoxelRequest'
import { buildSectionExportPartition } from './buildSectionExportPartition'
import { useSectionExportInputs } from './useSectionExportInputs'

/** One investigation as the sheet builder reads it (map point + column log). */
export interface SheetInvestigation {
  id: string
  kind: 'cpt' | 'borehole'
  name: string
  location_x: number
  location_y: number
  elevation_m: number | null
  total_depth_m: number | null
  cpt_type: string | null
}

export interface AssembleInput {
  language: 'en' | 'nl'
  section: {
    id: string
    name: string
    epsg: number
    start_x: number
    start_y: number
    end_x: number
    end_y: number
    view_state: Record<string, unknown> | null
  }
  partition: SectionPartitionInput
  investigations: readonly SheetInvestigation[]
  cptPlots: ReadonlyMap<string, CptPlotResponse>
  boreholeDetails: ReadonlyMap<string, BoreholeDetailResponse>
  units: readonly { id: string; name: string; color: string; display_order: number }[]
  basemapId: string
  settings: SheetSettings
}

/**
 * Turn the drawn partition + logs + units + investigations into a
 * ``SheetPayload``. Pure — no React, no I/O — so it is unit-tested directly.
 */
export function assembleSheetPayload(input: AssembleInput): SheetPayload {
  const byId = new Map(input.investigations.map(i => [i.id, i]))
  const columnsSorted = [...input.partition.columns].sort((a, b) => a.along_m - b.along_m)
  const onProfileIds = new Set(columnsSorted.map(c => c.investigation_id))
  const keyOf = (id: string): string => splitInvestigationName(byId.get(id)?.name ?? '').projectKey
  const keysInOrder = [
    ...columnsSorted.map(c => keyOf(c.investigation_id)),
    ...input.investigations.filter(i => !onProfileIds.has(i.id)).map(i => keyOf(i.id)),
  ]
  const colourOf = assignProjectColours(keysInOrder)
  const columns: SheetColumn[] = columnsSorted.map(c => {
    const inv = byId.get(c.investigation_id)
    const { projectKey, code } = splitInvestigationName(inv?.name ?? c.investigation_id)
    return {
      investigationId: c.investigation_id,
      kind: inv?.kind ?? 'cpt',
      name: inv?.name ?? c.investigation_id,
      code,
      projectKey,
      colourIndex: colourOf.get(normaliseProjectKey(projectKey)) ?? 0,
      alongM: c.along_m,
      collarElevationM: inv?.elevation_m ?? 0,
      totalDepthM: inv?.total_depth_m ?? 0,
      cptType: inv?.cpt_type ?? null,
      plot: input.cptPlots.get(c.investigation_id) ?? null,
      detail: input.boreholeDetails.get(c.investigation_id) ?? null,
    }
  })
  const regionLevels = input.partition.regions.flatMap(r => r.polygon.map(p => p[1]))
  const levelMaxM = Math.max(...columns.map(c => c.collarElevationM), ...regionLevels) + LEVEL_PAD_M
  const levelMinM =
    Math.min(...columns.map(c => c.collarElevationM - c.totalDepthM), ...regionLevels) - LEVEL_PAD_M
  const points: SheetMapPoint[] = input.investigations.map(i => {
    const { projectKey, code } = splitInvestigationName(i.name)
    return {
      investigationId: i.id,
      kind: i.kind,
      code,
      colourIndex: colourOf.get(normaliseProjectKey(projectKey)) ?? 0,
      worldX: i.location_x,
      worldY: i.location_y,
      onProfile: onProfileIds.has(i.id),
    }
  })
  const legend: SheetProjectLegendRow[] = [...colourOf.entries()].map(([projectKey, colourIndex]) => ({
    projectKey,
    colourIndex,
    codes: [
      ...columns.filter(c => normaliseProjectKey(c.projectKey) === projectKey).map(c => c.code),
      ...points
        .filter(p => !p.onProfile && normaliseProjectKey(keyOf(p.investigationId)) === projectKey)
        .map(p => p.code),
    ],
  }))
  const lengthM = Math.hypot(
    input.section.end_x - input.section.start_x,
    input.section.end_y - input.section.start_y,
  )
  return {
    language: input.language,
    section: {
      id: input.section.id,
      name: input.section.name,
      epsg: input.section.epsg,
      lengthM,
      startX: input.section.start_x,
      startY: input.section.start_y,
      endX: input.section.end_x,
      endY: input.section.end_y,
      viewState: input.section.view_state,
    },
    columns,
    regions: input.partition.regions,
    units: input.units.map(u => ({
      formationId: u.id,
      name: u.name,
      colour: u.color,
      displayOrder: u.display_order,
    })),
    levelMaxM,
    levelMinM,
    map: { basemapId: input.basemapId, points, legend },
    settings: input.settings,
  }
}

/**
 * Build callback for the preview dialog. Returns ``null`` when the chosen fill
 * axis has no model or nothing drawn (the dialog then disables Export).
 *
 * Parameters
 * ----------
 * params.selectedSection : the open cross-section, or null.
 */
export function useSheetPayload(params: {
  selectedSection: CrossSectionResponse | null
}): (settings: SheetSettings) => Promise<SheetPayload | null> {
  const inputs = useSectionExportInputs()
  const selectedSection = params.selectedSection
  return useCallback(
    async (settings: SheetSettings): Promise<SheetPayload | null> => {
      const isGeotech = settings.fill === 'geotech'
      const axisModel = isGeotech ? inputs.activeGeotechModel : inputs.activeLithoModel
      const layers = isGeotech ? inputs.geotechLayers : inputs.lithoLayers
      const formations = isGeotech ? inputs.geotechFormations : inputs.lithoFormations
      if (!inputs.project || !selectedSection || !axisModel) return null
      const partition = await buildSectionExportPartition({
        projectId: inputs.project.id,
        modelId: axisModel.id,
        section: selectedSection,
        investigations: inputs.investigations,
        layers,
        viewState: inputs.project.view_state,
        logLabel: 'section-sheet',
        // On the geotech axis the drawn fill is the packing bands framed on the
        // litho units, so the sheet must be framed the same way or it is not
        // the section the engineer is looking at.
        frameModelId: isGeotech ? (inputs.activeLithoModel?.id ?? null) : null,
        frameLayers: isGeotech ? inputs.lithoLayers : undefined,
        packingClassOf: isGeotech ? inputs.packingClassOf : undefined,
      })
      if (!partition || partition.regions.length === 0) return null
      const ids = new Set(partition.columns.map(c => c.investigation_id))
      const cptIds = inputs.visibleCpts.filter(c => ids.has(c.id)).map(c => c.id)
      const bhIds = inputs.visibleBoreholes.filter(b => ids.has(b.id)).map(b => b.id)
      const logs = await fetchSectionLogs(inputs.project.id, cptIds, bhIds)
      const investigations: SheetInvestigation[] = [
        ...inputs.visibleCpts.map(c => ({
          id: c.id,
          kind: 'cpt' as const,
          name: c.name,
          location_x: c.location_x,
          location_y: c.location_y,
          elevation_m: c.elevation_m,
          total_depth_m: c.max_depth_m,
          cpt_type: c.cpt_type,
        })),
        ...inputs.visibleBoreholes.map(b => ({
          id: b.id,
          kind: 'borehole' as const,
          name: b.name,
          location_x: b.location_x,
          location_y: b.location_y,
          elevation_m: b.elevation_m,
          total_depth_m: b.total_depth_m,
          cpt_type: null,
        })),
      ]
      return assembleSheetPayload({
        language: getLanguage(),
        section: selectedSection,
        partition,
        investigations,
        cptPlots: logs.cptPlots,
        boreholeDetails: logs.boreholeDetails,
        units: formations,
        basemapId: readBasemapId(),
        settings,
      })
    },
    [inputs, selectedSection],
  )
}
