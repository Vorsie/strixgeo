// The triage list of the PDF borehole import dialog: one row per borehole.
//
// The CPT digitiser's list for borehole logs (owner 2026-10-10: "the same user
// path"): a page thumbnail (blob: URL, the CSP blocks an http <img>), the name,
// sheets, depth, X/Y, ground level, date, layer and sample counts, the water
// level, a marker when OCR read the sheets, and the parse findings as notes in
// the app language (``importFlagText``, the import report's catalogue). The
// two questions of rulings 3 and 4 sit under the rows that ask them. A row that
// cannot be imported (layout not known, no position, no ground level) shows why
// and cannot be ticked. Presentational: the dialog owns selection and answers.

import type { BoreholePdfDigest, BoreholePdfRow } from '../../api/clients/boreholePdf'
import { usePdfPageThumbnail } from '../../hooks/usePdfPageThumbnail'
import { useT } from '../../i18n/translate'
import { importFlagText } from '../../utils/importFlagText'
import BoreholePdfQuestions from './BoreholePdfQuestions'
import type { CrsChoice, RowDecisions } from './boreholePdfConfirmations'

interface Props {
  digest: BoreholePdfDigest
  projectId: string
  selected: ReadonlySet<string>
  decisions: RowDecisions
  onToggle: (key: string, on: boolean) => void
  onCrs: (key: string, choice: CrsChoice) => void
  onWater: (key: string, confirmed: boolean) => void
}

// The findings the questions under the row ask about: not repeated as notes.
const ASKED = new Set(['CRS_ASSUMED', 'WATER_UNIT_ASSUMED'])

/** "11" or "11–14" for a borehole's sheets. */
function pageSpan(pages: number[]): string {
  if (pages.length === 0) return ''
  const first = pages[0]
  const last = pages[pages.length - 1]
  return first === last ? `${first}` : `${first}–${last}`
}

const THUMBNAIL_BOX = 'h-16 w-12 flex-none border border-border-subtle'

function PageThumbnail({ fileSha, page, projectId }: { fileSha: string; page: number; projectId: string }): JSX.Element {
  const t = useT()
  const { url } = usePdfPageThumbnail(fileSha, page, projectId, 'borehole')
  if (url === null) {
    return <div data-testid="borehole-pdf-thumbnail-placeholder" aria-hidden="true" className={`${THUMBNAIL_BOX} bg-surface-app`} />
  }
  return <img src={url} alt={t('boreholePdf.thumbnailAlt', { page })} className={`${THUMBNAIL_BOX} bg-white object-contain`} />
}

interface RowProps extends Omit<Props, 'digest' | 'selected' | 'decisions'> {
  row: BoreholePdfRow
  fileSha: string
  checked: boolean
  decisions: RowDecisions
  rowsByKey: ReadonlyMap<string, BoreholePdfRow>
}

