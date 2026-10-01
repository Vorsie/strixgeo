/**
 * The interval editor of one borehole track (owner 2026-09-29).
 *
 * A keyboard-first table: Top / Base (m) as text inputs, then the cells the
 * track's kind carries — a DOV codelist picker (field-log value, coded main
 * soil / colour / admixtures, formal-stratigraphy unit) or free text (the
 * lithological description and the stratigraphy streams DOV publishes no list
 * for). A new row starts at the last base; Enter in the last row adds one.
 *
 * Every cell is re-judged on each keystroke by ``validateTrackRows`` (the
 * mirror of the backend rules): errors block Save, warnings (gaps, deeper than
 * drilled) only inform. The component is controlled: the parent owns the rows.
 *
 * Owner dogfeed 2026-09-30:
 *
 * * "When adding a coded lithology it would be nice to see the info that is
 *   already there in other tracks": a read-only REFERENCE PANE beside the rows
 *   (above them on a narrow window) lists the borehole's other tracks as
 *   depth-ordered intervals; the intervals that overlap the row that has the
 *   focus are marked and scrolled into view;
 * "it is way too small, i also want the psd's of monster to be visible in
 *   the right hand pane" (2026-10-01): the editor and the pane are two grid
 *   columns that never overlap (the pane at least 24rem, stacked BELOW the
 *   editor on a narrow dialog), the pane sticks to the top of the dialog body
 *   and is as tall as it, its text at the dialog's normal size; it carries the
 *   borehole's samples with their grain-size curve and lab results
 *   (``SampleReferenceBlock``), marked like the other reference intervals;
 * * "i want max 3 admixtures in coded lithology": a row never offers a fourth
 *   admixture and says "3 at most" (``MAX_ADMIXTURES_PER_INTERVAL``).
 */
import { useEffect, useRef, useState } from 'react'
import { Plus, Trash2, X } from 'lucide-react'

import type {
  TrackRowIssue,
  TrackEditorRow,
  TrackRowsVerdict,
} from '../../../utils/boreholeTracks'
import {
  MAX_ADMIXTURES_PER_INTERVAL,
  newRowAfter,
  referenceIntervalText,
  referenceOverlapsRow,
  trackContent,
} from '../../../utils/boreholeTracks'
import type { SampleResponse, TrackIntervalBody } from '../../../api/client'
import type { CodeOption, CodelistField } from '../../../utils/dovTrackCodelists'
import { useT } from '../../../i18n/translate'
import type { MessageKey } from '../../../i18n/locales/en'
import CodelistPicker from './CodelistPicker'
import SampleReferenceBlock from './SampleReferenceBlock'

/** One of the borehole's OTHER tracks, shown read-only beside the rows. */
export interface ReferenceTrack {
  trackId: string
  /** Translated kind + provenance, e.g. "Field log: colour (DOV)". */
  label: string
  intervals: readonly TrackIntervalBody[]
}

interface Props {
  kind: string
  rows: TrackEditorRow[]
  onRowsChange: (rows: TrackEditorRow[]) => void
  verdict: TrackRowsVerdict
  /** Options per codelist field; ``null`` = free text. */
  options: (field: CodelistField) => CodeOption[] | null
  /** The borehole's other tracks for the reference pane (the edited one excluded). */
  references?: readonly ReferenceTrack[]
  /** The borehole's samples for the pane's "Samples (DOV)" block. */
  samples?: readonly SampleResponse[]
}

const INPUT =
  'h-7 px-1 rounded border text-xs bg-surface-card text-text-primary tabular-nums'

/** The i18n key of an issue code (codes come from the validator). */
export function issueKey(code: string): MessageKey {
  return `tracks.issue.${code}` as MessageKey
}

/**
 * Interval editor table.
 *
 * @returns The editor element.
 */
