// The bulk action bar for the Parameters unit list — appears at the top of the
// list when ≥ 1 geotech body is checked (docs/ux.md selection model:
// "N selected · [Action] · Clear"). Presentational only: the selection state and
// the Group/Ungroup client calls live in ``useUnitGrouping``.

import { useT } from '../../../i18n/translate'
import type { GroupGuardStatus } from './unitGrouping'

export interface UnitGroupActionBarProps {
  /** How many geotech bodies are checked. */
  count: number
  /** Whether/why the checked set can be grouped (disables + explains Group). */
  guard: GroupGuardStatus
  /** True when ≥ 1 checked body is already in a group — reveals Ungroup. */
  hasGrouped: boolean
  /** True while a group/ungroup round-trip is in flight — disables both actions. */
  busy: boolean
  /** Group the checked bodies. */
  onGroup: () => void
  /** Remove every checked grouped body from its group. */
  onUngroup: () => void
  /** Clear the selection. */
  onClear: () => void
}

/**
 * The "N selected · Group · Clear" bar shown above the unit tree while a
 * geotech-body selection is active.
 *
 * Parameters
 * ----------
 * props
 *     {@link UnitGroupActionBarProps}.
 *
 * Returns
 * -------
 * JSX.Element
 *     The bar.
 */
export default function UnitGroupActionBar({
  count,
  guard,
  hasGrouped,
  busy,
  onGroup,
  onUngroup,
  onClear,
}: UnitGroupActionBarProps): JSX.Element {
  const t = useT()
  // The disabled-Group hint tells the engineer WHY, so a greyed button never
  // reads as broken (docs/ux.md: never a dead affordance without a reason).
  const groupHint =
    guard === 'cross-class'
      ? t('params.groupCrossClassHint')
      : guard === 'need-two'
        ? t('params.groupNeedTwoHint')
        : undefined

  return (
    <div
      className="flex items-center gap-2 px-3 py-1.5 border-b border-border-subtle bg-surface-sunken/40 text-[11px] shrink-0"
      data-testid="parameters-group-bar"
    >
      <span className="text-text-secondary tabular-nums" data-testid="parameters-group-count">
        {t('params.groupNSelected', { n: count })}
      </span>
      <span aria-hidden="true" className="text-text-muted">
        ·
      </span>
      <button
        type="button"
        disabled={guard !== 'ok' || busy}
        title={groupHint}
        onClick={onGroup}
        data-testid="parameters-group-action"
        className="px-2 py-0.5 rounded border border-border-subtle text-text-primary hover:bg-surface-app disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {t('params.group')}
      </button>
      {hasGrouped && (
        <button
          type="button"
          disabled={busy}
          onClick={onUngroup}
          data-testid="parameters-ungroup-action"
          className="px-2 py-0.5 rounded border border-border-subtle text-text-primary hover:bg-surface-app disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {t('params.ungroup')}
        </button>
      )}
      <button
        type="button"
        onClick={onClear}
        data-testid="parameters-group-clear"
        className="ml-auto px-2 py-0.5 rounded text-text-secondary hover:text-text-primary hover:bg-surface-app"
      >
        {t('params.clearSelection')}
      </button>
    </div>
  )
}
