// Lithology inspector — excluded-boreholes list (debt #65).
//
// The litho model carries its own ``excluded_borehole_ids`` (set by the backend
// during the litho build when a borehole disagrees with its corridor). This
// surfaces that list so the engineer can bring a borehole back into the build
// without a backend edit. Presentational only: the parent owns the model and
// the toggle handler.
//
// The whole section is the EXCLUSION set, so it renders nothing when nothing is
// excluded — an empty box would read as a permanent feature rather than the
// exception it is. Each row's "Include again" is a reversible action that fires
// immediately (docs/ux.md); its undo path is the parent's Ctrl+Z stack + a
// confirmation toast.

import { Drill, RotateCcw } from 'lucide-react'

import type { Translator } from '../../../i18n/translate'

interface LithoExcludedBoreholesProps {
  /** Borehole ids excluded from the active litho model, in the model's order. */
  excludedBoreholeIds: readonly string[]
  /** Resolves a borehole id to its display name; missing ids fall back to a
   *  generic label so a since-removed borehole is still recoverable. */
  boreholeNameById: ReadonlyMap<string, string>
  /** Called with the borehole id when its "Include again" is clicked. */
  onIncludeAgain: (boreholeId: string) => void
  t: Translator
}

/**
 * Renders the boreholes excluded from the active litho model, each with an
 * "Include again" control.
 *
 * Parameters
 * ----------
 * excludedBoreholeIds
 *     The active litho model's ``excluded_borehole_ids``.
 * boreholeNameById
 *     Id → display-name lookup for the visible boreholes.
 * onIncludeAgain
 *     Callback fired with the borehole id when its Include-again is clicked.
 * t
 *     The active-language translator.
 *
 * Returns
 * -------
 * JSX.Element | null
 *     The excluded-boreholes section, or ``null`` when nothing is excluded.
 */
export default function LithoExcludedBoreholes({
  excludedBoreholeIds,
  boreholeNameById,
  onIncludeAgain,
  t,
}: LithoExcludedBoreholesProps): JSX.Element | null {
  if (excludedBoreholeIds.length === 0) return null

  return (
    <div
      data-testid="litho-excluded-boreholes"
      className="border-t border-border-subtle pt-3 mt-1 flex flex-col gap-1"
    >
      <div className="flex items-center gap-1.5 text-text-secondary">
        <Drill size={12} className="text-text-muted" aria-hidden="true" />
        <span className="text-xs font-medium">{t('litho.excludedBoreholesHeading')}</span>
        <span className="text-[10px] text-text-muted tabular-nums ml-auto">
          {excludedBoreholeIds.length}
        </span>
      </div>
      <p className="text-[11px] leading-snug text-text-muted">
        {t('litho.excludedBoreholesHint')}
      </p>
      <ul
        className="flex flex-col mt-1 max-h-64 overflow-y-auto pr-1"
        aria-label={t('litho.excludedBoreholesHeading')}
      >
        {excludedBoreholeIds.map(id => {
          const name = boreholeNameById.get(id) ?? t('litho.excludedBoreholeUnknown')
          const label = t('litho.includeBoreholeAgainAria', { name })
          return (
            <li
              key={id}
              data-testid={`litho-excluded-borehole-row-${id}`}
              className="flex items-center gap-2 px-1 py-1 rounded text-xs text-text-muted hover:bg-surface-card"
            >
              <span className="truncate flex-1" title={name}>
                {name}
              </span>
              <button
                type="button"
                data-testid={`litho-include-borehole-${id}`}
                onClick={() => onIncludeAgain(id)}
                className="flex items-center gap-1 text-[11px] text-text-secondary hover:text-text-primary transition-colors flex-shrink-0 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                title={label}
                aria-label={label}
              >
                <RotateCcw size={11} aria-hidden="true" />
                {t('litho.includeBoreholeAgain')}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
