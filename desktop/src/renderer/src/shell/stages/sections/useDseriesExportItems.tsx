// The Export menu's two D-Series rows — D-Stability (.stix) and D-Sheet Piling
// (.shi) — plus the handlers behind them.
//
// A hook module rather than another block inside ``SectionsToolbar`` because
// that file is already past the god-component threshold (debt #201) and this
// slice is self-contained: it needs the open section, the axis model, and the
// same shell data the partition is assembled from, and it produces two
// ``ToolbarDropdownItem``s.
//
// WHAT MAKES THESE TWO DIFFERENT from Section DXF / Section PDF / Plaxis 2D:
// those are pure GETs — the backend rebuilds the geometry from the model rows.
// The D-Series pair is the CLOSED-geometry family: the model D-Stability opens
// IS the section's filled polygons, and that fill is computed in the renderer,
// so the drawn partition travels in the POST body. See
// ``buildSectionExportPartition`` for why it is assembled here and not read off
// a canvas ref.

import { useCallback, useMemo, useState } from 'react'
import { Mountain, Ruler } from 'lucide-react'

import { api } from '../../../api/client'
import { useShell } from '../../ShellContext'
import type { ToolbarDropdownItem } from '../../ToolbarPrimitives'
import type { GeologicalModelResponse } from '../../../api/clients/geology.types'
import type {
  InvestigationLocation,
  SectionLike,
} from '../../../utils/assembleLithoSectionInputs'
import type { SectionPartitionInput } from '../../../utils/buildVoxelRequest'
import { buildPackingClassOf } from '../../../utils/geotechHierarchicalFill/packingClassOf'
import { buildSectionExportPartition } from './buildSectionExportPartition'
import { downloadSectionExport } from './downloadSectionExport'

/** Which D-Series artefact a press is for. */
type DseriesKind = 'dstability' | 'dsheetpiling'

/** Per-artefact copy + wire call, so the two handlers are one function. */
const ARTEFACTS: Record<
  DseriesKind,
  {
    label: string
    busyLabel: string
    extension: string
    filterLabel: string
    successMessage: string
    failureMessage: string
    testid: string
    /** What the tooltip says the file will contain, after the model level. */
    describes: string
  }
> = {
  dstability: {
    label: 'D-Stability (.stix)',
    busyLabel: 'Exporting D-Stability…',
    extension: 'stix',
    filterLabel: 'D-Stability model',
    successMessage: 'D-Stability model exported.',
    failureMessage: 'Could not export the D-Stability model.',
    testid: 'export-section-dstability',
    describes: 'model as a D-Stability .stix (geometry only — no design parameters)',
  },
  dsheetpiling: {
    label: 'D-Sheet Piling (.shi)',
    busyLabel: 'Exporting D-Sheet Piling…',
    extension: 'shi',
    filterLabel: 'D-Sheet Piling profile',
    successMessage: 'D-Sheet Piling profile exported.',
    failureMessage: 'Could not export the D-Sheet Piling profile.',
    testid: 'export-section-dsheetpiling',
    describes:
      'model as a D-Sheet Piling .shi soil profile through the section (geometry only)',
  },
}

/** Axis facts the toolbar has already derived; re-deriving them would drift. */
export interface DseriesExportItemsParams {
  /** The model whose contacts the export must contain (``axisModelForExport``). */
  axisModel: GeologicalModelResponse | null
  /** The open cross-section, or null when none is selected. */
  selectedSection: (SectionLike & { name: string }) | null
  /** Whether the section panel is on the geotechnical axis. */
  isGeotech: boolean
  /** ``'lithostratigraphic'`` / ``'geotechnical'`` / ``'geological'`` — for the tooltip. */
  axisLevelLabel: string
}

/**
 * Build the Export dropdown's two D-Series rows.
 *
 * Mirrors the Section DXF row's gating exactly — a section must be open and the
 * open axis must have an active model — so the engineer never meets a rule here
 * that does not apply one row above.
 *
 * Parameters
 * ----------
 * params : DseriesExportItemsParams
 *     The axis facts the toolbar derived; everything else is read from the
 *     shell bus, which is where the partition's inputs already live.
 *
 * Returns
 * -------
 * ToolbarDropdownItem[]
 *     The two rows, ready to concatenate into ``exportMenuItems``.
 */
