// Import boreholes from LOCAL DOV XML files (owner 2026-09-28: "write an import
// function ... based off these .xml files, flag everything that is weird").
//
// One POST per picked file (``api.borehole.importFile``); each file can hold
// several borings, and each boring comes back with its flags. Three rules:
//
//  * The flags are the point, so after the run the whole report (per file ->
//    per boring -> its flags) is handed to a panel the engineer reads; the
//    toast only summarises.
//  * A file whose borings are already in the project writes NOTHING until the
//    engineer agreed on the numbers (the CPT re-import rule, docs/ux.md
//    "Reversible vs irreversible"). Asked one file at a time: two dialogs at
//    once is not a question, it is a pile-up.
//  * A refreshed borehole was already in the project: it dirties the project
//    through ``markMutated``, never through the session-imports set (whose
//    discard path would DELETE it).
//
// Lives beside useInvestigationData (which calls it) so that god-hook does not
// grow another 200 lines (debt #201).

import { useCallback, useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'

import { api, BoreholeRefreshConfirmationRequiredError } from '../api/client'
import type {
  BoreholeRefreshDiff,
  ImportBoreholeFileResponse,
  ImportedBoring,
  ImportFlag,
} from '../api/client'
import { t } from '../i18n/translate'
import { addAllToSet } from '../utils/sets'
import { log } from '../utils/log'

/** One file's line in the import report. */
export interface BoreholeImportReportFile {
  fileName: string
  /** ``imported`` (new and/or refreshed), ``declined`` (replacement refused by
   * the engineer, nothing written) or ``failed`` (the backend refused). */
  outcome: 'imported' | 'declined' | 'failed'
  /** The backend's message when ``outcome`` is ``failed``. */
  error?: string
  boreholes: ImportedBoring[]
  /** Findings that belong to the whole file, not one boring. */
  fileIssues: ImportFlag[]
}

/** State + actions the App renders the consent dialog and the report from. */
export interface UseBoreholeXmlImportResult {
  /** File picker -> one POST per file -> consent -> toast + report. */
  handleImportBoreholeXml: () => Promise<void>
  /** Non-null while a file waits for the engineer's answer. */
  boreholeRefreshConfirm: { fileName: string; diffs: BoreholeRefreshDiff[] } | null
  /** "Replace boreholes": re-post the parked file with consent. */
  confirmBoreholeRefresh: () => void
  /** Cancel: the stored boreholes are left exactly as they were. */
  cancelBoreholeRefresh: () => void
  /** Non-null after a run: the report the flags panel shows. */
  boreholeImportReport: BoreholeImportReportFile[] | null
  closeBoreholeImportReport: () => void
}

type Settled = PromiseSettledResult<ImportBoreholeFileResponse>

/** Last path segment, for either separator. */
function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

/**
 * Hook owning the local DOV borehole XML import flow.
 *
 * Parameters
 * ----------
 * deps
 *     The investigation-data seams the flow updates: the active project, the
 *     toast, the manifest + session-import bookkeeping, the dirty flag, the
 *     removed-set unhide, the borehole list refetch and the shared
 *     ``importing`` spinner.
 *
 * Returns
 * -------
 * UseBoreholeXmlImportResult
 */
export function useBoreholeXmlImport(deps: {
  project: { id: string; name: string } | null
  toast: (type: 'success' | 'error' | 'warning', message: string) => void
  addToManifest: (kind: 'cpt' | 'borehole', ids: string[]) => void
  setSessionImportBoreholeIds: Dispatch<SetStateAction<Set<string>>>
  markMutated?: () => void
  unhideBoreholes: (ids: Iterable<string>) => void
  refreshBoreholeList: () => Promise<void>
  setImporting: (importing: boolean) => void
}): UseBoreholeXmlImportResult {
  const {
    project,
    toast,
    addToManifest,
    setSessionImportBoreholeIds,
    markMutated,
    unhideBoreholes,
    refreshBoreholeList,
    setImporting,
  } = deps

  const [boreholeRefreshConfirm, setBoreholeRefreshConfirm] = useState<{
    fileName: string
    diffs: BoreholeRefreshDiff[]
  } | null>(null)
  // A continuation, not something to render: the import parks on it.
  const resolveRef = useRef<((agreed: boolean) => void) | null>(null)
  const [boreholeImportReport, setBoreholeImportReport] = useState<
    BoreholeImportReportFile[] | null
  >(null)

  const ask = useCallback(
    (fileName: string, diffs: BoreholeRefreshDiff[]): Promise<boolean> =>
      new Promise<boolean>(resolve => {
        resolveRef.current = resolve
        setBoreholeRefreshConfirm({ fileName, diffs })
      }),
    [],
  )

  const settle = useCallback((agreed: boolean) => {
    const resolve = resolveRef.current
    resolveRef.current = null
    setBoreholeRefreshConfirm(null)
    resolve?.(agreed)
  }, [])
  const confirmBoreholeRefresh = useCallback(() => settle(true), [settle])
  const cancelBoreholeRefresh = useCallback(() => settle(false), [settle])
  const closeBoreholeImportReport = useCallback(() => setBoreholeImportReport(null), [])

  const handleImportBoreholeXml = useCallback(async () => {
    if (!project) return
    const filePaths = await window.electron.openFiles([
      { name: 'DOV XML', extensions: ['xml'] },
      { name: 'All Files', extensions: ['*'] },
    ])
    if (filePaths.length === 0) return
    log.info('import', `borehole XML import: ${filePaths.length} file(s)`)

    setImporting(true)
    try {
      const results: Settled[] = await Promise.allSettled(
        filePaths.map(fp => api.borehole.importFile(fp, project.id)),
      )

      const declined = new Set<number>()
      for (let i = 0; i < results.length; i++) {
        const r = results[i]
        if (r.status !== 'rejected') continue
        if (!(r.reason instanceof BoreholeRefreshConfirmationRequiredError)) continue
        const agreed = await ask(baseName(filePaths[i]), r.reason.diffs)
        if (!agreed) {
          declined.add(i)
          log.info('import', `borehole refresh declined for file ${i + 1}; nothing written`)
          continue
        }
        results[i] = await api.borehole
          .importFile(filePaths[i], project.id, true)
          .then(value => ({ status: 'fulfilled', value }) as Settled)
          .catch(reason => ({ status: 'rejected', reason }) as Settled)
      }

      const report: BoreholeImportReportFile[] = results.map((r, i) => {
        const fileName = baseName(filePaths[i])
        if (declined.has(i)) return { fileName, outcome: 'declined', boreholes: [], fileIssues: [] }
        if (r.status === 'rejected') {
          const error = r.reason instanceof Error ? r.reason.message : String(r.reason)
          log.error('import', `borehole XML import failed for file ${i + 1}`, r.reason)
          return { fileName, outcome: 'failed', error, boreholes: [], fileIssues: [] }
        }
        return {
          fileName,
          outcome: 'imported',
          boreholes: r.value.boreholes,
          fileIssues: r.value.file_issues ?? [],
        }
      })

      const borings = report.flatMap(f => f.boreholes)
      const newIds = borings
        .filter(b => b.imported && !b.refreshed && b.borehole_id)
        .map(b => b.borehole_id as string)
      const refreshed = borings.filter(b => b.refreshed && b.borehole_id)
      const touchedIds = [...newIds, ...refreshed.map(b => b.borehole_id as string)]
      const flags = [...borings.flatMap(b => b.issues), ...report.flatMap(f => f.fileIssues)]
      const failedFiles = report.filter(f => f.outcome === 'failed').length
      const declinedFiles = report.filter(f => f.outcome === 'declined')

      const parts: string[] = []
      if (newIds.length > 0) parts.push(t('data.import.countImported', { n: newIds.length }))
      if (refreshed.length === 1)
        parts.push(t('data.import.boreholeRefreshedOne', { name: refreshed[0].name }))
      else if (refreshed.length > 1)
        parts.push(t('data.import.refreshedMany', { n: refreshed.length }))
      if (declinedFiles.length === 1)
        parts.push(t('data.import.leftUnchangedOne', { name: declinedFiles[0].fileName }))
      else if (declinedFiles.length > 1)
        parts.push(t('data.import.leftUnchangedMany', { n: declinedFiles.length }))
      if (failedFiles > 0) parts.push(t('data.import.countFailed', { n: failedFiles }))
      if (flags.length === 1) parts.push(t('data.import.flagsToReviewOne', { n: 1 }))
      else if (flags.length > 1)
        parts.push(t('data.import.flagsToReviewMany', { n: flags.length }))
      const nothingLanded = touchedIds.length === 0
      const severity =
        failedFiles > 0 && nothingLanded
          ? 'error'
          : failedFiles > 0 || flags.some(f => f.level === 'error' || f.level === 'warning')
            ? 'warning'
            : 'success'
      toast(severity, parts.join(', '))
      log.info(
        'import',
        `borehole XML import: ${newIds.length} new, ${refreshed.length} refreshed, ` +
          `${declinedFiles.length} declined, ${failedFiles} failed, ${flags.length} flag(s)`,
      )

      unhideBoreholes(touchedIds)
      addToManifest('borehole', newIds)
      if (newIds.length > 0) addAllToSet(setSessionImportBoreholeIds, newIds)
      if (refreshed.length > 0) markMutated?.()
      setBoreholeImportReport(report)
      await refreshBoreholeList()
    } finally {
      setImporting(false)
    }
  }, [
    project,
    ask,
    toast,
    unhideBoreholes,
    addToManifest,
    setSessionImportBoreholeIds,
    markMutated,
    refreshBoreholeList,
    setImporting,
  ])

  return {
    handleImportBoreholeXml,
    boreholeRefreshConfirm,
    confirmBoreholeRefresh,
    cancelBoreholeRefresh,
    boreholeImportReport,
    closeBoreholeImportReport,
  }
}
