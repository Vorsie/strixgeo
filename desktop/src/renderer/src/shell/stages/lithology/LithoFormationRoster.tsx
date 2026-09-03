// Lithology inspector — flat roster of litho units (LithoFormationRoster) and
// its per-row component (LithoUnitRow).
//
// Extracted verbatim from LithologyInspector.tsx (debt #201 god-component
// decomposition round). Presentational only: the parent owns the model, the
// contacts, the lens counts, and the parent-review handler. LithoUnitRow lives
// at module scope (NOT nested inside LithoFormationRoster) so it keeps a stable
// identity across parent renders — an inner component re-identifies on every
// render and React unmount/remounts it (review C-1).

import { Circle } from 'lucide-react'

import type {
  FormationContactResponse,
  GeologicalFormationResponse,
} from '../../../api/client'
import { lithoDisplayName } from '../../../utils/lithoLabels'
import type { Translator } from '../../../i18n/translate'

// ---------------------------------------------------------------------------
// LithoUnitRow — one litho-unit row (module scope, NOT defined inside
// LithoFormationRoster: an inner component re-identifies every parent
// render and React unmount/remounts it — review C-1).
// ---------------------------------------------------------------------------

interface LithoUnitRowProps {
  f: GeologicalFormationResponse
  lithoContacts: readonly FormationContactResponse[]
  /** #101 Slice 6: number of lenses whose parent_formation_id === f.id. */
  lensCount: number
  /** Debt #87: opens the confirm-parent dialog for an extrapolated or
   *  orphan unit. Click target is the amber dot on the left of the row. */
  onReviewParent: (formation: GeologicalFormationResponse) => void
  t: Translator
}

function LithoUnitRow({
  f,
  lithoContacts,
  lensCount,
  onReviewParent,
  t,
}: LithoUnitRowProps): JSX.Element {
  const contactCount = lithoContacts.filter(c => c.formation_id === f.id).length
  // Debt #87: amber dot when the parent needs engineer review.
  // Either the AcceptLitho path stamped parent_extrapolated=true, or the
  // unit is orphan (no parent at all — usually grouped under "Unassigned"
  // but the dot makes the per-row affordance discoverable from any group).
  const needsParentReview = f.parent_extrapolated || f.parent_formation_id == null
  const reviewTooltip = f.parent_extrapolated
    ? t('litho.parentExtrapolatedReview')
    : t('litho.noParentReview')

  return (
    <li
      className="flex items-center gap-2 px-1 py-0.5 rounded text-xs text-text-primary"
      data-testid={`litho-formation-row-${f.id}`}
    >
      <span
        className="h-3 w-3 flex-shrink-0 rounded-sm border border-border-subtle"
        // Litho formations carry their lithology colour in the stored
        // ``color`` (stamped at create + backfilled, #145).
        style={{ backgroundColor: f.color }}
        aria-hidden="true"
      />
      {/* Translate at the presentation boundary — a litho unit's stored
          ``name`` is the raw token ("KLEI (KL:Z)"); the roster shows the
          English pipe label (debt #96). */}
      <span className="flex-1 truncate">
        {f.litho_main_soil_code != null
          ? lithoDisplayName(f.litho_main_soil_code, f.litho_admixtures)
          : f.name}
      </span>

      {/* Debt #87: parent-review affordance — amber filled circle on the
          right edge of the name region (before the metadata column). */}
      {needsParentReview && (
        <button
          type="button"
          onClick={() => onReviewParent(f)}
          className="flex-shrink-0 text-amber-500 hover:text-amber-600 transition-colors"
          title={reviewTooltip}
          aria-label={reviewTooltip}
          data-testid={`parent-review-${f.id}`}
        >
          <Circle size={9} fill="currentColor" aria-hidden="true" />
        </button>
      )}

      {/* Contact count */}
      <span
        className="text-[10px] tabular-nums text-text-muted"
        title={t(contactCount === 1 ? 'geotech.contactLabel' : 'geotech.contactsLabel', {
          count: contactCount,
        })}
      >
        {contactCount}
      </span>

      {/* #101 Slice 6: lens count badge — only visible when ≥1 lens. */}
      {lensCount > 0 && (
        <span
          className="text-[10px] tabular-nums rounded px-1 py-0 bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300"
          title={t(lensCount === 1 ? 'litho.lensDefinedOne' : 'litho.lensDefinedMany', {
            n: lensCount,
          })}
          data-testid={`lens-count-badge-${f.id}`}
        >
          {lensCount}L
        </span>
      )}
    </li>
  )
}

// ---------------------------------------------------------------------------
// LithoFormationRoster — flat roster of litho units
// ---------------------------------------------------------------------------

interface LithoFormationRosterProps {
  /** Litho units in the active litho model. */
  lithoFormations: readonly GeologicalFormationResponse[]
  /** All contacts in the active litho model — used for per-unit count. */
  lithoContacts: readonly FormationContactResponse[]
  /**
   * Per-formation lens count (#101 Slice 6).
   * Key = formation id; value = number of lenses whose
   * ``parent_formation_id`` equals that key.  Absent key → 0.
   */
  lensCountByFormationId: ReadonlyMap<string, number>
  /** Debt #87: called when the user clicks a unit's parent-review dot. */
  onReviewParent: (formation: GeologicalFormationResponse) => void
  t: Translator
}

/**
 * Renders lithostratigraphic units as a flat list ordered ascending by
 * ``display_order`` (oldest first — superposition convention used by all
 * renderers).
 *
 * Under A2 litho units are geo-agnostic (``parent_formation_id`` is always
 * ``null`` on accept-created rows), so parent-group headers would only
 * produce a single "Unassigned" bucket for every unit. The flat list is
 * simpler and honest: the engineer sees the units in stratigraphic order
 * without misleading group structure.
 *
 * Each unit row shows: colour swatch, name, and contact count.
 *
 * Parameters
 * ----------
 * lithoFormations
 *     Litho units to display, ordered by ``display_order`` (caller sorts).
 * lithoContacts
 *     All contacts in the litho model for per-unit contact counting.
 * lensCountByFormationId
 *     Per-formation lens count map.
 * onReviewParent
 *     Callback when the user clicks a unit's parent-review dot.
 *
 * Returns
 * -------
 * JSX.Element
 *     The flat roster element.
 */
export default function LithoFormationRoster({
  lithoFormations,
  lithoContacts,
  lensCountByFormationId,
  onReviewParent,
  t,
}: LithoFormationRosterProps): JSX.Element {
  // Sort ascending by display_order (oldest first — superposition convention).
  const sorted = [...lithoFormations].sort((a, b) => a.display_order - b.display_order)

  return (
    <ul className="flex flex-col gap-0.5" aria-label={t('litho.formations')}>
      {sorted.map(f => (
        <LithoUnitRow
          key={f.id}
          f={f}
          lithoContacts={lithoContacts}
          lensCount={lensCountByFormationId.get(f.id) ?? 0}
          onReviewParent={onReviewParent}
          t={t}
        />
      ))}
    </ul>
  )
}