export function useDseriesExportItems(
  params: DseriesExportItemsParams,
): ToolbarDropdownItem[] {
  const { axisModel, selectedSection, isGeotech, axisLevelLabel } = params
  const {
    project,
    visibleCpts,
    visibleBoreholes,
    geoModel: { activeLithoModel, lithoLayers, geotechLayers, geotechFormations },
    toasts: { toast },
  } = useShell()

  const [exporting, setExporting] = useState<DseriesKind | null>(null)

  // Canonical anchor order — CPTs first, then boreholes — the same composition
  // ``useProjectBodyRecompute`` feeds the build with, so the export's columns
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
  // framed geotech fill reads it; a litho export passes undefined.
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

  const runExport = useCallback(
    async (kind: DseriesKind): Promise<void> => {
      const projectId = project?.id ?? null
      if (projectId === null || selectedSection === null || axisModel === null) return
      if (exporting !== null) return
      setExporting(kind)
      try {
        // The partition is assembled BEFORE the save dialog, unlike the pure-GET
        // exports: it can refuse (nothing drawn) or throw (correlations failed to
        // load), and asking the engineer to name a file first and only then
        // saying "there was nothing to write" is the wrong order for a press
        // that can legitimately have nothing to export.
        let partition: SectionPartitionInput | null
        try {
          partition = await buildSectionExportPartition({
            projectId,
            modelId: axisModel.id,
            section: selectedSection,
            investigations,
            layers: isGeotech ? geotechLayers : lithoLayers,
            viewState: project?.view_state,
            logLabel: `section-export-${kind}`,
            // On the geotech axis the drawn fill is the packing bands framed on
            // the litho units, so the export must be framed the same way or it
            // would not be the section the engineer is looking at.
            frameModelId: isGeotech ? (activeLithoModel?.id ?? null) : null,
            frameLayers: isGeotech ? lithoLayers : undefined,
            packingClassOf: isGeotech ? packingClassOf : undefined,
          })
        } catch (err) {
          toast(
            'error',
            err instanceof Error
              ? err.message
              : 'Could not read this section — nothing was exported.',
          )
          return
        }
        if (partition === null) {
          toast(
            'error',
            `Nothing to export — this section has no drawn ${axisLevelLabel} geometry ` +
              'between two columns.',
          )
          return
        }

        const spec = ARTEFACTS[kind]
        await downloadSectionExport({
          sectionName: selectedSection.name,
          extension: spec.extension,
          filterLabel: spec.filterLabel,
          successMessage: spec.successMessage,
          failureMessage: spec.failureMessage,
          logLabel: kind === 'dstability' ? 'exportDstability' : 'exportDsheetPiling',
          toast,
          fetchBytes: () =>
            kind === 'dstability'
              ? api.section.exportDstability(
                  projectId,
                  selectedSection.id,
                  axisModel.id,
                  partition,
                )
              : api.section.exportDsheetPiling(
                  projectId,
                  selectedSection.id,
                  axisModel.id,
                  partition,
                ),
        })
      } finally {
        setExporting(null)
      }
    },
    [
      project?.id,
      project?.view_state,
      selectedSection,
      axisModel,
      exporting,
      investigations,
      isGeotech,
      geotechLayers,
      lithoLayers,
      activeLithoModel?.id,
      packingClassOf,
      axisLevelLabel,
      toast,
    ],
  )

  const hasSection = selectedSection !== null
  const hasModel = axisModel !== null

  return useMemo(
    () =>
      (['dstability', 'dsheetpiling'] as const).map(kind => {
        const spec = ARTEFACTS[kind]
        const busy = exporting === kind
        return {
          label: busy ? spec.busyLabel : spec.label,
          icon: kind === 'dstability' ? <Mountain size={12} /> : <Ruler size={12} />,
          onClick: () => void runExport(kind),
          disabled: !hasSection || !hasModel || exporting !== null,
          title: !hasSection
            ? 'Select a section to export'
            : !hasModel
              ? `No active ${axisLevelLabel} model — contacts must exist first`
              : busy
                ? 'Exporting…'
                : `Export this section's ${axisLevelLabel} ${spec.describes}`,
          testid: spec.testid,
        }
      }),
    [exporting, hasSection, hasModel, axisLevelLabel, runExport],
  )
}
