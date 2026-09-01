// The "Unit statistics…" menu item — the jump to the Parameters stage, scoped
// to a unit (owner ballot 2026-08-26; extended to litho bands and fill
// regions by the 2026-08-27 rulings R1/R2).
//
// ONE component across every menu that offers the jump — the geotech band
// menus, the litho band menu, the fill-region menu — because separate copies
// would drift in wording or in which id they report. Lifted out of
// ``GeotechBandEditOverlay`` when the litho menu became the second consumer
// (CLAUDE.md "extract on the second copy").

import { useT } from '../../i18n/translate'

/** Shared inline style for hand-rolled section context-menu items. */
export const MENU_ITEM_STYLE: React.CSSProperties = {
  display: 'block',
  width: '100%',
  padding: '6px 12px',
  textAlign: 'left',
  fontSize: 12,
  color: 'var(--color-text-primary, #e2e8f0)',
  background: 'none',
  border: 'none',
  cursor: 'pointer',
}

/**
 * "Unit statistics…" — reports the clicked ground's FORMATION id (never a
 * layer id: the statistics are a property of the unit, pooled over every band
 * of it in the project) plus, when the surface knows it, the clicked BODY
 * (owner ruling 2026-08-27, verbatim: "a body is only a body if it is
 * geometrically connected or if the users says, this body is the same as
 * that body" — the unit row lumps many resolver bodies, and a jump that
 * knows which body was clicked must say so).
 *
 * Renders NOTHING when no handler is wired — the no-affordance rule the band
 * menus follow, rather than a disabled entry for a verb the engineer cannot
 * reach.
 *
 * Parameters
 * ----------
 * unitId
 *     The formation id to report.
 * bodyId
 *     The clicked ground's resolver body, or ``null``/absent when the surface
 *     cannot name one — the jump then stays formation-level (the pooled view).
 * onShow
 *     The jump handler, or ``undefined`` to render nothing.
 * onClose
 *     Closes the hosting menu after the jump fires.
 * topBorder
 *     Draw a separating rule above — the item navigates away, so it sits
 *     apart from items that edit.
 * testid
 *     Per-surface test id; defaults to the geotech band menu's historical one.
 */
export function UnitStatisticsItem({
  unitId,
  bodyId = null,
  regionLayerIds,
  onShow,
  onClose,
  topBorder = false,
  testid = 'geotech-band-menu-unit-statistics',
}: {
  unitId: string
  bodyId?: string | null
  /**
   * The clicked region's own geotech layer ids, when the opening surface is a
   * fill region. Lets the geotech jump ladder land on a class row (spec §2 step
   * 2) when the body is unresolved but the region's litho parent body is
   * unique. Absent for band / contact clicks (which resolve their own body).
   */
  regionLayerIds?: readonly string[]
  onShow:
    | ((unitId: string, bodyId?: string | null, regionLayerIds?: readonly string[]) => void)
    | undefined
  onClose: () => void
  topBorder?: boolean
  testid?: string
}): JSX.Element | null {
  // Called before the early return so the hook order is stable (react-hooks).
  const t = useT()
  if (onShow === undefined) return null
  return (
    <button
      type="button"
      data-testid={testid}
      onClick={() => {
        // Pass the region only when the surface supplied it (fill regions), so
        // band / contact menus keep their two-argument call shape unchanged.
        if (regionLayerIds !== undefined) onShow(unitId, bodyId, regionLayerIds)
        else onShow(unitId, bodyId)
        onClose()
      }}
      style={
        topBorder
          ? {
              ...MENU_ITEM_STYLE,
              borderTop: '1px solid var(--color-border-default, #334155)',
            }
          : MENU_ITEM_STYLE
      }
    >
      {t('sections.menu.unitStatistics')}
    </button>
  )
}
