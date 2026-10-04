// The import report of the PDF CPT import dialog: one line per sounding with
// what happened to it and the remarks the digitiser made (clipped points,
// depth derived from an elevation axis, no position, ...). Each remark is
// worded in the app language from its code + params (owner finding
// 2026-10-04); the code stays as a small tag and the backend's English
// sentence is the tooltip, the borehole XML report's pattern.

import type { CptPdfImportIssue, CptPdfImportResult } from '../../api/clients/cptPdf'
import { useT, type Translator } from '../../i18n/translate'
import type { MessageKey } from '../../i18n/locales/en'
import { cptPdfIssueText } from '../../utils/cptPdfNoteText'
import { PRE_DRILL_NOT_APPLIED, preDrillImportWarning } from '../../utils/preDrillImportWarning'

interface Props {
  results: CptPdfImportResult[]
}

const STATUS_KEY: Record<CptPdfImportResult['status'], MessageKey> = {
  imported: 'cptPdf.report.status.imported',
  refreshed: 'cptPdf.report.status.refreshed',
  confirmation_required: 'cptPdf.report.status.confirmation_required',
  refused: 'cptPdf.report.status.refused',
  failed: 'cptPdf.report.status.failed',
}

const STATUS_CLASS: Record<CptPdfImportResult['status'], string> = {
  imported: 'text-green-700 dark:text-green-400',
  refreshed: 'text-green-700 dark:text-green-400',
  confirmation_required: 'text-text-secondary',
  refused: 'text-amber-700 dark:text-amber-400',
  failed: 'text-red-600',
}

/**
 * One remark in the app language. A GEF pre-drill finding reuses the Data
 * import's line for it; every other code goes through the PDF catalogue.
 *
 * @returns The sentence the report shows.
 */
function issueText(issue: CptPdfImportIssue, name: string, t: Translator): string {
  if (issue.code === PRE_DRILL_NOT_APPLIED) return preDrillImportWarning([issue], name, t) ?? issue.message
  return cptPdfIssueText(issue, t)
}

/**
 * Per-sounding outcome and remarks.
 *
 * @returns The report list.
 */
export default function CptPdfImportReport({ results }: Props): JSX.Element {
  const t = useT()
  return (
    <section data-testid="cpt-pdf-import-report" aria-label={t('cptPdf.report.title')} className="text-xs">
      <h3 className="mb-1 text-sm font-semibold">{t('cptPdf.report.title')}</h3>
      <ul className="max-h-[50vh] overflow-auto">
        {results.map(r => (
          <li key={r.sounding_id} data-testid="cpt-pdf-report-row" className="border-b border-border-subtle py-1">
            <span className="font-semibold">{r.name}</span>{' '}
            <span className={STATUS_CLASS[r.status]}>{t(STATUS_KEY[r.status])}</span>
            {r.message && r.status !== 'imported' && r.status !== 'refreshed' && (
              <span className="text-text-secondary">: {r.message}</span>
            )}
            {r.issues.length > 0 ? (
              <ul className="list-disc pl-4 text-text-secondary">
                {r.issues.map(i => (
                  <li key={`${i.code}-${i.message}`} data-testid="cpt-pdf-report-issue" title={i.message}>
                    {issueText(i, r.name, t)}{' '}
                    <span className="rounded bg-surface-sunken px-1 font-mono text-[10px] text-text-muted">
                      {i.code}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <span className="text-text-secondary"> ({t('cptPdf.report.noIssues')})</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