function BoreholeRow({ row, fileSha, projectId, checked, decisions, rowsByKey, onToggle, onCrs, onWater }: RowProps): JSX.Element {
  const t = useT()
  const notes = row.findings
    .filter(f => !ASKED.has(f.code))
    .map(f => importFlagText({ ...f, rows: [] }, t))
  const other = row.repeat_of ? (rowsByKey.get(row.repeat_of)?.name ?? row.repeat_of) : null
  const meta: string[] = [t('boreholePdf.pages', { pages: pageSpan(row.pages) })]
  if (row.depth_top_m !== null && row.depth_base_m !== null) {
    meta.push(t('boreholePdf.depth', { top: row.depth_top_m.toFixed(2), base: row.depth_base_m.toFixed(2) }))
  }
  if (row.ground_level_m !== null) meta.push(t('boreholePdf.groundLevel', { z: row.ground_level_m.toFixed(2) }))
  if (row.date_text) meta.push(row.date_text)
  return (
    <li data-testid="borehole-pdf-row" className="flex items-start gap-2 border-b border-border-subtle py-1.5 text-xs">
      <input
        type="checkbox"
        className="mt-1"
        checked={checked}
        disabled={!row.importable}
        aria-label={row.name || row.key}
        onChange={e => onToggle(row.key, e.target.checked)}
      />
      <PageThumbnail fileSha={fileSha} page={row.pages[0]} projectId={projectId} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-semibold">{row.name || row.key}</span>
          <span className="text-text-secondary">{meta.join(' · ')}</span>
          <span className="font-mono text-text-secondary">
            {row.x !== null && row.y !== null ? `${row.x.toFixed(1)}, ${row.y.toFixed(1)}` : t('boreholePdf.noPosition')}
          </span>
          {row.text_verdict === 'ocr' && (
            <span data-testid="borehole-pdf-ocr-marker" className="rounded border border-border-subtle px-1 text-text-secondary">
              {t('boreholePdf.readByOcr')}
            </span>
          )}
        </div>
        {row.parsed && (
          <div className="text-text-secondary">
            {t('boreholePdf.counts', { layers: row.n_intervals, samples: row.n_samples })}
            {row.water_level_m !== null && !row.water_unit_assumed && (
              <> · {t('boreholePdf.water', { depth: row.water_level_m.toFixed(2) })}</>
            )}
          </div>
        )}
        {!row.parsed && <p className="text-status-amber">{t('boreholePdf.notParsed')}</p>}
        {row.parsed && !row.importable && <p className="text-status-danger">{t('boreholePdf.notImportable')}</p>}
        {other !== null && <p className="text-status-amber">{t('boreholePdf.repeatOf', { other })}</p>}
        {notes.length > 0 && (
          <ul data-testid="borehole-pdf-notes" className="mt-0.5 list-disc pl-4 text-amber-700 dark:text-amber-400">
            {notes.map((text, i) => (
              <li key={i}>{text}</li>
            ))}
          </ul>
        )}
        {row.importable && (
          <BoreholePdfQuestions row={row} decision={decisions[row.key]} onCrs={onCrs} onWater={onWater} />
        )}
      </div>
    </li>
  )
}

/**
 * The boreholes of a triaged report and the prints set aside.
 *
 * @returns The list element.
 */
export default function BoreholePdfTriageList({
  digest,
  projectId,
  selected,
  decisions,
  onToggle,
  onCrs,
  onWater,
}: Props): JSX.Element {
  const t = useT()
  const rowsByKey = new Map(digest.boreholes.map(r => [r.key, r]))
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm">
        {digest.boreholes.length > 0 ? t('boreholePdf.summary', { n: digest.boreholes.length }) : t('boreholePdf.none')}
      </p>
      {digest.needs_ocr_pages.length > 0 && (
        <p data-testid="borehole-pdf-ocr-unavailable" className="text-xs text-amber-700 dark:text-amber-400">
          {t('boreholePdf.ocrUnavailable', { n: digest.needs_ocr_pages.length })}
        </p>
      )}
      <ul>
        {digest.boreholes.map(row => (
          <BoreholeRow
            key={row.key}
            row={row}
            fileSha={digest.file_sha}
            projectId={projectId}
            checked={selected.has(row.key)}
            decisions={decisions}
            rowsByKey={rowsByKey}
            onToggle={onToggle}
            onCrs={onCrs}
            onWater={onWater}
          />
        ))}
      </ul>
      {digest.dropped.length > 0 && (
        <details data-testid="borehole-pdf-dropped" className="text-xs">
          <summary className="cursor-pointer text-text-secondary">
            {t('boreholePdf.droppedHeading', { n: digest.dropped.length })}
          </summary>
          <ul className="mt-1 list-disc pl-4">
            {digest.dropped.map(d => (
              <li key={`${d.name}-${d.pages.join('-')}`}>
                {t('boreholePdf.droppedRepeat', { name: d.name, pages: pageSpan(d.pages) })}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
