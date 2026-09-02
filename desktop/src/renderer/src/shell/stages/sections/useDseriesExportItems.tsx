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
import type { SectionLike } from '../../../utils/assembleLithoSectionInputs'
import type { SectionPartitionInput } from '../../../utils/buildVoxelRequest'
import { buildSectionExportPartition } from './buildSectionExportPartition'
import { useSectionExportInputs } from './useSectionExportInputs'
import { downloadSectionExport } from './downloadSectionExport'
import { useT } from '../../../i18n/translate'
import type { MessageKey } from '../../../i18n/locales/en'

/** Which D-Series artefact a press is for. */
type DseriesKind = 'dstability' | 'dsheetpiling'

/** Per-artefact wire facts + message KEYS, so the two handlers are one function
 *  and every user-facing string resolves through the active locale. The
 *  ``extension`` is a wire value (the file suffix) and stays a literal. */
const ARTEFACTS: Record<
  DseriesKind,
  {
    labelKey: MessageKey
    busyLabelKey: MessageKey
    extension: string
    filterLabelKey: MessageKey
    successKey: MessageKey
    failureKey: MessageKey
    testid: string
    /** Key for what the tooltip says the file will contain, after the level. */
    describesKey: MessageKey
  }
> = {
  dstability: {
    labelKey: 'sections.export.dstability',
    busyLabelKey: 'sections.export.exportingDstability',
    extension: 'stix',
    filterLabelKey: 'sections.export.dstabilityFilter',
    successKey: 'sections.export.dstabilitySuccess',
    failureKey: 'sections.export.dstabilityFailure',
    testid: 'export-section-dstability',
    describesKey: 'sections.export.dstabilityDescribes',
  },
  dsheetpiling: {
    labelKey: 'sections.export.dsheetpiling',
    busyLabelKey: 'sections.export.exportingDsheetpiling',
    extension: 'shi',
    filterLabelKey: 'sections.export.dsheetpilingFilter',
    successKey: 'sections.export.dsheetpilingSuccess',
    failureKey: 'sections.export.dsheetpilingFailure',
    testid: 'export-section-dsheetpiling',
    describesKey: 'sections.export.dsheetpilingDescribes',
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
  // The investigations + packing-class map + both axes' models/layers now come
  // from the shared ``useSectionExportInputs`` hook (the PDF sheet is the second
  // consumer). Only the toast bus is still read straight off the shell.
  const {
    project,
    investigations,
    packingClassOf,
    activeLithoModel,
    lithoLayers,
    geotechLayers,
  } = useSectionExportInputs()
  const {
    toasts: { toast },
  } = useShell()
  const t = useT()

  const [exporting, setExporting] = useState<DseriesKind | null>(null)

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
            err instanceof Error ? err.message : t('sections.export.readFailed'),
          )
          return
        }
        if (partition === null) {
          toast('error', t('sections.export.nothingDrawn', { level: axisLevelLabel }))
          return
        }

        const spec = ARTEFACTS[kind]
        await downloadSectionExport({
          sectionName: selectedSection.name,
          extension: spec.extension,
          filterLabel: t(spec.filterLabelKey),
          successMessage: t(spec.successKey),
          failureMessage: t(spec.failureKey),
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
      t,
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
          label: busy ? t(spec.busyLabelKey) : t(spec.labelKey),
          icon: kind === 'dstability' ? <Mountain size={12} /> : <Ruler size={12} />,
          onClick: () => void runExport(kind),
          disabled: !hasSection || !hasModel || exporting !== null,
          title: !hasSection
            ? t('sections.export.selectSection')
            : !hasModel
              ? t('sections.export.noModelContacts', { level: axisLevelLabel })
              : busy
                ? t('sections.busy.exporting')
                : t('sections.export.dseriesRowTitle', {
                    level: axisLevelLabel,
                    describes: t(spec.describesKey),
                  }),
          testid: spec.testid,
        }
      }),
    [exporting, hasSection, hasModel, axisLevelLabel, runExport, t],
  )
}
