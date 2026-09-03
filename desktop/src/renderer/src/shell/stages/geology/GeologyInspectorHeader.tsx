// Geology inspector — header (formation count + active stratigraphy label).
//
// Extracted verbatim from the inline JSX of GeologyInspector.tsx (debt #201
// god-component decomposition round). Presentational only: the parent owns the
// formation count and the active-model name.
//
// (#55: the lithostratigraphic model picker moved to the dedicated Lithology
// peer stage — a stage inspector is not an editing surface — so only the
// geological stratigraphy label remains here.)

import { Layers } from 'lucide-react'

import type { Translator } from '../../../i18n/translate'

interface GeologyInspectorHeaderProps {
  /** Number of visible formations (shown next to the header label). */
  formationCount: number
  /** Active geological model name, or ``null`` when none is active. */
  activeModelName: string | null
  t: Translator
}

/**
 * Renders the geology inspector header: the "Formations" label + count, and
 * the active-stratigraphy sub-label when a model is active.
 *
 * Parameters
 * ----------
 * formationCount
 *     Number of visible formations.
 * activeModelName
 *     Active geological model name, or ``null``.
 * t
 *     The active-language translator.
 *
 * Returns
 * -------
 * JSX.Element
 *     The header element.
 */
export default function GeologyInspectorHeader({
  formationCount,
  activeModelName,
  t,
}: GeologyInspectorHeaderProps): JSX.Element {
  return (
    <div className="flex flex-col gap-0.5 text-text-secondary min-w-0">
      <div className="flex items-center gap-2">
        <Layers size={14} className="text-status-amber" />
        <span className="text-xs font-medium">{t('geology.formations')}</span>
        <span className="text-[10px] text-text-muted tabular-nums">{formationCount}</span>
      </div>
      {activeModelName && (
        <div
          className="text-[10px] text-text-muted pl-5 truncate"
          title={t('geology.activeStratigraphy')}
        >
          {t('geology.stratigraphyLabel')}{' '}
          <span className="text-text-secondary">· {activeModelName}</span>
        </div>
      )}
    </div>
  )
}
