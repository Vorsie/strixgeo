// Data → Import → Boring → "Uit een pdf-rapport".
//
// The CPT digitiser's dialog for borehole logs (owner 2026-10-10: "the same
// user path as the CPT one"): triage the picked report (progress while the job
// runs), list one row per borehole (BoreholePdfTriageList) with the two
// questions of rulings 3 and 4 on the rows that ask them, then import the
// ticked ones in ONE post. Import stays disabled while a ticked row waits for
// an answer or two prints of one borehole are ticked (ruling 5). Boreholes
// already in the project are never replaced without consent: the DOV XML
// import's own dialog (BoreholeRefreshConfirmDialog, Cancel focused, "Replace
// boreholes") asks on the numbers, and only on Yes the same body is re-posted
// with ``confirm_refresh``. The settled answer goes to the caller, which shows
// the import report and the toast.

import { useCallback, useEffect, useMemo, useState } from 'react'

import type { BoreholeRefreshDiff, ImportBoreholeFileResponse } from '../../api/client'
import { BoreholeRefreshConfirmationRequiredError } from '../../api/client'
import { boreholePdfClient, type BoreholePdfImportBody } from '../../api/clients/boreholePdf'
import { useBoreholePdfTriage } from '../../hooks/useBoreholePdfTriage'
import type { PdfTriagePhase } from '../../hooks/pdfTriageRegistry'
import type { MessageKey } from '../../i18n/locales/en'
import { useT } from '../../i18n/translate'
import { log } from '../../utils/log'
import BoreholeRefreshConfirmDialog from '../BoreholeRefreshConfirmDialog'
import Button from '../ui/Button'
import Modal from '../ui/Modal'
import BoreholePdfTriageList from './BoreholePdfTriageList'
import {
  applyCrsChoice,
  applyWaterChoice,
  buildImportItems,
  initialSelection,
  missingConfirmations,
  repeatClash,
  type CrsChoice,
  type RowDecisions,
} from './boreholePdfConfirmations'

interface Props {
  open: boolean
  /** The report the user picked. */
  filePath: string
  projectId: string
  onClose: () => void
  /** The import's settled answer (new and refreshed boreholes with their flags). */
  onImported: (response: ImportBoreholeFileResponse, fileName: string) => void
}

/** The progress line's message: OCR named while it runs, else the phase. */
function progressKey(phase: PdfTriagePhase, ocr: boolean): MessageKey {
  if (ocr) return 'boreholePdf.phase.ocr'
  return phase === 'classify' ? 'boreholePdf.phase.classify' : 'boreholePdf.phase.digitise'
}

/**
 * The PDF borehole import dialog.
 *
 * @returns The modal (nothing when closed).
 */
