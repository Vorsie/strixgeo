// The sample slide-in's "Raw tests" block (owner ruling 2026-10-04, option a:
// "one place for all lab data of a sample"). It sits BELOW the DOV results in
// LabTestPanel and lists the sample's raw lab tests (oedometer / triaxial):
// kind, file name, date, stages and a flags badge. Each test expands to the
// readings viewer (the same charts as before); collapsing closes it.
//
// "Delete" is irreversible: a ConfirmDialog with Cancel focused and "Delete
// lab test"; no undo. The caller hears about it through ``onLabTestDeleted``
// (toast, Data-list refresh, dirty flag); every mounted list re-reads through
// useLabSeriesRevision, so the borelog's flask and counts follow.
//
// The list itself is passed in: the borehole log fetches the borehole's raw
// tests ONCE and groups them by sample (useBoreholeLabSeries), so opening a
// sample never fires a request of its own.

import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'

import { api } from '../../api/client'
import type { LabSeriesTestSummary } from '../../api/client'
import { notifyLabSeriesChanged } from '../../hooks/useLabSeriesRevision'
import { useT } from '../../i18n/translate'
import { log } from '../../utils/log'
import Button from '../ui/Button'
import ConfirmDialog from '../ui/ConfirmDialog'
import LabSeriesViewer from './LabSeriesViewer'

interface Props {
  projectId: string
  /** The sample's raw tests (already filtered to the sample). */
  tests: readonly LabSeriesTestSummary[]
  /** Fired after a lab test was deleted (the borehole's list re-reads). */
  onLabTestDeleted?: (deleted: LabSeriesTestSummary) => void
}

/** The delete confirmation's state: which row, and the last failure. */
interface PendingDelete {
  row: LabSeriesTestSummary
  busy: boolean
  error: string | null
}

/**
 * Raw lab tests of one sample, with the readings viewer and the delete verb.
 *
 * @returns The block element.
 */
export default function LabSeriesSection({ projectId, tests, onLabTestDeleted }: Props): JSX.Element {
  const t = useT()
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null)
  const expanded = tests.find(r => r.id === expandedId) ?? null

  async function confirmDelete(): Promise<void> {
    if (!pendingDelete || pendingDelete.busy) return
    const { row } = pendingDelete
    setPendingDelete({ row, busy: true, error: null })
    log.info('labSeries', `deleting lab test ${row.id} (${row.source_file_name}) on sample ${row.sample_id}`)
    try {
      await api.labSeries.deleteTest(projectId, row.id)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.warn('labSeries', `lab test ${row.id} not deleted: ${message}`)
      setPendingDelete({ row, busy: false, error: message })
      return
    }
    log.success('labSeries', `lab test ${row.id} deleted`)
    setPendingDelete(null)
    if (expandedId === row.id) setExpandedId(null)
    onLabTestDeleted?.(row)
    notifyLabSeriesChanged()
  }

  return (
    <section data-testid="lab-series-section">
      <div className="text-[11px] font-semibold text-gray-700 uppercase tracking-wide">
        {t('labSeries.panel.title', { n: tests.length })}
      </div>
      <ul className="space-y-1 mt-2 text-[11px]">
        {tests.map(r => {
          const flagged = r.n_warnings + r.n_errors > 0
          const isOpen = r.id === expandedId
          const kind =
            r.kind === 'triaxial'
              ? `${t('labSeries.dialog.kindTriaxial')}${r.test_type_token ? ` ${r.test_type_token}` : ''}`
              : t('labSeries.dialog.kindOedometer')
          return (
            <li key={r.id} data-testid="lab-series-row" className="border border-gray-200 rounded px-2 py-1">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setExpandedId(isOpen ? null : r.id)}
                  aria-expanded={isOpen}
                  title={isOpen ? t('labSeries.panel.collapse') : t('labSeries.panel.expand')}
                  className="flex items-center gap-1 grow min-w-0 text-left hover:text-gray-900"
                >
                  {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  <span className="font-medium shrink-0">{kind}</span>
                  <span className="text-gray-500 truncate">{r.source_file_name}</span>
                </button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setPendingDelete({ row: r, busy: false, error: null })}
                  title={r.source_file_name}
                  data-testid="lab-series-delete"
                >
                  {t('labSeries.section.delete')}
                </Button>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 pl-4 text-[10px] text-gray-500">
                {r.test_start_date && <span>{r.test_start_date}</span>}
                <span>{t('labSeries.panel.stages', { n: r.n_stages })}</span>
                <span
                  className={flagged ? 'px-1 rounded border border-status-amber text-status-amber' : 'text-gray-400'}
                >
                  {flagged
                    ? t('labSeries.section.flags', { warnings: r.n_warnings, errors: r.n_errors })
                    : t('labSeries.section.noFlags')}
                </span>
              </div>
            </li>
          )
        })}
      </ul>
      {expanded && (
        <LabSeriesViewer
          projectId={projectId}
          sampleId={expanded.sample_id}
          testId={expanded.id}
          onClose={() => setExpandedId(null)}
        />
      )}
      <ConfirmDialog
        open={pendingDelete !== null}
        labelledBy="lab-series-delete-title"
        title={t('labSeries.delete.title')}
        body={
          pendingDelete && (
            <>
              <p>
                {t('labSeries.delete.body', {
                  file: pendingDelete.row.source_file_name,
                  top: pendingDelete.row.sample_depth_top_m.toFixed(2),
                  base: pendingDelete.row.sample_depth_base_m.toFixed(2),
                })}
              </p>
              {pendingDelete.error && (
                <p className="mt-2 text-status-danger" role="alert">
                  {t('labSeries.delete.failed', { message: pendingDelete.error })}
                </p>
              )}
            </>
          )
        }
        confirm={{
          label: t('labSeries.delete.confirm'),
          variant: 'danger',
          onClick: () => void confirmDelete(),
          testid: 'lab-series-delete-confirm',
        }}
        busy={pendingDelete?.busy ?? false}
        onCancel={() => setPendingDelete(null)}
        testid="lab-series-delete-dialog"
      />
    </section>
  )
}
