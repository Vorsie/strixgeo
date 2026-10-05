// Data → Import → "Import CPTs from a PDF report".
//
// Triage the picked report (progress while the job runs), list what it offers
// (CptPdfTriageList), let the user calibrate any sounding against its overlay
// (CptPdfCalibrationOverlay), then import the ticked ones in ONE post. A
// sounding already in the project is never replaced without consent: each one
// is put to the user with the GEF import's own dialog (CptRefreshConfirmDialog,
// Cancel focused, "Replace data"), one at a time, and only the agreed ones are
// re-posted with ``confirm_refresh``. The report then lists every sounding with
// what happened and the digitiser's remarks.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { CptRefreshDiff } from '../../api/client'
import {
  cptPdfClient,
  type CptPdfDigest,
  type CptPdfHeaderEdit,
  type CptPdfImportResult,
  type PageCalibrationDict,
} from '../../api/clients/cptPdf'
import { useCptPdfTriage, type CptPdfTriagePhase } from '../../hooks/useCptPdfTriage'
import type { MessageKey } from '../../i18n/locales/en'
import { useT } from '../../i18n/translate'
import { log } from '../../utils/log'
import CptRefreshConfirmDialog from '../CptRefreshConfirmDialog'
import Button from '../ui/Button'
import Modal from '../ui/Modal'
import CptPdfCalibrationOverlay, { type CptPdfSoundingEdit } from './CptPdfCalibrationOverlay'
import CptPdfImportReport from './CptPdfImportReport'
import CptPdfTriageList from './CptPdfTriageList'
import { fieldFillFor, reportProjectNumber } from './cptPdfProjectNumber'

interface Props {
  open: boolean
  /** The report the user picked. */
  filePath: string
  projectId: string
  onClose: () => void
  /** Every sounding's final outcome, once the import (and its consents) settled. */
  onImported: (results: CptPdfImportResult[], fileName: string) => void
}

type Stage = { kind: 'list' } | { kind: 'calibrate'; key: string } | { kind: 'report' }

/** The GEF consent dialog's diff shape, from an import outcome. */
function refreshDiff(r: CptPdfImportResult): CptRefreshDiff {
  const d = r.diff
  return {
    cptId: r.cpt_id ?? '',
    name: d?.name ?? r.name,
    oldMaxDepthM: d?.old_max_depth_m ?? null,
    newMaxDepthM: d?.new_max_depth_m ?? null,
    oldNRows: d?.old_n_rows ?? null,
    newNRows: d?.new_n_rows ?? null,
    nErrors: d?.n_errors ?? 0,
    nWarnings: d?.n_warnings ?? 0,
  }
}

/**
 * The progress line's message: OCR named while it runs (seconds per sheet, the
 * slow part of a report whose text layer is unreadable), else the phase.
 */
function progressKey(phase: CptPdfTriagePhase, ocr: boolean): MessageKey {
  if (ocr) return 'cptPdf.phase.ocr'
  return phase === 'classify' ? 'cptPdf.phase.classify' : 'cptPdf.phase.digitise'
}

/** The campaign soundings start ticked; the unknown-origin ones do not. */
function initialSelection(digest: CptPdfDigest): Set<string> {
  return new Set(digest.campaign.map(s => s.key))
}

/**
 * The PDF CPT import dialog.
 *
 * @returns The modal (nothing when closed).
 */
