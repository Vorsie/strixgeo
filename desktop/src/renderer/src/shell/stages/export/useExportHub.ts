// The Export hub's state + run functions (installer #35 — the Export stage is
// the only export surface). One hook so ``ExportCanvas`` stays presentational
// and under the god-component cap (debt #201).
//
// Every file-producing export routes through the SAME primitives the Sections
// toolbar and 3-D stages used, so what the hub writes is byte-identical to what
// those verbs wrote:
//   * section DXF / Plaxis 2D → the shell bus handlers (``handleExportSection*``);
//   * D-Stability / D-Sheet → ``sectionExportPartitionArgs`` +
//     ``buildSectionExportPartition`` + ``downloadSectionExport`` + ``api.section``;
//   * the PDF sheet → the same ``SheetPreviewDialog`` the toolbar opened;
//   * Plaxis 3D → the model-wide bus handler;
//   * the litho / geotech fence → ``buildProjectFencePanels`` (the viewer's own
//     assembly, stage-independent) + ``exportFenceDxf``.
//
// Each successful write reports its path via the handlers' ``onSaved`` hook, which
// the hub remembers per card (``exportPathMemory``) and shows on the card.

import { useCallback, useMemo, useState } from 'react'

import { api } from '../../../api/client'
import { useShell } from '../../ShellContext'
import { useT } from '../../../i18n/translate'
import type { SectionModelAxis } from '../../../hooks/useSections'
import type { CrossSectionResponse } from '../../../api/client'
import { nadColoredFormations } from '../../../utils/nadClasses'
import { buildProjectFencePanels } from '../shared/makeProjectFenceBuilder'
import { exportFenceDxf } from '../shared/exportFenceDxf'
import { bedPolygonsForCrs } from '../../../utils/bedPolygonMembership'
import { buildSectionExportPartition } from '../sections/buildSectionExportPartition'
import { downloadSectionExport } from '../sections/downloadSectionExport'
import { useSectionExportInputs } from '../sections/useSectionExportInputs'
import {
  axisModelFor,
  sectionExportPartitionArgs,
  type SectionExportContext,
} from './sectionExportPartitionArgs'
import { recallExportPath, rememberExportPath } from './exportPathMemory'

/** One D-Series artefact's wire facts, so the two handlers are one function. */
const DSERIES = {
  dstability: { cardId: 'geotech-dstability', extension: 'stix' },
  dsheetpiling: { cardId: 'geotech-dsheet', extension: 'shi' },
} as const

/** Which export is currently in flight (a card id), or ``null`` when idle. */
export type HubBusy = string | null

/** Everything ``ExportCanvas`` reads + calls. */
export interface ExportHubResult {
  /** The visible cross-sections, for the section picker. */
  sections: CrossSectionResponse[]
  /** The chosen section id (seeded from the toolbar jump), or null. */
  sectionId: string | null
  setSectionId: (id: string | null) => void
  /** The resolved chosen section, or null. */
  section: CrossSectionResponse | null
  hasSections: boolean
  /** Active-model presence per level (drives the cards' empty states). */
  hasStratModel: boolean
  hasLithoModel: boolean
  hasGeotechModel: boolean
  /** The axis the toolbar jump preselected — seeds the Section-DXF + PDF pickers. */
  seedAxis: SectionModelAxis
  /** The card id currently exporting, or null. */
  busy: HubBusy
  /** The remembered last save path for a card, or null. */
  lastPathFor: (cardId: string) => string | null
  runSectionDxf: (axis: SectionModelAxis) => Promise<void>
  runPlaxis3d: () => Promise<void>
  runPlaxis2d: (axis: 'lithostratigraphic' | 'geotechnical') => Promise<void>
  runDseries: (kind: keyof typeof DSERIES, axis: SectionModelAxis) => Promise<void>
  runFence: (which: 'litho' | 'geotech') => Promise<void>
}

/**
 * Own the Export hub's selection, busy state, last-path memory and run
 * functions.
 *
 * Returns
 * -------
 * ExportHubResult
 *     The section list + selection, the per-level model presence, and the six
 *     run functions — one per export family.
 */
