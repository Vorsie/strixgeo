// The one-item "Unit statistics…" context menu, portalled to document.body.
//
// Extracted from ``PartitionFillOverlay`` (the R2 geotech fill-region menu)
// when the model fill became the second consumer (owner ruling S6,
// 2026-08-27: "right click a fill region only works for normal fill, not
// model fill") — separate copies would drift in dismissal behaviour or z
// stacking. It owns its own zoom/Esc dismissal (``useMenuDismissOnZoomOrEsc``).

import { createPortal } from 'react-dom'

import { UnitStatisticsItem } from './unitStatisticsMenuItem'
import { useMenuDismissOnZoomOrEsc } from './useMenuDismiss'

/** Where the menu opens and which unit its item reports. */
export interface UnitStatsMenuState {
  clientX: number
  clientY: number
  formationId: string
  /**
   * The clicked ground's resolver body, when the opening surface resolved
   * one (owner ruling 2026-08-27) — absent/null keeps the jump
   * formation-level.
   */
  bodyId?: string | null
  /**
   * The clicked region's own geotech layer ids (fill-region menus only) — lets
   * the geotech jump ladder reach a class row when the body is unresolved
   * (spec §2 step 2).
   */
  regionLayerIds?: readonly string[]
  /**
   * Optional header NAMING the unit this menu is for (#279). When the fill-region
   * menu falls back to statistics (a pooled or mid-load region, so the richer
   * body menu cannot answer), it still names its unit here — so the two menus a
   * fill right-click can open read as one family, "the menu for this unit",
   * instead of two anonymous look-alikes with the same cursor. Absent (the
   * model-fill consumer, which has no per-region label to name) → no header,
   * byte-identical to before.
   */
  header?: string
}

interface Props {
  /** The open state, or ``null`` — the component renders nothing then. */
  menu: UnitStatsMenuState | null
  /** The jump handler the item forwards the formation id (+ body + region) to. */
  onShow:
    | ((unitId: string, bodyId?: string | null, regionLayerIds?: readonly string[]) => void)
    | undefined
  /** Close the menu (backdrop click, Esc, wheel, or after the jump). */
  onClose: () => void
  /** data-testid of the menu box. */
  menuTestid: string
  /** data-testid of the statistics item. */
  itemTestid: string
}

/**
 * Fixed-position single-item menu for the unit-statistics jump.
 *
 * Parameters
 * ----------
 * props : Props
 *     Open state + handlers + per-surface testids.
 *
 * Returns
 * -------
 * JSX.Element | null
 *     The portalled menu, or nothing while closed.
 */
export default function UnitStatisticsPortalMenu({
  menu,
  onShow,
  onClose,
  menuTestid,
  itemTestid,
}: Props): JSX.Element | null {
  useMenuDismissOnZoomOrEsc(menu !== null, onClose)
  if (menu === null) return null
  return createPortal(
    <>
      <div
        style={{ position: 'fixed', inset: 0, zIndex: 2147483646 }}
        onClick={onClose}
        onContextMenu={e => {
          e.preventDefault()
          onClose()
        }}
      />
      <div
        data-testid={menuTestid}
        style={{
          position: 'fixed',
          left: menu.clientX,
          top: menu.clientY,
          zIndex: 2147483647,
          background: 'var(--color-surface-overlay, #1e293b)',
          border: '1px solid var(--color-border-default, #334155)',
          borderRadius: 6,
          boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
          minWidth: 200,
        }}
      >
        {menu.header !== undefined && menu.header !== '' && (
          // Names the unit this menu is for, mirroring the body menu's header so
          // a fill right-click always reads "the menu for this unit" (#279).
          <div
            data-testid={`${menuTestid}-header`}
            style={{
              padding: '6px 12px',
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--color-text-secondary, #94a3b8)',
              borderBottom: '1px solid var(--color-border-default, #334155)',
              whiteSpace: 'nowrap',
            }}
          >
            {menu.header}
          </div>
        )}
        <UnitStatisticsItem
          unitId={menu.formationId}
          bodyId={menu.bodyId ?? null}
          regionLayerIds={menu.regionLayerIds}
          onShow={onShow}
          onClose={onClose}
          testid={itemTestid}
        />
      </div>
    </>,
    document.body,
  )
}
