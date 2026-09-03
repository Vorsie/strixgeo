// Geology inspector — confidence-fade toggle switch (debt #94 follow-up).
//
// Extracted verbatim from the inline JSX of GeologyInspector.tsx (debt #201
// god-component decomposition round). Presentational only: the parent owns the
// project-wide ``view_state.show_confidence_fade`` state and the setter.
//
// Off → low-confidence triangles / segments render at full alpha (uniform
// colour). On → faded so the engineer sees where the TIN is extrapolating away
// from data.
//
// NOTE: a near-identical control ships in the Lithology inspector
// (LithoConfidenceFadeToggle) reading/writing the SAME project-wide flag. The
// two differ only in ``data-testid`` and the hint key, so they are kept as
// sibling copies rather than a shared parameterised component — folding them
// would touch the lithology folder (out of scope for this round).

import type { Translator } from '../../../i18n/translate'

interface GeologyConfidenceFadeToggleProps {
  /** Current project-wide confidence-fade flag. */
  showConfidenceFade: boolean
  /** Called with the next flag value when the switch is clicked. */
  onToggle: (next: boolean) => void
  t: Translator
}

/**
 * Renders the confidence-fade switch — a role="switch" toggle wired to the
 * project-wide state.
 *
 * Parameters
 * ----------
 * showConfidenceFade
 *     Current flag value (drives ``aria-checked`` + the knob position).
 * onToggle
 *     Called with ``!showConfidenceFade`` when the switch is clicked.
 * t
 *     The active-language translator.
 *
 * Returns
 * -------
 * JSX.Element
 *     The confidence-fade toggle row.
 */
export default function GeologyConfidenceFadeToggle({
  showConfidenceFade,
  onToggle,
  t,
}: GeologyConfidenceFadeToggleProps): JSX.Element {
  return (
    <div
      className="flex items-center justify-between gap-2 text-[11px] text-text-secondary border-t border-border-subtle pt-2"
      title={t('geology.confidenceFadeHint')}
    >
      <span>{t('geology.showConfidenceFade')}</span>
      <button
        type="button"
        role="switch"
        aria-checked={showConfidenceFade}
        onClick={() => onToggle(!showConfidenceFade)}
        data-testid="confidence-fade-toggle"
        className={[
          'inline-flex h-4 w-7 items-center rounded-full transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
          showConfidenceFade ? 'bg-accent' : 'bg-surface-page border border-border-default',
        ].join(' ')}
      >
        <span
          className={[
            'inline-block h-3 w-3 transform rounded-full bg-white transition-transform',
            showConfidenceFade ? 'translate-x-3.5' : 'translate-x-0.5',
          ].join(' ')}
        />
      </button>
    </div>
  )
}
