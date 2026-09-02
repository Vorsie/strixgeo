// The section-export verbs (DXF / Plaxis 3D / PDF / D-Series) for the toolbar.
//
// Extracted verbatim from ``SectionsToolbar`` (debt #201). Consolidates the
// export concern that was scattered across the component: the axis-model
// selector, the DXF / Plaxis / PDF busy flags + handlers, the PDF metadata
// dialog state, and the two closed-geometry D-Series items. Bodies are
// byte-identical to the inline originals; only the surrounding declaration
// moved. The hook call sits after ``axisLevelLabel`` in the toolbar because the
// D-Series items read it.

import { useState } from 'react'

import { useDseriesExportItems } from './useDseriesExportItems'
import type { ToolbarDropdownItem } from '../../ToolbarPrimitives'
import type {
  GeologicalModelResponse,
  CrossSectionResponse,
  ProjectResponse,
} from '../../../api/client'
import type { Coordinator } from '../../ShellContext'
import type { UseGeologicalModelResult } from '../../../hooks/useGeologicalModel'

/** What the export verbs need from the shell bus. */
export interface UseSectionExportVerbsDeps {
  isLitho: boolean
  isGeotech: boolean
  activeLithoModel: GeologicalModelResponse | null
  activeGeotechModel: GeologicalModelResponse | null
  activeGeologicalModel: GeologicalModelResponse | null
  selectedSection: CrossSectionResponse | null
  project: ProjectResponse
  axisLevelLabel: string
  handleExportSectionDxf: Coordinator['handleExportSectionDxf']
  handleExportModelPlaxis3d: UseGeologicalModelResult['handleExportModelPlaxis3d']
}

/** The export busy flags, handlers, sheet-preview dialog state and D-Series items. */
export interface UseSectionExportVerbsResult {
  exportingDxf: boolean
  exportingPlaxis: boolean
  /** The cross-section PDF sheet preview dialog (replaces the old metadata dialog). */
  sheetDialogOpen: boolean
  setSheetDialogOpen: (open: boolean) => void
  handleExportDxf: () => Promise<void>
  handleExportPlaxis: () => Promise<void>
  dseriesExportItems: ToolbarDropdownItem[]
}

/**
 * Own the section-export verbs' state + handlers.
 *
 * Parameters
 * ----------
 * deps : UseSectionExportVerbsDeps
 *     Axis flags, the three active models, the open section, project, the axis
 *     level label and the three shell export handlers.
 *
 * Returns
 * -------
 * UseSectionExportVerbsResult
 *     The busy flags, handlers, PDF dialog state and D-Series export items.
 */
export function useSectionExportVerbs({
  isLitho,
  isGeotech,
  activeLithoModel,
  activeGeotechModel,
  activeGeologicalModel,
  selectedSection,
  project,
  axisLevelLabel,
  handleExportSectionDxf,
  handleExportModelPlaxis3d,
}: UseSectionExportVerbsDeps): UseSectionExportVerbsResult {
  const [exportingPlaxis, setExportingPlaxis] = useState(false)
  const [exportingDxf, setExportingDxf] = useState(false)

  /**
   * The model whose contacts a section export must contain.
   *
   * One selector for both export verbs so DXF and PDF cannot disagree about
   * which model level the engineer is looking at.
   *
   * Returns
   * -------
   * GeologicalModelResponse | null
   *     The active model for the current axis, or null when that level has no
   *     active model (the export items are disabled in that case).
   */
  function axisModelForExport(): GeologicalModelResponse | null {
    if (isLitho) return activeLithoModel
    if (isGeotech) return activeGeotechModel
    return activeGeologicalModel
  }

  async function handleExportDxf(): Promise<void> {
    // Axis-aware: export the model level the section is CURRENTLY showing.
    // The geotech branch used to fall through to the geological model, so an
    // engineer on the NAD axis silently got a geological DXF (audit
    // 2026-08-02). The snapshot builder is kind-agnostic — it takes a
    // model_id — so routing the id is the whole fix.
    const axisModel = axisModelForExport()
    if (!selectedSection || !axisModel || exportingDxf) return
    setExportingDxf(true)
    try {
      await handleExportSectionDxf(
        project.id,
        selectedSection.id,
        selectedSection.name,
        axisModel.id,
      )
    } finally {
      setExportingDxf(false)
    }
  }

  async function handleExportPlaxis(): Promise<void> {
    if (!activeGeologicalModel || exportingPlaxis) return
    setExportingPlaxis(true)
    try {
      await handleExportModelPlaxis3d()
    } finally {
      setExportingPlaxis(false)
    }
  }

  // Debt #52 slice 1: the cross-section PDF sheet. The Export dropdown's
  // "Section PDF" item opens the live preview dialog (SheetPreviewDialog),
  // which owns its own save-dialog + Chromium print flow — the App-level
  // matplotlib PDF handler is retired.
  const [sheetDialogOpen, setSheetDialogOpen] = useState(false)

  // The two closed-geometry exports (D-Stability / D-Sheet Piling). They own
  // their own busy state and handlers because, unlike DXF / PDF / Plaxis, they
  // POST the drawn partition rather than letting the backend rebuild it — see
  // ``useDseriesExportItems``.
  const dseriesExportItems = useDseriesExportItems({
    axisModel: axisModelForExport(),
    selectedSection,
    isGeotech,
    axisLevelLabel,
  })

  return {
    exportingDxf,
    exportingPlaxis,
    sheetDialogOpen,
    setSheetDialogOpen,
    handleExportDxf,
    handleExportPlaxis,
    dseriesExportItems,
  }
}
