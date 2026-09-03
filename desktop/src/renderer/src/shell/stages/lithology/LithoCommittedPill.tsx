// Lithology inspector — committed-contacts pill (debt #94).
//
// Extracted verbatim from the inline JSX of LithologyInspector.tsx (debt #201
// god-component decomposition round). Presentational only: it renders the
// count summary + the Clear affordance; the parent owns the visibility gate
// (it mounts this only when there are contacts OR orphan formations to clear),
// the ``wiping`` flag, and the confirm-dialog open handler.

import { Trash2 } from 'lucide-react'

import type { FormationContactResponse } from '../../../api/client'
import type { Translator } from '../../../i18n/translate'

interface LithoCommittedPillProps {
  /** All contacts in the active litho model — drives the count summary. */
  lithoContacts: readonly FormationContactResponse[]
  /** True while a clear is in flight — disables the Clear button. */
  wiping: boolean
  /** Opens the clear-model confirm dialog (the clear itself is irreversible,
   *  so it is never triggered directly here). */
  onWipe: () => void
  t: Translator
}

/**
 * Renders the committed-contacts pill: a count summary of the active litho
 * model's contacts + units and a Clear affordance that opens the confirm
 * dialog.
 *
 * Surfaces the persistent state so the user understands why there are
 * polylines on section before they have clicked Suggest. The parent mounts
 * this whenever litho contacts exist OR litho formations exist (the "orphan
 * units" broken state the old contact-only wipe left behind — the user needs
 * an affordance to recover even when contacts = 0).
 *
 * Parameters
 * ----------
 * lithoContacts
 *     Contacts in the active litho model for the count summary.
 * wiping
 *     True while a clear is in flight.
 * onWipe
 *     Opens the clear-model confirm dialog.
 * t
 *     The active-language translator.
 *
 * Returns
 * -------
 * JSX.Element
 *     The committed-contacts pill.
 */
export default function LithoCommittedPill({
  lithoContacts,
  wiping,
  onWipe,
  t,
}: LithoCommittedPillProps): JSX.Element {
  return (
    <div
      className="flex items-center justify-between gap-2 rounded px-2 py-1.5 bg-surface-sunken border border-border-subtle"
      data-testid="litho-committed-pill"
    >
      <span className="text-[11px] leading-snug text-text-secondary">
        {/* Debt #147 — "unit" count is now distinct
            ``formation_id`` over THIS model's contacts (the
            units that actually have a placed contact here),
            not the project-scoped ``lithoFormations`` count
            (which includes orphan/shared vocabulary kept by
            the delete cascade and read as "this model has 30
            units" even on a freshly-created empty model).
            The pill still surfaces when either count is non-
            zero so the Clear button stays reachable for the
            orphan-formation recovery case. */}
        {t('litho.pillCounts', {
          c: lithoContacts.length,
          cw: t(
            lithoContacts.length === 1
              ? 'litho.contactWordOne'
              : 'litho.contactWordMany',
          ),
          u: new Set(lithoContacts.map(c => c.formation_id)).size,
          uw: t(
            new Set(lithoContacts.map(c => c.formation_id)).size === 1
              ? 'litho.unitWordOne'
              : 'litho.unitWordMany',
          ),
        })}
      </span>
      <button
        type="button"
        onClick={onWipe}
        disabled={wiping}
        className="flex items-center gap-1 text-[11px] text-text-secondary hover:text-red-600 dark:hover:text-red-400 disabled:opacity-40 transition-colors flex-shrink-0"
        title={t('litho.clearModel')}
        data-testid="wipe-litho-contacts-btn"
      >
        <Trash2 size={11} aria-hidden="true" />
        {wiping ? t('litho.clearing') : t('litho.clearShort')}
      </button>
    </div>
  )
}