export default function BoreholePdfImportDialog({
  open,
  filePath,
  projectId,
  onClose,
  onImported,
}: Props): JSX.Element | null {
  const t = useT()
  const { state, start, reset } = useBoreholePdfTriage()
  const fileName = filePath.split(/[\\/]/).pop() ?? filePath
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [decisions, setDecisions] = useState<RowDecisions>({})
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [asking, setAsking] = useState<{ diffs: BoreholeRefreshDiff[]; body: BoreholePdfImportBody } | null>(null)

  useEffect(() => {
    if (open) start(filePath, projectId)
    // reason: one triage per opened report; ``start`` is stable and a project
    // switch closes the dialog, so re-running on identity changes would upload
    // the same report twice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, filePath])

  const digest = state.status === 'done' ? state.digest : null
  const rows = useMemo(() => digest?.boreholes ?? [], [digest])
  useEffect(() => {
    if (!digest) return
    setSelected(initialSelection(digest.boreholes))
    setDecisions({})
  }, [digest])

  const toggle = useCallback((key: string, on: boolean) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (on) next.add(key)
      else next.delete(key)
      return next
    })
  }, [])
  const onCrs = useCallback(
    (key: string, choice: CrsChoice) => setDecisions(prev => applyCrsChoice(rows, prev, key, choice)),
    [rows],
  )
  const onWater = useCallback(
    (key: string, confirmed: boolean) => setDecisions(prev => applyWaterChoice(prev, key, confirmed)),
    [],
  )

  const waiting = rows.filter(r => selected.has(r.key) && missingConfirmations(r, decisions).length > 0)
  const clash = repeatClash(rows, selected)
  const canImport = digest !== null && selected.size > 0 && waiting.length === 0 && !clash && !importing

  const post = async (body: BoreholePdfImportBody): Promise<void> => {
    setImporting(true)
    setError(null)
    try {
      log.info('borehole-pdf', `importing ${body.boreholes.length} borehole(s) of ${body.file_sha.slice(0, 12)}`)
      const response = await boreholePdfClient.importBoreholes(body)
      onImported(response, fileName)
    } catch (err) {
      if (err instanceof BoreholeRefreshConfirmationRequiredError) {
        // Replacing a stored borehole is irreversible: asked on the numbers
        // (docs/ux.md "Reversible vs irreversible").
        log.info('borehole-pdf', `${err.diffs.length} borehole(s) already in the project: asking`)
        setAsking({ diffs: err.diffs, body })
        return
      }
      const msg = err instanceof Error ? err.message : String(err)
      log.error('borehole-pdf', `import failed: ${msg}`)
      setError(msg)
    } finally {
      setImporting(false)
    }
  }

  const runImport = (): void => {
    if (!digest || !canImport) return
    void post({
      project_id: projectId,
      file_sha: digest.file_sha,
      boreholes: buildImportItems(rows, selected, decisions),
    })
  }

  const close = (): void => {
    reset()
    onClose()
  }

  if (!open) return null

  return (
    <>
      <Modal
        open={open}
        onCancel={close}
        labelledBy="borehole-pdf-import-title"
        busy={importing}
        cardClassName="w-[60rem] max-w-[95vw]"
        testid="borehole-pdf-import-dialog"
      >
        <div className="flex max-h-[85vh] flex-col gap-3 overflow-hidden">
          <h2 id="borehole-pdf-import-title" className="text-sm font-semibold">
            {t('boreholePdf.title')} <span className="font-mono font-normal text-text-secondary">{fileName}</span>
          </h2>
          <div className="min-h-0 flex-1 overflow-auto">
            {(state.status === 'idle' || state.status === 'uploading') && <p>{t('boreholePdf.uploading')}</p>}
            {state.status === 'running' && (
              <p data-testid="borehole-pdf-progress">
                {state.phase
                  ? t(progressKey(state.phase, state.ocr === true), { done: state.done, total: state.total })
                  : t('boreholePdf.starting')}
              </p>
            )}
            {state.status === 'error' && (
              <p className="text-status-danger">{t('boreholePdf.failed', { message: state.message })}</p>
            )}
            {digest && (
              <BoreholePdfTriageList
                digest={digest}
                projectId={projectId}
                selected={selected}
                decisions={decisions}
                onToggle={toggle}
                onCrs={onCrs}
                onWater={onWater}
              />
            )}
          </div>
          {digest && waiting.length > 0 && (
            <p data-testid="borehole-pdf-waiting" className="text-xs text-status-amber">
              {t('boreholePdf.mustConfirm', { n: waiting.length })}
            </p>
          )}
          {digest && clash && (
            <p data-testid="borehole-pdf-clash" className="text-xs text-status-amber">
              {t('boreholePdf.repeatTicked')}
            </p>
          )}
          {error !== null && (
            <p data-testid="borehole-pdf-error" className="text-xs text-status-danger">
              {t('boreholePdf.refused', { message: error })}
            </p>
          )}
          <div className="flex items-center justify-end gap-2">
            {digest && (
              <>
                <Button size="sm" variant="ghost" onClick={() => setSelected(initialSelection(rows))}>
                  {t('boreholePdf.selectAll')}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                  {t('boreholePdf.selectNone')}
                </Button>
              </>
            )}
            <Button size="sm" variant="secondary" onClick={close} disabled={importing}>
              {t('common.cancel')}
            </Button>
            {digest && (
              <Button
                size="sm"
                variant="primary"
                data-testid="borehole-pdf-import"
                disabled={!canImport}
                onClick={runImport}
              >
                {importing ? t('boreholePdf.importing') : t('boreholePdf.importSelected', { n: selected.size })}
              </Button>
            )}
          </div>
        </div>
      </Modal>
      <BoreholeRefreshConfirmDialog
        open={asking !== null}
        fileName={fileName}
        diffs={asking?.diffs ?? []}
        onConfirm={() => {
          const pending = asking
          setAsking(null)
          if (pending) void post({ ...pending.body, confirm_refresh: true })
        }}
        onCancel={() => {
          log.info('borehole-pdf', 'replacement declined: nothing written')
          setAsking(null)
        }}
      />
    </>
  )
}
