/**
 * The app side of Data → Import → Boring → "Uit een pdf-rapport".
 *
 * Picks the report (the dialog then triages it), and once the dialog hands
 * over the settled import, does what the DOV XML borehole import does: one
 * summary toast (held 10 s when it sums up several boreholes, like the CPT PDF
 * import), new boreholes adopted into the project (unhidden, manifest,
 * session-import set, list refetch), a refreshed borehole marks the project
 * mutated instead (it was already in the project, so discard-on-close must
 * never delete it), and the import report with every flag of every borehole.
 */

import { useCallback, useState } from 'react'

import type { ImportBoreholeFileResponse } from '../api/client'
import { t } from '../i18n/translate'
import { log } from '../utils/log'
import type { BoreholeImportReportFile } from './useBoreholeXmlImport'
import { TOAST_LONG_TIMEOUT_MS, type ToastOptions } from './useToasts'

interface Deps {
  project: { id: string } | null
  toast: (
    type: 'success' | 'error' | 'warning',
    message: string,
    replaceKey?: string,
    options?: ToastOptions,
  ) => void
  /** New boreholes another flow wrote: unhide, manifest, session imports,
   *  refetch. Optional on the bus (partial shells); App always passes it. */
  adoptImportedBoreholes?: (ids: string[]) => Promise<void>
  unhideBoreholes: (ids: Iterable<string>) => void
  markMutated?: () => void
  refreshBoreholeList: () => Promise<void>
}

/** What {@link useBoreholePdfImport} returns. */
export interface UseBoreholePdfImportResult {
  /** Non-null while the dialog is open on a picked report. */
  boreholePdfImport: { filePath: string } | null
  /** Pick a report and open the dialog on it (menu + toolbar route). */
  handleImportBoreholePdf: () => Promise<void>
  closeBoreholePdfImport: () => void
  /** The dialog's settled import: toast, bookkeeping, report. */
  handleBoreholePdfImported: (response: ImportBoreholeFileResponse, fileName: string) => Promise<void>
  /** Non-null after an import: the flags panel's content. */
  boreholePdfReport: BoreholeImportReportFile[] | null
  closeBoreholePdfReport: () => void
}

/**
 * Open / finish a PDF borehole report import.
 *
 * @returns The dialog + report state and the handlers.
 */
export function useBoreholePdfImport({
  project,
  toast,
  adoptImportedBoreholes,
  unhideBoreholes,
  markMutated,
  refreshBoreholeList,
}: Deps): UseBoreholePdfImportResult {
  const [boreholePdfImport, setBoreholePdfImport] = useState<{ filePath: string } | null>(null)
  const [boreholePdfReport, setBoreholePdfReport] = useState<BoreholeImportReportFile[] | null>(null)

  const handleImportBoreholePdf = useCallback(async () => {
    if (!project) return
    const filePath = await window.electron.openFile([
      { name: t('boreholePdf.pickerFilter'), extensions: ['pdf'] },
    ])
    if (!filePath) return
    log.info('borehole-pdf', 'report picked for import')
    setBoreholePdfImport({ filePath })
  }, [project])

  const closeBoreholePdfImport = useCallback(() => setBoreholePdfImport(null), [])
  const closeBoreholePdfReport = useCallback(() => setBoreholePdfReport(null), [])

  const handleBoreholePdfImported = useCallback(
    async (response: ImportBoreholeFileResponse, fileName: string) => {
      setBoreholePdfImport(null)
      const borings = response.boreholes
      const created = borings.filter(b => b.imported && !b.refreshed && b.borehole_id)
      const refreshed = borings.filter(b => b.refreshed && b.borehole_id)
      const skipped = borings.filter(b => !b.imported)
      const flags = [...borings.flatMap(b => b.issues), ...(response.file_issues ?? [])]
      log.info(
        'borehole-pdf',
        `import of ${fileName} settled: ${created.length} new, ${refreshed.length} replaced, ` +
          `${skipped.length} not imported, ${flags.length} flag(s)`,
      )

      const parts: string[] = []
      if (created.length > 0) parts.push(t('data.import.countImported', { n: created.length }))
      if (refreshed.length === 1) parts.push(t('data.import.boreholeRefreshedOne', { name: refreshed[0].name }))
      else if (refreshed.length > 1) parts.push(t('data.import.refreshedMany', { n: refreshed.length }))
      if (skipped.length > 0) parts.push(t('data.import.countFailed', { n: skipped.length }))
      if (flags.length === 1) parts.push(t('data.import.flagsToReviewOne', { n: 1 }))
      else if (flags.length > 1) parts.push(t('data.import.flagsToReviewMany', { n: flags.length }))
      const nothing = created.length + refreshed.length === 0
      const severity = nothing
        ? 'error'
        : skipped.length > 0 || flags.some(f => f.level === 'error' || f.level === 'warning')
          ? 'warning'
          : 'success'
      // A summary of several boreholes takes longer to read than one fact
      // (owner 2026-10-04, the CPT PDF import); the report panel stays open.
      toast(
        severity,
        parts.length > 0 ? parts.join(', ') : t('boreholePdf.toast.none'),
        undefined,
        borings.length > 1 ? { durationMs: TOAST_LONG_TIMEOUT_MS } : undefined,
      )
      setBoreholePdfReport([
        { fileName, outcome: 'imported', boreholes: borings, fileIssues: response.file_issues ?? [] },
      ])

      if (refreshed.length > 0) {
        unhideBoreholes(refreshed.map(b => b.borehole_id as string))
        // Already in the project before: dirty it, never the session-import
        // set (whose discard path would DELETE it).
        markMutated?.()
      }
      const newIds = created.map(b => b.borehole_id as string)
      if (newIds.length > 0 && adoptImportedBoreholes) await adoptImportedBoreholes(newIds)
      else if (newIds.length > 0 || refreshed.length > 0) {
        unhideBoreholes(newIds)
        await refreshBoreholeList()
      }
    },
    [toast, adoptImportedBoreholes, unhideBoreholes, markMutated, refreshBoreholeList],
  )

  return {
    boreholePdfImport,
    handleImportBoreholePdf,
    closeBoreholePdfImport,
    handleBoreholePdfImported,
    boreholePdfReport,
    closeBoreholePdfReport,
  }
}
