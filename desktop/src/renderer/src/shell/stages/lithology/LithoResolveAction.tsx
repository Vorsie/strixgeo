// Lithology inspector — "Resolve instances" action row.
//
// Extracted verbatim from the inline JSX of LithologyInspector.tsx (debt #201
// god-component decomposition round). Presentational only: the parent owns the
// resolve handler and the busy flag.
//
// Instance ordinals are resolved server-side on accept (per-body, on the
// section), so this button is a roster refresh, not a re-numbering trigger. It
// is always visible when a litho model is active so the engineer can explicitly
// re-run the resolver after drawing edges on the section canvas.

import { RefreshCw } from 'lucide-react'

import type { Translator } from '../../../i18n/translate'

interface LithoResolveActionProps {
  /** True while the resolve/refresh call is in flight — spins the icon and
   *  disables the button. */
  resolving: boolean
  /** Fired when the user clicks the action. */
  onResolve: () => void
  t: Translator
}

/**
 * Renders the "Resolve instances" action row — a labelled refresh button with
 * a quiet busy-spinner during the async call.
 *
 * Parameters
 * ----------
 * resolving
 *     True while the refresh is in flight.
 * onResolve
 *     Fired when the user clicks the action.
 * t
 *     The active-language translator.
 *
 * Returns
 * -------
 * JSX.Element
 *     The resolve-instances action row.
 */
export default function LithoResolveAction({
  resolving,
  onResolve,
  t,
}: LithoResolveActionProps): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[10px] text-text-muted uppercase tracking-wide font-semibold">
        {t('litho.instances')}
      </span>
      <button
        type="button"
        onClick={() => void onResolve()}
        disabled={resolving}
        className="flex items-center gap-1 text-[11px] text-text-secondary hover:text-text-primary disabled:opacity-40 transition-colors"
        title={t('litho.renumberBodies')}
        data-testid="resolve-instances-btn"
      >
        <RefreshCw
          size={11}
          className={resolving ? 'animate-spin' : ''}
          aria-hidden="true"
        />
        {resolving ? t('litho.resolving') : t('litho.resolveInstances')}
      </button>
    </div>
  )
}
