// Lithology inspector — "Boreholes in model" scope roster (debt #65, the
// exclude gesture).
//
// The litho model carries its own ``excluded_borehole_ids``. The shipped half
// of #65 surfaced that list read-only with an "Include again" undo
// (LithoExcludedBoreholes); this is the missing counterpart — the in-UI gesture
// to NEWLY EXCLUDE a borehole from the litho build. It mirrors the geological
// stage's "Boreholes in model" checkbox roster (GeologyInspector): a
// collapsible list of every borehole with a checkbox — checked = in the model,
// unchecked = excluded from the litho build.
//
// Toggling is a REVERSIBLE, project-local action (docs/ux.md), so it fires
// immediately with NO confirmation dialog; the parent's shared toggle registers
// the Ctrl+Z undo and a confirmation toast, and re-checking (or the
// LithoExcludedBoreholes "Include again" list) is the undo path. Presentational
// only: the parent owns the model and the toggle handler.

import { useState } from 'react'
import { ChevronDown, ChevronRight, Drill } from 'lucide-react'

import type { Translator } from '../../../i18n/translate'

interface LithoBoreholesInModelProps {
  /** The boreholes the roster lists — the project's visible boreholes. */
  boreholes: readonly { id: string; name: string }[]
  /** Borehole ids excluded from the active litho model. */
  excludedBoreholeIds: readonly string[]
  /**
   * Called when a borehole's checkbox is toggled. ``included`` is the checkbox's
   * next state: ``true`` re-includes the borehole, ``false`` excludes it.
   */
  onToggle: (boreholeId: string, included: boolean) => void
  t: Translator
}

/**
 * Renders the "Boreholes in model" scope roster for the active litho model —
 * a collapsible checkbox list mirroring the geological inspector's roster.
 *
 * Unchecking a borehole excludes it from the litho build; re-checking includes
 * it again. Both directions are reversible and fire immediately.
 *
 * Parameters
 * ----------
 * boreholes
 *     The project's visible boreholes (id + name).
 * excludedBoreholeIds
 *     The active litho model's ``excluded_borehole_ids``.
 * onToggle
 *     Callback fired with the borehole id and its next checked state.
 * t
 *     The active-language translator.
 *
 * Returns
 * -------
 * JSX.Element | null
 *     The roster section, or ``null`` when the project has no boreholes.
 */
export default function LithoBoreholesInModel({
  boreholes,
  excludedBoreholeIds,
  onToggle,
  t,
}: LithoBoreholesInModelProps): JSX.Element | null {
  // Collapsed by default — matches the geological "Boreholes in model" roster
  // so the panel stays tidy; the excluded-boreholes callout below surfaces the
  // exception even while this stays folded.
  const [open, setOpen] = useState(false)

  // Nothing to scope when the project has no boreholes.
  if (boreholes.length === 0) return null

  const excludedSet = new Set(excludedBoreholeIds)
  const includedCount = boreholes.length - excludedSet.size

  return (
    <div
      data-testid="litho-boreholes-in-model"
      className="border-t border-border-subtle pt-3 mt-1"
    >
      <button
        type="button"
        data-testid="litho-boreholes-in-model-toggle"
        onClick={() => setOpen(prev => !prev)}
        aria-expanded={open}
        className="flex items-center gap-1.5 w-full text-left text-text-secondary hover:text-text-primary"
        title={t('litho.showBoreholeScopes')}
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <Drill size={12} className="text-text-muted" aria-hidden="true" />
        <span className="text-xs font-medium">{t('litho.boreholesInModel')}</span>
        <span className="text-[10px] text-text-muted tabular-nums ml-auto">
          {includedCount}/{boreholes.length}
        </span>
      </button>
      {open && (
        <>
          <p className="text-[11px] leading-snug text-text-muted mt-1">
            {t('litho.boreholesInModelHint')}
          </p>
          <ul
            className="flex flex-col mt-1 max-h-64 overflow-y-auto pr-1"
            aria-label={t('litho.boreholesInModel')}
          >
            {boreholes.map(b => {
              const included = !excludedSet.has(b.id)
              return (
                <li
                  key={b.id}
                  className={[
                    'flex items-center gap-2 px-1 py-1 rounded text-xs transition-colors',
                    included
                      ? 'text-text-secondary hover:bg-surface-card'
                      : 'text-text-muted hover:bg-surface-card',
                  ].join(' ')}
                >
                  <input
                    type="checkbox"
                    data-testid={`litho-borehole-in-model-${b.id}`}
                    checked={included}
                    onChange={e => onToggle(b.id, e.target.checked)}
                    className="cursor-pointer shrink-0"
                    aria-label={t('litho.boreholeInModel', { name: b.name })}
                  />
                  <span
                    className={['truncate flex-1', included ? '' : 'line-through'].join(' ')}
                    title={b.name}
                  >
                    {b.name}
                  </span>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </div>
  )
}
