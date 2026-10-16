// The bytes-to-file leg every section export shares: propose a filename, ask
// the OS where to put it, fetch the bytes, write them, tell the engineer.
//
// The shape is ``App.tsx``'s ``handleExportSectionDxf`` verbatim — same
// filename sanitisation, same null-means-cancelled dialog contract, same
// log/toast pair. It is a module rather than a fourth copy inside the toolbar
// because the D-Series pair would have made the copy count five (debt #110,
// "export-path duplication"); the three handlers still in ``App.tsx`` can adopt
// this without changing a single observable behaviour when that debt is paid.

import { log } from '../../../utils/log'
import { abandonIfProjectClosed } from '../../../utils/openProjectGuard'

/** One section export's file-write leg, as the caller describes it. */
export interface SectionExportDownload {
  /**
   * The project the export was started on. Once it is closed nothing of the
   * export runs any more: no dialog, no byte fetch, no file write, no toast.
   */
  projectId: string
  /** Section name — sanitised into the proposed filename. */
  sectionName: string
  /** Artefact extension without the dot, e.g. ``'stix'``. */
  extension: string
  /** Human name of the format for the save dialog's filter row. */
  filterLabel: string
  /**
   * Fetch the artefact's bytes.
   *
   * Called only AFTER the engineer has chosen a path, so a cancelled dialog
   * costs no request — the same order ``handleExportSectionDxf`` uses.
   */
  fetchBytes: () => Promise<ArrayBuffer>
  /** Toast shown on success, e.g. ``'D-Stability model exported.'``. */
  successMessage: string
  /** Toast shown when the export failed and the error carried no message. */
  failureMessage: string
  /** Log channel prefix, e.g. ``'exportDstability'``. */
  logLabel: string
  /** The app toast fn. */
  toast: (kind: 'success' | 'error', message: string) => void
  /**
   * Called with the chosen path AFTER a successful write (installer #35 — the
   * Export hub remembers each card's last path). Optional: callers that do not
   * surface a last-path hint (the map-click flow) simply omit it.
   */
  onSaved?: (path: string) => void
}

/**
 * Run a section export's save-dialog → fetch → write → notify leg.
 *
 * Never throws: a failed fetch or write is reported to the engineer as an error
 * toast and logged, because there is nothing for a caller to recover — the
 * export either produced a file or it did not.
 *
 * Parameters
 * ----------
 * spec : SectionExportDownload
 *     What to name the file, how to get its bytes, and what to say afterwards.
 *
 * Returns
 * -------
 * Promise<void>
 *     Resolves once the file is written, the engineer cancelled, or the failure
 *     has been reported.
 */
export async function downloadSectionExport(spec: SectionExportDownload): Promise<void> {
  const { projectId, sectionName, extension, filterLabel, logLabel, toast } = spec
  // Checked before the dialog and after every await: an export bound to a
  // project that is no longer open stops there (utils/openProjectGuard).
  const abandoned = (): boolean => abandonIfProjectClosed(projectId, 'section', logLabel)
  if (abandoned()) return
  log.info('section', `${logLabel} start section="${sectionName}"`)
  try {
    // Sanitise the same way the backend does, so the proposed default matches
    // the name the engineer sees in the response's Content-Disposition.
    const safeName = sectionName.replace(/[^A-Za-z0-9\- _]/g, '_').trim() || 'section'
    const dialogPath = await window.electron.showExportSaveDialog(`${safeName}.${extension}`, [
      { name: filterLabel, extensions: [extension] },
      { name: 'All Files', extensions: ['*'] },
    ])
    if (dialogPath === null) {
      log.debug('section', `${logLabel} cancelled at save dialog`)
      return
    }
    if (abandoned()) return
    const bytes = await spec.fetchBytes()
    if (abandoned()) return
    await window.electron.writeExportFile(dialogPath, bytes)
    log.success(
      'section',
      `${logLabel} ok bytes=${bytes.byteLength} path=${dialogPath}`,
    )
    spec.onSaved?.(dialogPath)
    toast('success', spec.successMessage)
  } catch (err) {
    log.error('section', `${logLabel} failed`, err)
    // The backend's refusal messages (``dstability_export_refused`` /
    // ``dsheetpiling_export_refused``) are written for the engineer and belong
    // in the toast unchanged — see the client docstrings.
    toast('error', err instanceof Error ? err.message : spec.failureMessage)
  }
}
