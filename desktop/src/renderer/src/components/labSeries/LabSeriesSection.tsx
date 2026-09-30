// The borehole detail's "Lab tests" section: every raw lab test imported on
// one of the borehole's samples (kind, sample, specimens / stages / readings,
// a flags badge) with a "View readings" button that opens the viewer.
//
// Collapsible; open by default when the borehole carries tests. Re-reads when
// an import reports a change (useLabSeriesRevision).

import { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'

import { api } from '../../api/client'
import type { LabSeriesTestSummary } from '../../api/client'
import { useLabSeriesRevision } from '../../hooks/useLabSeriesRevision'
import { useT } from '../../i18n/translate'
import Button from '../ui/Button'
import LabSeriesViewer from './LabSeriesViewer'

interface Props {
  projectId: string
  boreholeId: string
}

type Load = { state: 'loading' } | { state: 'failed' } | { state: 'ready'; rows: LabSeriesTestSummary[] }

/**
 * Lab tests list of one borehole.
 *
 * @returns The section element.
 */
export default function LabSeriesSection({ projectId, boreholeId }: Props): JSX.Element {
  const t = useT()
  const revision = useLabSeriesRevision()
  const [load, setLoad] = useState<Load>({ state: 'loading' })
  const [open, setOpen] = useState<boolean | null>(null)
  const [viewing, setViewing] = useState<LabSeriesTestSummary | null>(null)

  useEffect(() => {
    let alive = true
    api.labSeries
      .listForBorehole(projectId, boreholeId)
      .then(rows => alive && setLoad({ state: 'ready', rows }))
      .catch(() => alive && setLoad({ state: 'failed' }))
    return () => {
      alive = false
    }
  }, [projectId, boreholeId, revision])

  const rows = load.state === 'ready' ? load.rows : []
  // Open by default when there is something to show; the user's toggle wins.
  const expanded = open ?? rows.length > 0

  return (
    <section className="border-t border-border-subtle text-[11px]" data-testid="lab-series-section">
      <button
        type="button"
        onClick={() => setOpen(!expanded)}
        aria-expanded={expanded}
        title={expanded ? t('labSeries.section.collapse') : t('labSeries.section.expand')}
        className="flex items-center gap-1 w-full px-3 py-1 font-semibold text-text-primary hover:bg-surface-app"
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {t('labSeries.section.title', { n: rows.length })}
      </button>
      {expanded && (
        <div className="px-3 pb-2 max-h-48 overflow-y-auto">
          {load.state === 'loading' && <p className="text-text-muted">{t('labSeries.section.loading')}</p>}
          {load.state === 'failed' && <p className="text-status-danger">{t('labSeries.section.failed')}</p>}
          {load.state === 'ready' && rows.length === 0 && (
            <p className="text-text-muted">{t('labSeries.section.empty')}</p>
          )}
          <ul className="space-y-1">
            {rows.map(r => {
              const flagged = r.n_warnings + r.n_errors > 0
              return (
                <li
                  key={r.id}
                  data-testid="lab-series-row"
                  className="flex items-center gap-3 border border-border-subtle rounded px-2 py-1"
                >
                  <span className="font-medium w-28 shrink-0">
                    {r.kind === 'triaxial'
                      ? `${t('labSeries.dialog.kindTriaxial')}${r.test_type_token ? ` ${r.test_type_token}` : ''}`
                      : t('labSeries.dialog.kindOedometer')}
                  </span>
                  <span className="shrink-0">
                    {t('labSeries.section.sample', {
                      top: r.sample_depth_top_m.toFixed(2),
                      base: r.sample_depth_base_m.toFixed(2),
                    })}
                  </span>
                  <span className="text-text-secondary grow">
                    {t('labSeries.section.counts', {
                      specimens: r.n_specimens,
                      stages: r.n_stages,
                      readings: r.n_readings,
                    })}
                  </span>
                  <span
                    className={
                      flagged
                        ? 'px-1.5 rounded border border-status-amber text-status-amber'
                        : 'text-text-muted'
                    }
                  >
                    {flagged
                      ? t('labSeries.section.flags', { warnings: r.n_warnings, errors: r.n_errors })
                      : t('labSeries.section.noFlags')}
                  </span>
                  <Button size="sm" onClick={() => setViewing(r)} title={r.source_file_name}>
                    {t('labSeries.section.open')}
                  </Button>
                </li>
              )
            })}
          </ul>
        </div>
      )}
      {viewing && (
        <LabSeriesViewer
          projectId={projectId}
          sampleId={viewing.sample_id}
          testId={viewing.id}
          onClose={() => setViewing(null)}
        />
      )}
    </section>
  )
}