export default function CptPdfImportDialog({
  open,
  filePath,
  projectId,
  onClose,
  onImported,
}: Props): JSX.Element | null {
  const t = useT()
  const { state, start, reset } = useCptPdfTriage()
  const fileName = filePath.split(/[\\/]/).pop() ?? filePath
  const [stage, setStage] = useState<Stage>({ kind: 'list' })
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [edits, setEdits] = useState<Record<string, CptPdfSoundingEdit>>({})
  // The "Projectnummer" field (owner ruling 2026-10-05 a): fills the project
  // number of every row whose sheet prints none; reset with each digest.
  const [projectNumber, setProjectNumber] = useState('')
  const [importing, setImporting] = useState(false)
  const [results, setResults] = useState<CptPdfImportResult[]>([])
  const [asking, setAsking] = useState<CptPdfImportResult | null>(null)
  const askResolveRef = useRef<((agreed: boolean) => void) | null>(null)

  useEffect(() => {
    if (open) start(filePath, projectId)
    // reason: one triage per opened report; ``start`` is stable and a project
    // switch closes the dialog, so re-running on identity changes would upload
    // the same report twice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, filePath])

  const digest = state.status === 'done' ? state.digest : null
  useEffect(() => {
    if (!digest) return
    setSelected(initialSelection(digest))
    setProjectNumber(reportProjectNumber(digest))
  }, [digest])

  const listed = useMemo(() => (digest ? [...digest.campaign, ...digest.unknown] : []), [digest])
  const edited = useMemo(() => new Set(Object.keys(edits)), [edits])
  const headerEdits = useMemo(() => {
    const out: Record<string, CptPdfHeaderEdit> = {}
    for (const [key, edit] of Object.entries(edits)) if (edit.header) out[key] = edit.header
    return out
  }, [edits])

  const toggle = useCallback((key: string, on: boolean) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (on) next.add(key)
      else next.delete(key)
      return next
    })
  }, [])

  const ask = (r: CptPdfImportResult): Promise<boolean> =>
    new Promise(resolve => {
      askResolveRef.current = resolve
      setAsking(r)
    })
  const settle = (agreed: boolean): void => {
    const resolve = askResolveRef.current
    askResolveRef.current = null
    setAsking(null)
    resolve?.(agreed)
  }

  const runImport = async (): Promise<void> => {
    if (!digest) return
    const keys = listed.map(s => s.key).filter(k => selected.has(k))
    if (keys.length === 0) return
    const calibrations: Record<string, PageCalibrationDict[]> = {}
    const headers: Record<string, CptPdfHeaderEdit> = {}
    const byKey = new Map(listed.map(s => [s.key, s]))
    let filled = 0
    for (const key of keys) {
      const edit = edits[key]
      if (edit?.calibrations) calibrations[key] = edit.calibrations
      const header: CptPdfHeaderEdit = { ...edit?.header }
      const sounding = byKey.get(key)
      const fill = sounding ? fieldFillFor(sounding, projectNumber, edit?.header) : null
      if (fill !== null) {
        header.project_number = fill
        filled += 1
      }
      if (Object.keys(header).length > 0) headers[key] = header
    }
    if (filled > 0) log.info('cpt-pdf', `project number ${projectNumber.trim()} filled in for ${filled} sounding(s)`)
    const body = { project_id: projectId, file_sha: digest.file_sha, calibrations, headers }
    setImporting(true)
    try {
      log.info('cpt-pdf', `importing ${keys.length} sounding(s) of ${digest.file_sha.slice(0, 12)}`)
      const first = (await cptPdfClient.importSoundings({ ...body, sounding_ids: keys })).results
      const outcomes = new Map(first.map(r => [r.sounding_id, r]))
      // Replacing a stored CPT is irreversible: asked per sounding, one dialog
      // at a time (docs/ux.md "Reversible vs irreversible").
      const agreed: string[] = []
      for (const r of first) {
        if (r.status !== 'confirmation_required') continue
        if (await ask(r)) agreed.push(r.sounding_id)
        else log.info('cpt-pdf', `replacement of ${r.name} declined: left unchanged`)
      }
      if (agreed.length > 0) {
        const second = await cptPdfClient.importSoundings({ ...body, sounding_ids: agreed, confirm_refresh: true })
        for (const r of second.results) outcomes.set(r.sounding_id, r)
      }
      const final = keys.map(k => outcomes.get(k)).filter((r): r is CptPdfImportResult => r !== undefined)
      setResults(final)
      setStage({ kind: 'report' })
      onImported(final, fileName)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.error('cpt-pdf', `import failed: ${msg}`)
      setResults(keys.map(k => ({
        sounding_id: k, status: 'failed', name: k, cpt_id: null, code: null, message: msg, diff: null, issues: [],
      })))
      setStage({ kind: 'report' })
    } finally {
      setImporting(false)
    }
  }

  const close = (): void => {
    reset()
    onClose()
  }

  if (!open) return null
  const calibrating = stage.kind === 'calibrate' ? listed.find(s => s.key === stage.key) : undefined

  return (
    <>
      <Modal open={open} onCancel={close} labelledBy="cpt-pdf-import-title" busy={importing} cardClassName="w-[64rem] max-w-[95vw]" testid="cpt-pdf-import-dialog">
        <div className="flex max-h-[85vh] flex-col gap-3 overflow-hidden">
          <h2 id="cpt-pdf-import-title" className="text-sm font-semibold">
            {t('cptPdf.title')} <span className="font-mono font-normal text-text-secondary">{fileName}</span>
          </h2>
          <div className="min-h-0 flex-1 overflow-auto">
            {(state.status === 'idle' || state.status === 'uploading') && <p>{t('cptPdf.uploading')}</p>}
            {state.status === 'running' && (
              <p data-testid="cpt-pdf-progress">
                {state.phase
                  ? t(progressKey(state.phase, state.ocr === true), {
                      done: state.done,
                      total: state.total,
                    })
                  : t('cptPdf.starting')}
              </p>
            )}
            {state.status === 'error' && (
              <p className="text-red-600">{t('cptPdf.failed', { message: state.message })}</p>
            )}
            {digest && stage.kind === 'list' && (
              <CptPdfTriageList
                digest={digest}
                projectId={projectId}
                selected={selected}
                edited={edited}
                headers={headerEdits}
                projectNumber={projectNumber}
                onProjectNumberChange={setProjectNumber}
                onToggle={toggle}
                onCalibrate={key => setStage({ kind: 'calibrate', key })}
              />
            )}
            {digest && calibrating && (
              <CptPdfCalibrationOverlay
                projectId={projectId}
                fileSha={digest.file_sha}
                sounding={calibrating}
                initial={edits[calibrating.key] ?? {}}
                onBack={() => setStage({ kind: 'list' })}
                onDone={edit => {
                  setEdits(prev => ({ ...prev, [calibrating.key]: edit }))
                  setSelected(prev => new Set(prev).add(calibrating.key))
                  setStage({ kind: 'list' })
                }}
              />
            )}
            {stage.kind === 'report' && <CptPdfImportReport results={results} />}
          </div>
          <div className="flex items-center justify-end gap-2">
            {digest && stage.kind === 'list' && (
              <>
                <Button size="sm" variant="ghost" onClick={() => setSelected(initialSelection(digest))}>
                  {t('cptPdf.selectAll')}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                  {t('cptPdf.selectNone')}
                </Button>
              </>
            )}
            <Button size="sm" variant="secondary" onClick={close} disabled={importing}>
              {stage.kind === 'report' ? t('common.close') : t('common.cancel')}
            </Button>
            {digest && stage.kind === 'list' && (
              <Button
                size="sm"
                variant="primary"
                data-testid="cpt-pdf-import"
                disabled={importing || selected.size === 0}
                onClick={() => void runImport()}
              >
                {importing ? t('cptPdf.importing') : t('cptPdf.importSelected', { n: selected.size })}
              </Button>
            )}
          </div>
        </div>
      </Modal>
      <CptRefreshConfirmDialog
        open={asking !== null}
        fileName={`${fileName} · ${asking?.name ?? ''}`}
        diff={asking ? refreshDiff(asking) : null}
        onConfirm={() => settle(true)}
        onCancel={() => settle(false)}
      />
    </>
  )
}
