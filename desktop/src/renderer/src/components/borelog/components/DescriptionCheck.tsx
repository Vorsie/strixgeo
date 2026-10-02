/**
 * The check gate of a coded lithology started from a DOV description (owner
 * 2026-10-01: "make sure the person using it checks everything, like when you
 * hover an interval you see the source in one way or another").
 *
 * * ``descriptionTooltip`` — the hover text of a row whose codes were read from
 *   text: the verbatim description, then every clause the reading could not
 *   place (unmatched, mapped to a nearest code, not stored by a coded track, or
 *   read but not coded: a denial, a second colour, a feel word),
 *   so nothing is silently dropped;
 * * ``DescriptionCheckCell`` — the row's amber "From description, check"
 *   marker with its "Checked" button, or a muted "From description" once
 *   checked (the hover text stays);
 * * ``DescriptionCheckSummary`` — under the grid: "Mark all as checked" (a
 *   plain button, never the default focus), the hint, and the unmatched clauses
 *   of all rows listed once.
 *
 * Split out of ``TrackIntervalEditor`` (file-size budget, debt #201).
 */
import type { Translator } from '../../../i18n/translate'
import type { TrackEditorRow } from '../../../utils/boreholeTracks'
import { useT } from '../../../i18n/translate'

/**
 * The hover text of a row read from a description.
 *
 * @param t - Translator.
 * @param row - The editor row.
 * @returns The multi-line text, or ``undefined`` for a row not read from text.
 */
export function descriptionTooltip(t: Translator, row: TrackEditorRow): string | undefined {
  if (row.sourceText === undefined) return undefined
  const lines = [t('tracks.check.source', { text: row.sourceText })]
  const notes = row.parseNotes
  if (notes === undefined) return lines.join('\n')
  if (notes.unmatched.length > 0) lines.push(t('tracks.check.notMatched', { list: notes.unmatched.join(', ') }))
  if (notes.approximations.length > 0) {
    const list = notes.approximations.map(a => `${a.phrase} = ${a.code}`).join(', ')
    lines.push(t('tracks.check.approximated', { list }))
  }
  const notStored = [
    notes.moisture ? t('tracks.check.moisture', { token: notes.moisture }) : '',
    notes.consistency ? t('tracks.check.consistency', { token: notes.consistency }) : '',
  ].filter(x => x !== '')
  if (notStored.length > 0) lines.push(t('tracks.check.notStored', { list: notStored.join(', ') }))
  if (notes.notes.length > 0) lines.push(t('tracks.check.notes', { list: notes.notes.join(', ') }))
  return lines.join('\n')
}

interface CellProps {
  row: TrackEditorRow
  /** Zero-based row index (the labels say ``index + 1``). */
  index: number
  onChecked: () => void
}

/**
 * The check marker of one row.
 *
 * @returns The marker, or ``null`` for a row not read from a description.
 */
export function DescriptionCheckCell({ row, index, onChecked }: CellProps): JSX.Element | null {
  const t = useT()
  const tip = descriptionTooltip(t, row)
  if (tip === undefined) return null
  if (!row.needsCheck) {
    return (
      <span title={tip} className="text-[10px] text-text-muted">
        {t('tracks.check.checkedMarker')}
      </span>
    )
  }
  const label = t('tracks.check.markCheckedRow', { row: index + 1 })
  return (
    <div className="flex items-center gap-1">
      <span
        title={tip}
        className="whitespace-nowrap rounded border border-amber-400 px-1 text-[10px] text-amber-700 dark:text-amber-300"
      >
        {t('tracks.check.marker')}
      </span>
      <button
        type="button"
        aria-label={label}
        title={label}
        onClick={onChecked}
        className="whitespace-nowrap text-xs text-blue-600 dark:text-blue-400 hover:underline"
      >
        {t('tracks.check.markChecked')}
      </button>
    </div>
  )
}

interface SummaryProps {
  /** Rows still waiting for a check. */
  pending: number
  /** Unmatched clauses of all rows, once each. */
  unmatched: readonly string[]
  onMarkAll: () => void
}

/**
 * Under the grid: "Mark all as checked", the hint, the unmatched clauses.
 *
 * @returns The summary block.
 */
export function DescriptionCheckSummary({ pending, unmatched, onMarkAll }: SummaryProps): JSX.Element {
  const t = useT()
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-3">
        <p className="text-[10px] text-text-muted">{t('tracks.check.hint')}</p>
        {pending > 0 && (
          <button
            type="button"
            onClick={onMarkAll}
            className="ml-auto whitespace-nowrap text-xs text-blue-600 dark:text-blue-400 hover:underline"
          >
            {t('tracks.check.markAll')}
          </button>
        )}
      </div>
      {unmatched.length > 0 && (
        <p className="text-xs text-amber-700 dark:text-amber-300">
          {t('tracks.check.notMatched', { list: unmatched.join(', ') })}
        </p>
      )}
    </div>
  )
}
