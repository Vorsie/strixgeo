// Geology inspector — "Boreholes in model" scope roster.
//
// Extracted verbatim from the inline JSX of GeologyInspector.tsx (debt #201
// god-component decomposition round). Presentational only: the parent owns the
// active model and the toggle handler. The collapse state (``scopeOpen``) moves
// here — it is a component-local concern, so it is the block this component owns
// (the LithoSolidLegend / LithoBoreholesInModel precedent).
//
// Toggling a checkbox PATCHes the model's ``excluded_borehole_ids``. Excluded
// boreholes still render lithology on the section but do not anchor contacts.

import { useState } from 'react'
import { ChevronDown, ChevronRight, Drill } from 'lucide-react'

import type { Translator } from '../../../i18n/translate'

interface GeologyBoreholesInModelProps {
  /** The boreholes the roster lists — the project's visible boreholes. */
  boreholes: readonly { id: string; name: string }[]
  /** Borehole ids excluded from the active geological model. */
  excludedBoreholeIds: readonly string[]
  /**
   * Called when a borehole's checkbox is toggled. ``included`` is the checkbox's
   * next state: ``true`` re-includes the borehole, ``false`` excludes it.
   */
  onToggle: (boreholeId: string, included: boolean) => void
  t: Translator
}

/**
 * Renders the collapsible "Boreholes in model" scope roster.
 *
 * Unchecking a borehole excludes it from the geological model; re-checking
 * includes it again. Renders nothing when the project has no boreholes.
 *
 * Parameters
 * ----------
 * boreholes
 *     The project's visible boreholes (id + name).
 * excludedBoreholeIds
 *     The active geological model's ``excluded_borehole_ids``.
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
export default function GeologyBoreholesInModel({
  boreholes,
  excludedBoreholeIds,
  onToggle,
  t,
}: GeologyBoreholesInModelProps): JSX.Element | null {
  // Borehole scope sub-section collapse state.
  const [scopeOpen, setScopeOpen] = useState(false)

  if (boreholes.length === 0) return null

  const excludedSet = new Set(excludedBoreholeIds)

  return (
    <div className="border-t border-border-subtle pt-3 mt-1" data-testid="geology-boreholes-in-model">
      <button
        type="button"
        onClick={() => setScopeOpen(prev => !prev)}
        className="flex items-center gap-1.5 w-full text-left text-text-secondary hover:text-text-primary"
        title={t('geology.showBoreholeScopes')}
      >
        {scopeOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <Drill size={12} className="text-text-muted" />
        <span className="text-xs font-medium">{t('geology.boreholesInModel')}</span>
        <span className="text-[10px] text-text-muted tabular-nums ml-auto">
          {boreholes.length - excludedSet.size}/{boreholes.length}
        </span>
      </button>
      {scopeOpen && (
        <ul className="flex flex-col mt-2 max-h-64 overflow-y-auto pr-1">
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
                  checked={included}
                  onChange={e => onToggle(b.id, e.target.checked)}
                  className="cursor-pointer shrink-0"
                  aria-label={t('geology.boreholeInModel', { name: b.name })}
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
      )}
    </div>
  )
}
