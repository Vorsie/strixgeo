// The borehole import report: per file -> per boring -> every flag.
//
// Owner 2026-09-28: "flag everything that is weird". The backend raises the
// flags (each message names its boring, in English, verbatim); this panel is
// where the engineer reads them after an Import boreholes (DOV XML) run. A
// toast cannot carry 40 flags, so the toast summarises and this panel lists.
// "Copy report" puts the same content on the clipboard as plain text.
//
// Read-only and reversible: Close (default focus) dismisses, nothing is lost.

import { useEffect, useRef, useState } from 'react'

import type { ImportFlag } from '../api/client'
import type { BoreholeImportReportFile } from '../hooks/useBoreholeXmlImport'
import { useT, type Translator } from '../i18n/translate'
import type { MessageKey } from '../i18n/locales/en'
import { log } from '../utils/log'
import Button from './ui/Button'
import Modal from './ui/Modal'

interface Props {
  /** The run's report; ``null`` renders nothing. */
  report: BoreholeImportReportFile[] | null
  /** Close / Esc / backdrop. */
  onClose: () => void
}

const TITLE_ID = 'borehole-import-report-title'

/** Level -> label key. Unknown levels fall back to the info label. */
function levelKey(level: string): MessageKey {
  if (level === 'error') return 'data.importFlags.levelError'
  if (level === 'warning') return 'data.importFlags.levelWarning'
  return 'data.importFlags.levelInfo'
}

/** Level -> badge colours (paired with the text label: never colour alone). */
function levelClass(level: string): string {
  // Design tokens (tailwind.config.js "Status"): theme-aware in light + dark.
  if (level === 'error') return 'border border-status-danger text-status-danger'
  if (level === 'warning') return 'border border-status-amber text-status-amber'
  return 'border border-transparent bg-surface-app text-text-secondary'
}

/**
 * Render the report as plain text, one line per file, boring and flag.
 *
 * @param report - The run's report.
 * @param t - Translator for the chrome words (levels, tags).
 * @returns The text the Copy button puts on the clipboard.
 */
export function formatImportReport(report: BoreholeImportReportFile[], t: Translator): string {
  const lines: string[] = []
  const flagLine = (indent: string, flag: ImportFlag): string =>
    `${indent}[${t(levelKey(flag.level))}] ${flag.code}: ${flag.message}`
  for (const file of report) {
    lines.push(file.fileName)
    if (file.outcome === 'failed')
      lines.push(`  ${t('data.importFlags.fileFailed', { message: file.error ?? '' })}`)
    if (file.outcome === 'declined') lines.push(`  ${t('data.importFlags.fileDeclined')}`)
    for (const flag of file.fileIssues) lines.push(flagLine('  ', flag))
    for (const boring of file.boreholes) {
      const tags = [
        boring.refreshed ? t('data.importFlags.refreshed') : null,
        boring.imported ? null : t('data.importFlags.notImported'),
      ].filter(Boolean)
      lines.push(`  ${boring.name}${tags.length ? ` (${tags.join(', ')})` : ''}`)
      if (boring.issues.length === 0) lines.push(`    ${t('data.importFlags.noFlags')}`)
      for (const flag of boring.issues) lines.push(flagLine('    ', flag))
    }
  }
  return lines.join('\n')
}

/** One flag row: level badge, code, the backend's message. */
function FlagRow({ flag, t }: { flag: ImportFlag; t: Translator }): JSX.Element {
  return (
    <li data-testid="import-flag" className="flex items-start gap-2 py-0.5">
      <span
        className={`mt-px shrink-0 rounded px-1.5 text-[10px] font-medium ${levelClass(flag.level)}`}
      >
        {t(levelKey(flag.level))}
      </span>
      <span className="shrink-0 font-mono text-[10px] text-text-secondary" title={flag.code}>
        {flag.code}
      </span>
      <span className="min-w-0 break-words text-text-primary">{flag.message}</span>
    </li>
  )
}

/**
 * Modal listing every flag of a borehole XML import run.
 *
 * @returns The panel, or nothing when ``report`` is null.
 */
export default function BoreholeImportReportPanel({ report, onClose }: Props): JSX.Element | null {
  const t = useT()
  const closeRef = useRef<HTMLButtonElement>(null)
  const [copied, setCopied] = useState(false)
  const open = report !== null

  useEffect(() => {
    if (open) {
      setCopied(false)
      closeRef.current?.focus()
    }
  }, [open])

  if (report === null) return null

  const copy = (): void => {
    navigator.clipboard
      .writeText(formatImportReport(report, t))
      .then(() => setCopied(true))
      .catch(err => log.warn('import', 'copy import report failed', err))
  }

  return (
    <Modal
      open={open}
      onCancel={onClose}
      labelledBy={TITLE_ID}
      cardClassName="w-[44rem] max-w-[92vw]"
      testid="borehole-import-report"
    >
      <div className="flex max-h-[80vh] flex-col p-5">
        <h2 id={TITLE_ID} className="mb-1 text-sm font-semibold text-text-primary">
          {t('data.importFlags.title')}
        </h2>
        <p className="mb-3 text-xs text-text-secondary">{t('data.importFlags.intro')}</p>
        <div className="min-h-0 flex-1 overflow-y-auto pr-1 text-xs">
          {report.map((file, fi) => (
            <section key={`${file.fileName}-${fi}`} className="mb-3">
              <h3 className="mb-1 font-mono font-semibold text-text-primary">{file.fileName}</h3>
              {file.outcome === 'failed' && (
                <p className="text-status-danger">
                  {t('data.importFlags.fileFailed', { message: file.error ?? '' })}
                </p>
              )}
              {file.outcome === 'declined' && (
                <p className="text-text-secondary">{t('data.importFlags.fileDeclined')}</p>
              )}
              {file.fileIssues.length > 0 && (
                <div className="mb-1 ml-3">
                  <div className="font-medium text-text-secondary">
                    {t('data.importFlags.fileLevel')}
                  </div>
                  <ul>
                    {file.fileIssues.map((flag, i) => (
                      <FlagRow key={i} flag={flag} t={t} />
                    ))}
                  </ul>
                </div>
              )}
              {file.boreholes.map((boring, bi) => (
                <div key={`${boring.test_id}-${bi}`} className="mb-1 ml-3">
                  <div className="flex items-baseline gap-2">
                    <span className="font-medium text-text-primary">{boring.name}</span>
                    {boring.refreshed && (
                      <span className="text-text-secondary">{t('data.importFlags.refreshed')}</span>
                    )}
                    {!boring.imported && (
                      <span className="text-status-danger">
                        {t('data.importFlags.notImported')}
                      </span>
                    )}
                  </div>
                  {boring.issues.length === 0 ? (
                    <p className="ml-3 text-text-secondary">{t('data.importFlags.noFlags')}</p>
                  ) : (
                    <ul className="ml-3">
                      {boring.issues.map((flag, i) => (
                        <FlagRow key={i} flag={flag} t={t} />
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </section>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap justify-end gap-2">
          <Button
            variant="secondary"
            size="md"
            onClick={copy}
            data-testid="borehole-import-report-copy"
          >
            {copied ? t('data.importFlags.copied') : t('data.importFlags.copy')}
          </Button>
          <Button
            ref={closeRef}
            variant="primary"
            size="md"
            onClick={onClose}
            data-testid="borehole-import-report-close"
          >
            {t('common.close')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
