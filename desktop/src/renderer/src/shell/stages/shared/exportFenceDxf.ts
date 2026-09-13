// Export the 3-D fence diagram as a DXF deliverable (owner ballot 2026-08-26).
//
// WHY DXF AND NOT A SCREENSHOT. A PNG of the Cesium scene is a picture: it
// cannot be measured, overlaid on a site plan, or brought into the drawing set
// the engineer actually delivers. It is also the LESS robust of the two — a
// scene capture needs ``preserveDrawingBuffer``, which costs on every rendered
// frame, and it has no defined answer in the two-pane split. The DXF carries
// the real world-space geometry the viewer is painting, layered by unit, and
// opens in AutoCAD / Civil3D unassisted.
//
// The IO shape (save dialog → fetch → write → toast) deliberately mirrors
// ``handleExportSectionDxf`` in App.tsx. It lives here rather than there
// because the fence panels are stage-local state that never reaches the shell
// bus, and App.tsx is already the god component debt #201 tracks.

import { api } from '../../../api/client'
import type { GeologicalFormationResponse } from '../../../api/client'
import type { FencePanel } from '../../../utils/fencePanels'
import { buildFenceExportRequest } from '../../../utils/fenceExportRequest'
import { log } from '../../../utils/log'
import { t } from '../../../i18n/translate'

/** Everything one fence export needs. */
export interface FenceExportOptions {
  projectId: string
  modelId: string
  /** Names the downloaded file; sanitised the same way the backend does. */
  modelName: string
  /** The walls the viewer is currently painting. */
  panels: readonly FencePanel[]
  /** The formations handed to the viewer for this render — colours included. */
  formations: readonly GeologicalFormationResponse[]
  /** Shell toast dispatcher — the ``toasts.toast`` action off the shell bus. */
  toast: (kind: 'success' | 'error' | 'warning', message: string) => void
  /**
   * Called with the chosen path AFTER a successful write (installer #35 — the
   * Export hub remembers each card's last path). Optional: the 3-D stage buttons
   * do not surface a last-path hint and omit it.
   */
  onSaved?: (path: string) => void
}

/**
 * Save the current fence diagram as a DXF file.
 *
 * Refuses up front when there is no geometry: exporting an empty DXF looks
 * like a successful export of an empty model, which is the one outcome an
 * engineer must never get silently. The refusal is a warning toast naming what
 * to do, not an error — nothing went wrong, there is simply nothing to write.
 *
 * Parameters
 * ----------
 * options : FenceExportOptions
 *     Project / model scope, the painted panels, the formations that coloured
 *     them, and the toast dispatcher.
 *
 * Returns
 * -------
 * Promise<void>
 *     Resolves once the file is written, the user cancelled the save dialog,
 *     or the failure has been reported. Never rejects: an export failure is
 *     reported to the user, never thrown at a click handler.
 */
export async function exportFenceDxf(options: FenceExportOptions): Promise<void> {
  const { projectId, modelId, modelName, panels, formations, toast, onSaved } = options

  const request = buildFenceExportRequest(panels, formations)
  if (request.panels.length === 0) {
    log.warn('geology', `exportFenceDxf refused model=${modelId} — no drawable panels`)
    toast('warning', t('export.fenceNothingToExport'))
    return
  }

  log.info('geology', `exportFenceDxf start model=${modelId} panels=${request.panels.length}`)
  try {
    // Sanitised to match the backend's own Content-Disposition stem, so the
    // proposed default is the name the file would have had anyway.
    const safeName = modelName.replace(/[^A-Za-z0-9\- _]/g, '_').trim() || 'model'
    const dialogPath = await window.electron.showExportSaveDialog(`${safeName}_fence.dxf`, [
      { name: t('export.dxf'), extensions: ['dxf'] },
      { name: t('export.allFiles'), extensions: ['*'] },
    ])
    if (dialogPath === null) {
      log.debug('geology', 'exportFenceDxf cancelled at save dialog')
      return
    }

    const bytes = await api.geology.exportFenceDxf(projectId, modelId, request)
    await window.electron.writeExportFile(dialogPath, bytes)
    log.success(
      'geology',
      `exportFenceDxf ok model=${modelId} bytes=${bytes.byteLength} path=${dialogPath}`,
    )
    onSaved?.(dialogPath)
    toast('success', t('export.fenceExported', { count: request.panels.length }))
  } catch (err) {
    log.error('geology', 'exportFenceDxf failed', err)
    toast('error', err instanceof Error ? err.message : t('export.fenceFailed'))
  }
}
