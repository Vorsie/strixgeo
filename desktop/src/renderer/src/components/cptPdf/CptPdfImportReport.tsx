// The import report of the PDF CPT import dialog: one line per sounding with
// what happened to it and the remarks the digitiser made (clipped points,
// depth derived from an elevation axis, no position, ...).

import type { CptPdfImportResult } from '../../api/clients/cptPdf'
import { useT } from '../../i18n/translate'
import type { MessageKey } from '../../i18n/locales/en'

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
                  <li key={`${i.code}-${i.message}`}>
                    <span className="font-mono">{i.code}</span>: {i.message}
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
