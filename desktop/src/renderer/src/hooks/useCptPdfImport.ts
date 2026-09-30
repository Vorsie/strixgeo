/**
 * The app side of Data → Import → "Import CPTs from a PDF report".
 *
 * Picks the report (the dialog then triages it), and once the dialog reports
 * the settled outcomes, does what every CPT import does: one summary toast,
 * new CPTs into the manifest + the session-import set (so discard-on-close can
 * roll them back), a replaced CPT marks the project mutated instead (it was
 * already in the project), the list refetches, the first new CPT is selected.
 */

import { useCallback, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'

import type { CptPdfImportResult } from '../api/clients/cptPdf'
import { t } from '../i18n/translate'
import { log } from '../utils/log'
import { addAllToSet } from '../utils/sets'

interface Deps {
  project: { id: string } | null
  toast: (type: 'success' | 'error' | 'warning', message: string, replaceKey?: string) => void
  refreshList: () => Promise<void>
  unhideCpts: (ids: Iterable<string>) => void
  addToManifest: (kind: 'cpt' | 'borehole', ids: string[]) => void
  setSessionImportCptIds: Dispatch<SetStateAction<Set<string>>>
  markMutated?: () => void
  setSelectedId: (id: string | null) => void
}

/** What {@link useCptPdfImport} returns. */
export interface UseCptPdfImportResult {
  /** Non-null while the dialog is open on a picked report. */
  pdfImport: { filePath: string } | null
  /** Pick a report and open the dialog on it (menu + toolbar verb). */
  handleImportCptPdf: () => Promise<void>
  closePdfImport: () => void
  /** The dialog's settled outcomes: toast + bookkeeping. */
  handlePdfImported: (results: CptPdfImportResult[], fileName: string) => Promise<void>
}

/**
 * Open / finish a PDF report import.
 *
 * @returns The dialog state and the handlers.
 */
export function useCptPdfImport({
  project,
  toast,
  refreshList,
  unhideCpts,
  addToManifest,
  setSessionImportCptIds,
  markMutated,
  setSelectedId,
}: Deps): UseCptPdfImportResult {
  const [pdfImport, setPdfImport] = useState<{ filePath: string } | null>(null)

  const handleImportCptPdf = useCallback(async () => {
    if (!project) return
    const filePath = await window.electron.openFile([
      { name: t('cptPdf.pickerFilter'), extensions: ['pdf'] },
    ])
    if (!filePath) return
    log.info('cpt-pdf', 'report picked for import')
    setPdfImport({ filePath })
  }, [project])

  const closePdfImport = useCallback(() => setPdfImport(null), [])

  const handlePdfImported = useCallback(
    async (results: CptPdfImportResult[], fileName: string) => {
      const created = results.filter(r => r.status === 'imported' && r.cpt_id)
      const replaced = results.filter(r => r.status === 'refreshed' && r.cpt_id)
      const unchanged = results.filter(r => r.status === 'confirmation_required')
      const failed = results.filter(r => r.status === 'failed' || r.status === 'refused')
      const newIds = created.map(r => r.cpt_id as string)
      const touched = [...newIds, ...replaced.map(r => r.cpt_id as string)]
      log.info(
        'cpt-pdf',
        `import of ${fileName} settled: ${created.length} new, ${replaced.length} replaced, ` +
          `${unchanged.length} unchanged, ${failed.length} not imported`,
      )

      const parts: string[] = []
      if (created.length > 0) parts.push(t('data.import.countImported', { n: created.length }))
      if (replaced.length === 1) parts.push(t('data.import.refreshedOne', { name: replaced[0].name }))
      else if (replaced.length > 1) parts.push(t('data.import.refreshedMany', { n: replaced.length }))
      if (unchanged.length === 1) parts.push(t('data.import.leftUnchangedOne', { name: unchanged[0].name }))
      else if (unchanged.length > 1) parts.push(t('data.import.leftUnchangedMany', { n: unchanged.length }))
      if (failed.length > 0) parts.push(t('data.import.countFailed', { n: failed.length }))
      const nothing = touched.length === 0
      toast(
        nothing && failed.length > 0 ? 'error' : 'success',
        parts.length > 0 ? parts.join(', ') : t('cptPdf.toast.none'),
      )
      if (nothing) return

      unhideCpts(touched)
      if (newIds.length > 0) {
        addToManifest('cpt', newIds)
        addAllToSet(setSessionImportCptIds, newIds)
      }
      // A replaced CPT was in the project before: dirty the project, never the
      // session-import set (whose discard path would DELETE it).
      if (replaced.length > 0) markMutated?.()
      await refreshList()
      setSelectedId(touched[0])
    },
    [toast, unhideCpts, addToManifest, setSessionImportCptIds, markMutated, refreshList, setSelectedId],
  )

  return { pdfImport, handleImportCptPdf, closePdfImport, handlePdfImported }
}
