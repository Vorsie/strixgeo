/**
 * The Ctrl+F find bar for a cross-section — jump to a column by name.
 *
 * Owner, 2026-08-17: *"on crosssections i want a ctrl+f feature so i can go
 * easily to a column header like s8 or so for example"*.
 *
 * Presentational: `SectionPanel` opens it on Ctrl+F, hands it the placed
 * columns, and executes the jump. The bar owns only the query and which match
 * is current. Keyboard contract mirrors every find bar the engineer already
 * knows: Enter = next match (wraps), Shift+Enter = previous, Esc = close.
 * The FIRST match jumps immediately as the query narrows, so typing ``s8`` is
 * usually the whole interaction — no Enter needed.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import { matchColumns, type ColumnFindEntry } from './columnFind'
import { useT } from '../../i18n/translate'

interface Props {
  /** Every placed column on the open section, any order. */
  columns: readonly ColumnFindEntry[]
  /** Execute a jump — pan the viewport so this column is centred. */
  onJump: (column: ColumnFindEntry) => void
  /** Close the bar (Esc or the ✕). Focus handling is the caller's. */
  onClose: () => void
}

export default function ColumnFindBar({ columns, onJump, onClose }: Props) {
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const t = useT()

  const matches = matchColumns(columns, query)
  // The current index survives re-renders but must never point past a
  // narrowed match list.
  const current = matches.length === 0 ? 0 : Math.min(index, matches.length - 1)

  // Grab the keyboard on mount — the bar exists to be typed into.
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const jumpTo = useCallback(
    (i: number) => {
      if (matches.length === 0) return
      const wrapped = ((i % matches.length) + matches.length) % matches.length
      setIndex(wrapped)
      onJump(matches[wrapped])
    },
    [matches, onJump],
  )

  return (
    <div
      className="pointer-events-auto absolute right-3 top-3 z-30 flex items-center gap-2 rounded-md border border-slate-300 bg-white/95 px-2 py-1.5 shadow-md dark:border-slate-600 dark:bg-slate-800/95"
      role="search"
      aria-label={t('sections.findColumn')}
    >
      <input
        ref={inputRef}
        value={query}
        placeholder={t('sections.findColumnPlaceholder')}
        aria-label={t('sections.columnName')}
        className="w-40 bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400 dark:text-slate-100"
        onChange={e => {
          const next = e.target.value
          setQuery(next)
          setIndex(0)
          // Jump as the query narrows — typing the name IS the gesture; a
          // separate confirm press would just be friction on the common path.
          const fresh = matchColumns(columns, next)
          if (fresh.length > 0) onJump(fresh[0])
        }}
        onKeyDown={e => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            onClose()
          } else if (e.key === 'Enter') {
            e.preventDefault()
            jumpTo(current + (e.shiftKey ? -1 : 1))
          }
        }}
      />
      <span
        className="min-w-10 select-none text-right text-xs tabular-nums text-slate-500 dark:text-slate-400"
        aria-live="polite"
      >
        {query.trim() === ''
          ? ''
          : matches.length === 0
            ? t('sections.findNoneFound')
            : `${current + 1}/${matches.length}`}
      </span>
      <button
        type="button"
        aria-label={t('sections.closeFind')}
        className="rounded px-1 text-slate-500 hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-slate-200"
        onClick={onClose}
      >
        ✕
      </button>
    </div>
  )
}
