// Lithology inspector — confidence-fade toggle switch.
//
// Extracted verbatim from the inline JSX of LithologyInspector.tsx (debt #201
// god-component decomposition round). Presentational only: the parent owns the
// project-wide ``view_state.show_confidence_fade`` state and the setter.
//
// The litho 3D pane (LithologyCanvas → Geology3DViewer) already honors
// ``showConfidenceFade``, but the only control used to live in GeologyInspector
// — so a litho-only user could not flip it without switching stages. It
// reads/writes the SAME project-wide value, so it stays in sync with the
// geology toggle.

import type { Translator } from '../../../i18n/translate'

interface LithoConfidenceFadeToggleProps {
  /** Current project-wide confidence-fade flag. */
  showConfidenceFade: boolean
  /** Called with the next flag value when the switch is clicked. */
  onToggle: (next: boolean) => void
  t: Translator
}

/**
 * Renders the confidence-fade switch — a role="switch" toggle mirroring the
 * geology inspector's control, wired to the same project-wide state.
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
export default function LithoConfidenceFadeToggle({
  showConfidenceFade,
  onToggle,
  t,
}: LithoConfidenceFadeToggleProps): JSX.Element {
  return (
    <div
      className="flex items-center justify-between gap-2 text-[11px] text-text-secondary border-t border-border-subtle pt-2"
      title={t('litho.confidenceFadeHint')}
    >
      <span>{t('geology.showConfidenceFade')}</span>
      <button
        type="button"
        role="switch"
        aria-checked={showConfidenceFade}
        onClick={() => void onToggle(!showConfidenceFade)}
        data-testid="litho-confidence-fade-toggle"
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