export default function TrackIntervalEditor({
  kind,
  rows,
  onRowsChange,
  verdict,
  options,
  references = [],
  samples = [],
}: Props): JSX.Element {
  const t = useT()
  const content = trackContent(kind)
  // The row that has the focus: the reference pane marks what overlaps it.
  const [activeRow, setActiveRow] = useState<number | null>(null)
  const paneRef = useRef<HTMLElement | null>(null)
  const active = activeRow !== null ? rows[activeRow] : undefined
  const activeTop = active?.top
  const activeBase = active?.base
  useEffect(() => {
    // Bring the first marked reference interval into view as the engineer moves
    // between rows (scrollIntoView is absent in jsdom, hence the guard).
    const first = paneRef.current?.querySelector<HTMLElement>('[data-overlaps="true"]')
    first?.scrollIntoView?.({ block: 'nearest' })
  }, [activeRow, activeTop, activeBase])
  const cell = (column: string, row: number) =>
    t('tracks.editor.cellLabel', { column, row: row + 1 })
  const hasError = (row: number, field: TrackRowIssue['field']) =>
    verdict.errors.some(e => e.row === row && e.field === field)

  const update = (index: number, patch: Partial<TrackEditorRow>) =>
    onRowsChange(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)))
  const addRow = () => onRowsChange([...rows, newRowAfter(rows)])
  const removeRow = (index: number) => onRowsChange(rows.filter((_, i) => i !== index))

  // Enter in any input of the LAST row appends a row that starts at its base.
  const onKeyDown = (index: number) => (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && index === rows.length - 1) {
      e.preventDefault()
      addRow()
    }
  }

  const depthInput = (index: number, field: 'top' | 'base', label: string) => (
    <input
      type="text"
      inputMode="decimal"
      aria-label={cell(label, index)}
      aria-invalid={hasError(index, field) || undefined}
      value={rows[index][field]}
      onChange={e => update(index, { [field]: e.target.value })}
      onKeyDown={onKeyDown(index)}
      className={[INPUT, 'w-16', hasError(index, field) ? 'border-red-500' : 'border-border-subtle'].join(' ')}
    />
  )

  const textOrPicker = (
    index: number,
    field: 'value' | 'description',
    codelist: CodelistField,
    label: string,
  ) => {
    const list = options(codelist)
    const r = rows[index]
    if (list !== null) {
      return (
        <CodelistPicker
          value={r[field]}
          options={list}
          ariaLabel={cell(label, index)}
          invalid={hasError(index, field)}
          onChange={token => update(index, { [field]: token })}
        />
      )
    }
    return (
      <input
        type="text"
        aria-label={cell(label, index)}
        aria-invalid={hasError(index, field) || undefined}
        value={r[field]}
        onChange={e => update(index, { [field]: e.target.value })}
        onKeyDown={onKeyDown(index)}
        className={[INPUT, 'w-72', hasError(index, field) ? 'border-red-500' : 'border-border-subtle'].join(' ')}
      />
    )
  }

  const codedCells = (index: number) => {
    const r = rows[index]
    const soils = options('mainSoil') ?? []
    const setSoil = (slot: number, token: string) => {
      const next = [...r.mainSoil]
      next[slot] = token
      update(index, { mainSoil: slot === 1 && token === '' ? next.slice(0, 1) : next })
    }
    return (
      <>
        <td className="px-1 py-0.5">
          <CodelistPicker
            value={r.mainSoil[0] ?? ''}
            options={soils}
            maxWidthClass="max-w-[10rem]"
            ariaLabel={cell(t('tracks.editor.mainSoil'), index)}
            invalid={hasError(index, 'mainSoil')}
            onChange={token => setSoil(0, token)}
          />
        </td>
        <td className="px-1 py-0.5">
          <CodelistPicker
            value={r.mainSoil[1] ?? ''}
            options={soils}
            maxWidthClass="max-w-[10rem]"
            emptyLabel={t('tracks.editor.none')}
            ariaLabel={cell(t('tracks.editor.mainSoil2'), index)}
            onChange={token => setSoil(1, token)}
          />
        </td>
        <td className="px-1 py-0.5">
          <CodelistPicker
            value={r.color}
            options={options('colour') ?? []}
            maxWidthClass="max-w-[10rem]"
            emptyLabel={t('tracks.editor.none')}
            ariaLabel={cell(t('tracks.editor.colour'), index)}
            invalid={hasError(index, 'color')}
            onChange={token => update(index, { color: token })}
          />
        </td>
        <td className="px-1 py-0.5">{admixtureCell(index)}</td>
      </>
    )
  }

  const admixtureCell = (index: number) => {
    const r = rows[index]
    const amounts = options('admixtureAmount') ?? []
    const unspecified = amounts.find(o => o.code === '')?.label
    const setAdm = (a: number, patch: Partial<TrackEditorRow['admixtures'][number]>) =>
      update(index, { admixtures: r.admixtures.map((x, i) => (i === a ? { ...x, ...patch } : x)) })
    return (
      <div className="flex flex-col gap-0.5">
        {r.admixtures.map((adm, a) => (
          <div key={a} className="flex items-center gap-1">
            <CodelistPicker
              value={adm.soil_code}
              options={options('admixtureSoil') ?? []}
              maxWidthClass="max-w-[11rem]"
              ariaLabel={cell(`${t('tracks.editor.admixtures')} ${a + 1}`, index)}
              invalid={hasError(index, 'admixtures')}
              onChange={token => setAdm(a, { soil_code: token })}
            />
            <CodelistPicker
              value={adm.amount}
              options={amounts}
              maxWidthClass="max-w-[8rem]"
              emptyLabel={unspecified}
              ariaLabel={cell(`${t('tracks.editor.amount')} ${a + 1}`, index)}
              onChange={token => setAdm(a, { amount: token })}
            />
            <label className="flex items-center gap-0.5 text-xs text-text-secondary">
              <input
                type="checkbox"
                checked={adm.locally}
                onChange={e => setAdm(a, { locally: e.target.checked })}
              />
              {t('tracks.editor.locally')}
            </label>
            <button
              type="button"
              aria-label={t('tracks.editor.removeAdmixture')}
              title={t('tracks.editor.removeAdmixture')}
              onClick={() => update(index, { admixtures: r.admixtures.filter((_, i) => i !== a) })}
              className="text-text-muted hover:text-red-500"
            >
              <X size={11} />
            </button>
          </div>
        ))}
        {r.admixtures.length < MAX_ADMIXTURES_PER_INTERVAL ? (
          <button
            type="button"
            onClick={() =>
              update(index, { admixtures: [...r.admixtures, { soil_code: '', amount: '', locally: false }] })
            }
            className="self-start text-xs text-blue-600 dark:text-blue-400 hover:underline"
          >
            + {t('tracks.editor.addAdmixture')}
          </button>
        ) : (
          <span className="text-[10px] text-text-muted">
            {t('tracks.editor.admixtureCap', { n: MAX_ADMIXTURES_PER_INTERVAL })}
          </span>
        )}
      </div>
    )
  }

  const valueLabel =
    content === 'value'
      ? t('tracks.editor.value')
      : kind === 'formal_stratigraphy' && options('description') !== null
        ? t('tracks.editor.unit')
        : t('tracks.editor.description')

  const locally = t('tracks.editor.locally')
  const referencePane = (
    <aside
      ref={paneRef}
      aria-label={t('tracks.reference.title')}
      // Wide dialog: a sticky column as tall as the visible dialog body (the
      // body is the scroller, see BoreholeTracksDialog). Narrow dialog: a plain
      // block below the editor that scrolls with the body.
      className={[
        'min-w-0 rounded border border-border-subtle p-3 text-xs',
        'min-[1150px]:sticky min-[1150px]:top-0 min-[1150px]:h-[calc(90vh-9.5rem)] min-[1150px]:overflow-auto',
      ].join(' ')}
    >
      <h3 className="mb-0.5 text-sm font-semibold text-text-primary">{t('tracks.reference.title')}</h3>
      <p className="mb-2 text-[10px] text-text-muted">{t('tracks.reference.hint')}</p>
      <SampleReferenceBlock samples={samples} active={active} />
      {references.length === 0 ? (
        <p className="italic text-text-muted">{t('tracks.reference.empty')}</p>
      ) : (
        references.map(ref => (
          <section key={ref.trackId} className="mb-2">
            <h4 className="text-xs font-semibold text-text-secondary">{ref.label}</h4>
            <ul>
              {[...ref.intervals]
                .sort((a, b) => a.top_m - b.top_m || a.base_m - b.base_m)
                .map((interval, i) => {
                  const overlaps = active !== undefined && referenceOverlapsRow(interval, active)
                  return (
                    <li
                      key={i}
                      data-overlaps={overlaps ? 'true' : 'false'}
                      className={[
                        'flex gap-2 rounded px-1',
                        overlaps
                          ? 'bg-amber-100 text-text-primary dark:bg-amber-900/40'
                          : 'text-text-secondary',
                      ].join(' ')}
                    >
                      <span className="shrink-0 tabular-nums text-text-muted">
                        {interval.top_m}–{interval.base_m}
                      </span>
                      <span>{referenceIntervalText(interval, locally)}</span>
                    </li>
                  )
                })}
            </ul>
          </section>
        ))
      )}
    </aside>
  )

  return (
    // Two grid columns that never overlap: the rows (their table scrolls
    // sideways inside its own column when it is wider) and the pane, at least
    // 24rem (30rem on a wide window; a fixed width, because a track with a
    // max takes its max before the rows get any leftover). The dialog takes
    // 96vw in editor mode, so 1150 px of window is ~1100 px of dialog: below
    // that the coded grid and the pane do not both fit, and the pane stacks
    // BELOW the editor (source order) instead of
    // covering the admixture column. Literal class names: the Tailwind JIT
    // scanner only sees whole strings.
    <div className="grid grid-cols-1 items-start gap-4 min-[1150px]:grid-cols-[minmax(0,1fr)_24rem] min-[1800px]:grid-cols-[minmax(0,1fr)_30rem]">
    <div className="flex min-w-0 flex-col gap-2">
      <div className="overflow-x-auto">
        <table className="text-xs border-collapse">
          <thead>
            <tr className="text-left text-text-muted">
              <th className="px-1 font-normal">#</th>
              <th className="px-1 font-normal">{t('tracks.editor.top')}</th>
              <th className="px-1 font-normal">{t('tracks.editor.base')}</th>
              {content === 'coded' ? (
                <>
                  <th className="px-1 font-normal">{t('tracks.editor.mainSoil')}</th>
                  <th className="px-1 font-normal">{t('tracks.editor.mainSoil2')}</th>
                  <th className="px-1 font-normal">{t('tracks.editor.colour')}</th>
                  <th className="px-1 font-normal">{t('tracks.editor.admixtures')}</th>
                </>
              ) : (
                <th className="px-1 font-normal">{valueLabel}</th>
              )}
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, index) => (
              <tr
                key={r.key}
                className={['align-top', index === activeRow ? 'bg-surface-sunken' : ''].join(' ')}
                onFocus={() => setActiveRow(index)}
              >
                <td className="px-1 py-0.5 text-text-muted tabular-nums">{index + 1}</td>
                <td className="px-1 py-0.5">{depthInput(index, 'top', t('tracks.editor.top'))}</td>
                <td className="px-1 py-0.5">{depthInput(index, 'base', t('tracks.editor.base'))}</td>
                {content === 'coded' ? (
                  codedCells(index)
                ) : (
                  <td className="px-1 py-0.5">
                    {content === 'value'
                      ? textOrPicker(index, 'value', 'value', valueLabel)
                      : textOrPicker(index, 'description', 'description', valueLabel)}
                  </td>
                )}
                <td className="px-1 py-0.5">
                  <button
                    type="button"
                    aria-label={t('tracks.editor.removeRow', { row: index + 1 })}
                    title={t('tracks.editor.removeRow', { row: index + 1 })}
                    onClick={() => removeRow(index)}
                    className="text-text-muted hover:text-red-500"
                  >
                    <Trash2 size={12} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={addRow}
          className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline"
        >
          <Plus size={11} />
          {t('tracks.editor.addRow')}
        </button>
        <span className="text-[10px] text-text-muted">{t('tracks.editor.rowHint')}</span>
      </div>
      {(verdict.errors.length > 0 || verdict.warnings.length > 0) && (
        <ul className="text-xs flex flex-col gap-0.5" aria-live="polite">
          {verdict.errors.map((e, i) => (
            <li key={`e${i}`} className="text-red-600 dark:text-red-400">
              {t(issueKey(e.code), e.params)}
            </li>
          ))}
          {verdict.warnings.map((w, i) => (
            <li key={`w${i}`} className="text-amber-600 dark:text-amber-400">
              {t(issueKey(w.code), w.params)}
            </li>
          ))}
        </ul>
      )}
    </div>
    {referencePane}
    </div>
  )
}