export function useExportHub(): ExportHubResult {
  const shell = useShell()
  const t = useT()
  const {
    project,
    geoModel: { activeGeologicalModel, handleExportModelPlaxis3d },
    sections: { visibleSections, selectedSectionId, sectionModelAxis },
    coordinator: { handleExportSectionDxf, handleExportSectionPlaxis2d },
    toasts: { toast },
    bedOverrides,
  } = shell

  const {
    investigations,
    packingClassOf,
    activeLithoModel,
    activeGeotechModel,
    lithoLayers,
    geotechLayers,
    lithoFormations,
    geotechFormations,
  } = useSectionExportInputs()

  // Seed the section picker from the toolbar jump's selection (or the first
  // section). Local state so the engineer can then pick a different section
  // freely — the hub remounts on stage entry, re-seeding from the current
  // selection, which the export deep-link has just set.
  const [sectionId, setSectionId] = useState<string | null>(
    selectedSectionId ?? visibleSections[0]?.id ?? null,
  )
  const [busy, setBusy] = useState<HubBusy>(null)

  // Per-card last-path, seeded once from localStorage for this project.
  const projectId = project.id
  const [lastPaths, setLastPaths] = useState<Record<string, string>>(() => {
    const ids = [
      'section-dxf',
      'plaxis3d',
      'plaxis2d-geotechnical',
      'geotech-dstability',
      'geotech-dsheet',
      'litho-fence',
      'geotech-fence',
    ]
    const seed: Record<string, string> = {}
    for (const id of ids) {
      const p = recallExportPath(projectId, id)
      if (p !== null) seed[id] = p
    }
    return seed
  })
  const lastPathFor = useCallback((cardId: string) => lastPaths[cardId] ?? null, [lastPaths])
  const recordSaved = useCallback(
    (cardId: string) => (path: string) => {
      rememberExportPath(projectId, cardId, path)
      setLastPaths(prev => ({ ...prev, [cardId]: path }))
    },
    [projectId],
  )

  const section = useMemo(
    () => visibleSections.find(s => s.id === sectionId) ?? null,
    [visibleSections, sectionId],
  )

  const ctx = useMemo<SectionExportContext>(
    () => ({
      projectId,
      activeGeologicalModel,
      activeLithoModel,
      activeGeotechModel,
      investigations,
      lithoLayers,
      geotechLayers,
      packingClassOf,
      viewState: project.view_state,
    }),
    [
      projectId,
      activeGeologicalModel,
      activeLithoModel,
      activeGeotechModel,
      investigations,
      lithoLayers,
      geotechLayers,
      packingClassOf,
      project.view_state,
    ],
  )

  const axisLevelLabel = useCallback(
    (axis: SectionModelAxis): string =>
      axis === 'lithostratigraphic'
        ? t('sections.level.litho')
        : axis === 'geotechnical'
          ? t('sections.level.geotech')
          : t('sections.level.geological'),
    [t],
  )

  const runSectionDxf = useCallback(
    async (axis: SectionModelAxis): Promise<void> => {
      const axisModel = axisModelFor(ctx, axis)
      if (section === null || axisModel === null || busy !== null) return
      setBusy('section-dxf')
      try {
        await handleExportSectionDxf(
          projectId,
          section.id,
          section.name,
          axisModel.id,
          recordSaved('section-dxf'),
        )
      } finally {
        setBusy(null)
      }
    },
    [ctx, section, busy, projectId, handleExportSectionDxf, recordSaved],
  )

  const runPlaxis3d = useCallback(async (): Promise<void> => {
    if (activeGeologicalModel === null || busy !== null) return
    setBusy('plaxis3d')
    try {
      await handleExportModelPlaxis3d(recordSaved('plaxis3d'))
    } finally {
      setBusy(null)
    }
  }, [activeGeologicalModel, busy, handleExportModelPlaxis3d, recordSaved])

  const runPlaxis2d = useCallback(
    async (axis: 'lithostratigraphic' | 'geotechnical'): Promise<void> => {
      const axisModel = axisModelFor(ctx, axis)
      if (section === null || axisModel === null || busy !== null) return
      const cardId = `plaxis2d-${axis}`
      setBusy(cardId)
      try {
        await handleExportSectionPlaxis2d(
          projectId,
          section.id,
          section.name,
          axisModel.id,
          recordSaved(cardId),
        )
      } finally {
        setBusy(null)
      }
    },
    [ctx, section, busy, projectId, handleExportSectionPlaxis2d, recordSaved],
  )

  const runDseries = useCallback(
    async (kind: keyof typeof DSERIES, axis: SectionModelAxis): Promise<void> => {
      if (section === null || busy !== null) return
      const args = sectionExportPartitionArgs(ctx, section, axis, `section-export-${kind}`)
      // ``args`` is non-null only when the axis has an active model, so modelId is
      // a string here; narrow it for the api calls, which require ``string``.
      if (args === null || args.modelId === null) return
      const modelId = args.modelId
      const spec = DSERIES[kind]
      setBusy(spec.cardId)
      try {
        // Assemble the drawn partition BEFORE the save dialog: it can refuse
        // (nothing drawn) or throw (correlations failed) — naming a file only to
        // learn there was nothing to write is the wrong order.
        let partition
        try {
          partition = await buildSectionExportPartition(args)
        } catch (err) {
          toast('error', err instanceof Error ? err.message : t('sections.export.readFailed'))
          return
        }
        if (partition === null) {
          // A refusal, not a failure: nothing went wrong, the section simply has
          // nothing drawn on this level yet. A warning toast clears on its own
          // (the walker counts sticky error toasts as findings, and so would a
          // user).
          toast('warning', t('sections.export.nothingDrawn', { level: axisLevelLabel(axis) }))
          return
        }
        await downloadSectionExport({
          sectionName: section.name,
          extension: spec.extension,
          filterLabel: t(
            kind === 'dstability'
              ? 'sections.export.dstabilityFilter'
              : 'sections.export.dsheetpilingFilter',
          ),
          successMessage: t(
            kind === 'dstability'
              ? 'sections.export.dstabilitySuccess'
              : 'sections.export.dsheetpilingSuccess',
          ),
          failureMessage: t(
            kind === 'dstability'
              ? 'sections.export.dstabilityFailure'
              : 'sections.export.dsheetpilingFailure',
          ),
          logLabel: kind === 'dstability' ? 'exportDstability' : 'exportDsheetPiling',
          toast,
          onSaved: recordSaved(spec.cardId),
          fetchBytes: () =>
            kind === 'dstability'
              ? api.section.exportDstability(projectId, section.id, modelId, partition!)
              : api.section.exportDsheetPiling(projectId, section.id, modelId, partition!),
        })
      } finally {
        setBusy(null)
      }
    },
    [ctx, section, busy, projectId, toast, t, axisLevelLabel, recordSaved],
  )

  const runFence = useCallback(
    async (which: 'litho' | 'geotech'): Promise<void> => {
      const isGeotech = which === 'geotech'
      const model = isGeotech ? activeGeotechModel : activeLithoModel
      if (model === null || busy !== null) return
      const cardId = `${which}-fence`
      setBusy(cardId)
      try {
        // Cut the drawn bed level out of the exported fence, so the DXF agrees
        // with the walls on screen (owner 2026-09-13). Only overrides in the
        // sections' CRS apply; none → no clip.
        const bedPolygons = bedPolygonsForCrs(
          bedOverrides?.overrides,
          visibleSections[0]?.epsg ?? null,
        )
        const panels = await buildProjectFencePanels({
          projectId,
          modelId: model.id,
          visibleSections,
          investigations,
          layers: isGeotech ? geotechLayers : lithoLayers,
          logLabel: isGeotech ? 'geotech-fence' : 'litho-fence',
          packingClassOf: isGeotech ? packingClassOf : undefined,
          frameModelId: isGeotech ? (activeLithoModel?.id ?? null) : undefined,
          frameLayers: isGeotech ? lithoLayers : undefined,
          bedPolygons,
        })
        if (panels === null) {
          toast('warning', t('export.fenceNothingToExport'))
          return
        }
        await exportFenceDxf({
          projectId,
          modelId: model.id,
          modelName: model.name ?? (isGeotech ? 'geotechnical' : 'lithology'),
          panels,
          // The SAME formations array the viewer paints with, so the DXF layer
          // names + colours match the screen (NAD colours on the geotech axis).
          formations: isGeotech ? nadColoredFormations(geotechFormations) : lithoFormations,
          toast,
          onSaved: recordSaved(cardId),
        })
      } finally {
        setBusy(null)
      }
    },
    [
      activeGeotechModel,
      activeLithoModel,
      busy,
      projectId,
      visibleSections,
      investigations,
      geotechLayers,
      lithoLayers,
      packingClassOf,
      geotechFormations,
      lithoFormations,
      bedOverrides?.overrides,
      toast,
      t,
      recordSaved,
    ],
  )

  return {
    sections: visibleSections,
    sectionId,
    setSectionId,
    section,
    hasSections: visibleSections.length > 0,
    hasStratModel: activeGeologicalModel !== null,
    hasLithoModel: activeLithoModel !== null,
    hasGeotechModel: activeGeotechModel !== null,
    seedAxis: sectionModelAxis,
    busy,
    lastPathFor,
    runSectionDxf,
    runPlaxis3d,
    runPlaxis2d,
    runDseries,
    runFence,
  }
}
