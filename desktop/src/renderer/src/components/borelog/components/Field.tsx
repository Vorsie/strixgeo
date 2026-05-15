import type { ReactElement } from 'react'

/**
 * Header strip field — small label-over-value pair used by
 * ``BoreholeHeader`` for boring name / coordinates / elevation /
 * depth / executor / etc.
 *
 * Two visual modifiers:
 *
 *   * ``bold`` — emphasises the borehole name (the row's primary
 *     identifier).
 *   * ``warn`` — renders the value in amber italic; used for
 *     missing-elevation flag ("— missing —") so the user sees
 *     immediately that a real fix is needed before the borelog can
 *     render an absolute-level axis.
 *
 * No state, no events — pure presentational chrome.
 */
export function Field({
  label,
  value,
  bold,
  warn,
}: {
  label: string
  value: string
  bold?: boolean
  warn?: boolean
}): ReactElement {
  return (
    <div className="flex flex-col leading-tight">
      <span className="text-[9px] uppercase tracking-wide text-gray-400 dark:text-slate-500">{label}</span>
      <span
        className={[
          'text-gray-700 dark:text-slate-200',
          bold ? 'font-semibold' : '',
          warn ? 'text-amber-600 dark:text-amber-400 italic' : '',
        ].join(' ')}
      >
        {value}
      </span>
    </div>
  )
}
