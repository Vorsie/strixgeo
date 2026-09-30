// The triage list of the PDF CPT import dialog.
//
// Owner answers 2026-09-30: the campaign's own soundings are offered (all
// ticked); desk-study reprints are NOT offered and are named once in a
// collapsed "Not imported" block so the user knows what to look up himself; a
// sheet printed twice is named there with its notice; soundings of unknown
// origin are listed apart and start unticked. Presentational: the dialog owns
// the selection.

import { cptPdfClient, type CptPdfDigest, type CptPdfSounding } from '../../api/clients/cptPdf'
import { useT } from '../../i18n/translate'

interface Props {
  digest: CptPdfDigest
  projectId: string
  /** Keys of the ticked soundings. */
  selected: ReadonlySet<string>
  /** Keys whose calibration or header the user changed. */
  edited: ReadonlySet<string>
  onToggle: (key: string, on: boolean) => void
  onCalibrate: (key: string) => void
}

/** "231" or "231–232" for a sounding's pages. */
function pageSpan(pages: number[]): string {
  if (pages.length === 0) return ''
  const first = pages[0]
  const last = pages[pages.length - 1]
  return first === last ? `${first}` : `${first}–${last}`
}

interface RowProps {
  sounding: CptPdfSounding
  testid: string
  fileSha: string
  projectId: string
  checked: boolean
  edited: boolean
  onToggle: (key: string, on: boolean) => void
  onCalibrate: (key: string) => void
}

function SoundingRow({
  sounding,
  testid,
  fileSha,
  projectId,
  checked,
  edited,
  onToggle,
  onCalibrate,
}: RowProps): JSX.Element {
  const t = useT()
  const firstPage = sounding.page_numbers[0]
  const label = sounding.sounding_id ?? sounding.key
  return (
    <li
      data-testid={testid}
      className="flex items-start gap-2 border-b border-border-subtle py-1.5 text-xs"
    >
      <input
        type="checkbox"
        className="mt-1"
        checked={checked}
        aria-label={label}
        onChange={e => onToggle(sounding.key, e.target.checked)}
      />
      <img
        src={cptPdfClient.pageUrl(fileSha, firstPage, projectId)}
        alt={t('cptPdf.thumbnailAlt', { page: firstPage })}
        loading="lazy"
        className="h-16 w-12 flex-none border border-border-subtle bg-white object-contain"
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-semibold">{label}</span>
          <span className="text-text-secondary">{t('cptPdf.pages', { pages: pageSpan(sounding.page_numbers) })}</span>
          {sounding.ground_level_m !== null && (
            <span className="text-text-secondary">
              {t('cptPdf.groundLevel', { z: sounding.ground_level_m.toFixed(2) })}
            </span>
          )}
          <span className="font-mono text-text-secondary">
            {sounding.x !== null && sounding.y !== null
              ? `${sounding.x.toFixed(1)}, ${sounding.y.toFixed(1)}`
              : t('cptPdf.noPosition')}
          </span>
          {edited && <span className="text-accent">{t('cptPdf.edited')}</span>}
        </div>
        {sounding.warnings.length > 0 && (
          <ul className="mt-0.5 list-disc pl-4 text-amber-700 dark:text-amber-400">
            {sounding.warnings.map(w => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}
      </div>
      <button
        type="button"
        data-testid="cpt-pdf-calibrate"
        className="flex-none rounded px-2 py-0.5 text-xs text-accent hover:bg-surface-app"
        onClick={() => onCalibrate(sounding.key)}
      >
        {t('cptPdf.calibrate')}
      </button>
    </li>
  )
}

/**
 * The campaign soundings, the unknown-origin group and the "Not imported" block.
 *
 * @returns The list element.
 */
export default function CptPdfTriageList({
  digest,
  projectId,
  selected,
  edited,
  onToggle,
  onCalibrate,
}: Props): JSX.Element {
  const t = useT()
  const setAside = digest.dropped.filter(d => d.reason !== 'desk-study')
  const notImportedCount = digest.desk_study_ids.length + setAside.length
  const row = (s: CptPdfSounding, testid: string): JSX.Element => (
    <SoundingRow
      key={s.key}
      sounding={s}
      testid={testid}
      fileSha={digest.file_sha}
      projectId={projectId}
      checked={selected.has(s.key)}
      edited={edited.has(s.key)}
      onToggle={onToggle}
      onCalibrate={onCalibrate}
    />
  )
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm">
        {digest.report_code
          ? t('cptPdf.summary', { n: digest.campaign.length, report: digest.report_code })
          : t('cptPdf.summaryNoCode', { n: digest.campaign.length })}
      </p>
      {!digest.ocr_available && (
        <p data-testid="cpt-pdf-ocr-unavailable" className="text-xs text-amber-700 dark:text-amber-400">
          {t('cptPdf.ocrUnavailable')}
        </p>
      )}
      {digest.raster_pages_unread > 0 && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          {t('cptPdf.rasterUnread', { n: digest.raster_pages_unread })}
        </p>
      )}
      <section aria-label={t('cptPdf.campaignHeading')}>
        <h3 className="text-xs font-semibold uppercase text-text-secondary">{t('cptPdf.campaignHeading')}</h3>
        <ul>{digest.campaign.map(s => row(s, 'cpt-pdf-row-campaign'))}</ul>
      </section>
      {digest.unknown.length > 0 && (
        <section aria-label={t('cptPdf.unknownHeading')}>
          <h3 className="text-xs font-semibold uppercase text-text-secondary">{t('cptPdf.unknownHeading')}</h3>
          <ul>{digest.unknown.map(s => row(s, 'cpt-pdf-row-unknown'))}</ul>
        </section>
      )}
      {notImportedCount > 0 && (
        <details data-testid="cpt-pdf-not-imported" className="text-xs">
          <summary className="cursor-pointer text-text-secondary">
            {t('cptPdf.notImported', { n: notImportedCount })}
          </summary>
          {digest.desk_study_ids.length > 0 && (
            <p className="mt-1">{t('cptPdf.lookUpYourself', { ids: digest.desk_study_ids.join(', ') })}</p>
          )}
          {setAside.length > 0 && (
            <ul className="mt-1 list-disc pl-4">
              {setAside.map(d => (
                <li key={`${d.reason}-${d.page_numbers.join('-')}`}>
                  {d.sounding_id} ({t('cptPdf.pages', { pages: pageSpan(d.page_numbers) })}): {d.note}
                </li>
              ))}
            </ul>
          )}
        </details>
      )}
    </div>
  )
}
