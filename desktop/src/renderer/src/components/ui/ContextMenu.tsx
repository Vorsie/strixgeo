/**
 * Generic right-click context menu (#164).
 *
 * Collapses four hand-rolled menus — ``ColumnContextMenu``,
 * ``ContactContextMenu`` (in ContactsLayer), and the ``BodyContextMenu`` +
 * ``EdgeContextMenu`` pair (in CorrelationEdgesOverlay) — into one component
 * so the positioned container, the item button block, the danger / disabled
 * styling, and (crucially) the dismiss logic are defined once.
 *
 * The dismiss correctness was previously re-derived per copy: only
 * ``ContactContextMenu`` called ``nativeEvent.stopImmediatePropagation`` on its
 * item clicks, so the others carried a latent double-``onClose`` bug. Here the
 * DOM variants stop the native event once, in one place.
 *
 * Positioning is selected with ``portal``:
 *   * ``'svg'``     — wrapped in a ``<foreignObject>`` for use INSIDE an SVG
 *                     (the section canvas). Dark, inline-styled; dismissed by a
 *                     full-viewport backdrop (click / right-click) plus Esc.
 *   * ``'fixed'``   — ``position: fixed`` at viewport coordinates.
 *   * ``'absolute'``— ``position: absolute`` at container-local coordinates
 *                     (the caller's relative parent).
 *
 * The two DOM variants share Tailwind chrome (light + dark) and dismiss via a
 * document ``click`` + ``keydown`` (Esc) listener; clicking an enabled item
 * runs its action and then closes the menu automatically.
 */

import { useEffect } from 'react'

/** One selectable row in a {@link ContextMenu}. */
export interface ContextMenuItem {
  /** Visible label. */
  label: string
  /** Action to run when the (enabled) item is chosen. The menu closes itself
   *  afterwards — the handler must NOT call the menu's ``onClose``. */
  onClick: () => void
  /** Render in the danger palette (red). Default false. */
  danger?: boolean
  /** Disable the item — it renders muted and is not clickable. Default false. */
  disabled?: boolean
  /** Secondary line shown under the label when ``disabled`` (the "why"), and
   *  set as the button ``title``. */
  reason?: string
  /** Draw a separator border above this item (group divider). */
  topBorder?: boolean
  /** ``data-testid`` for the item button. */
  testid?: string
  /** Stable React key; falls back to ``label``. */
  key?: string
}

interface BaseProps {
  /** The menu rows, in order. Falsy entries are ignored so callers can inline
   *  ``cond && {…}`` without filtering. */
  items: (ContextMenuItem | false | null | undefined)[]
  /** Optional subtitle header (e.g. the right-clicked column's name). */
  header?: string
  /** Fired on outside click, right-click on the backdrop, or Esc. */
  onClose: () => void
  /** ``aria-label`` for the ``role="menu"`` container. */
  ariaLabel?: string
  /** ``data-testid`` for the menu container. */
  testid?: string
  /** Minimum width in px. Defaults to 200. */
  minWidth?: number
}

type Props =
  | (BaseProps & {
      portal: 'svg'
      x: number
      y: number
      /** ``<foreignObject>`` width — must be wide enough for the menu. */
      width: number
      /** ``<foreignObject>`` height. */
      height: number
    })
  | (BaseProps & {
      portal: 'fixed' | 'absolute'
      x: number
      y: number
    })

/** Inline styles for the SVG-canvas (dark) variant — kept verbatim from the
 *  original BodyContextMenu / EdgeContextMenu so the canvas look is unchanged. */
const SVG_PANEL_STYLE: React.CSSProperties = {
  position: 'absolute',
  background: 'var(--color-surface-overlay, #1e293b)',
  border: '1px solid var(--color-border-default, #334155)',
  borderRadius: 6,
  boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
  zIndex: 9999,
}

const SVG_ITEM_STYLE: React.CSSProperties = {
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

export default function ContextMenu(props: Props): JSX.Element {
  const { items, header, onClose, ariaLabel, testid, minWidth = 200 } = props

  // Esc closes the menu in every variant (debt #164 unifies this).
  useEffect(() => {
    function handleKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  // All variants dismiss on any document click outside the menu. The SVG
  // variant ALSO has a backdrop (for right-click-to-close), but a
  // ``position:fixed`` backdrop nested in an SVG ``<foreignObject>`` does NOT
  // reliably cover the viewport in Chromium/Electron, so a left-click on the
  // canvas elsewhere missed it and the menu stayed open (dogfeed 2026-05-29).
  // The document listener is the reliable outside-click path; each menu's
  // container stops its own clicks from reaching it.
  useEffect(() => {
    function handleDocClick(): void {
      onClose()
    }
    document.addEventListener('click', handleDocClick)
    return () => document.removeEventListener('click', handleDocClick)
  }, [onClose])

  const visibleItems = items.filter((it): it is ContextMenuItem => Boolean(it))

  // ----- SVG (canvas) variant -------------------------------------------
  if (props.portal === 'svg') {
    return (
      <foreignObject
        x={props.x}
        y={props.y}
        width={props.width}
        height={props.height}
        style={{ overflow: 'visible' }}
      >
        <div
          data-testid={testid}
          role="menu"
          aria-label={ariaLabel}
          style={{ ...SVG_PANEL_STYLE, minWidth }}
          // Keep clicks inside the menu from reaching the document dismisser
          // (an item still closes via its own onClick → onClose).
          onClick={e => e.stopPropagation()}
        >
          {header && (
            <div
              style={{
                padding: '6px 12px',
                fontSize: 11,
                color: 'var(--color-text-secondary, #94a3b8)',
                borderBottom: '1px solid var(--color-border-default, #334155)',
              }}
            >
              {header}
            </div>
          )}
          {visibleItems.map(item => (
            <button
              key={item.key ?? item.label}
              type="button"
              data-testid={item.testid}
              role="menuitem"
              disabled={item.disabled}
              title={item.reason}
              style={{
                ...SVG_ITEM_STYLE,
                ...(item.danger ? { color: 'var(--color-text-danger, #f87171)' } : {}),
                ...(item.disabled ? { opacity: 0.5, cursor: 'not-allowed' } : {}),
                ...(item.topBorder
                  ? { borderTop: '1px solid var(--color-border-default, #334155)' }
                  : {}),
              }}
              onClick={() => {
                if (item.disabled) return
                item.onClick()
                onClose()
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
        {/* Backdrop — catches right-click-to-dismiss (the document listener
            only watches left clicks). stopPropagation on the left click so it
            doesn't ALSO trigger the document dismisser (double onClose). Where
            the backdrop fails to cover the viewport (fixed-in-foreignObject),
            the document click listener is the fallback. */}
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 9998 }}
          onClick={e => {
            e.stopPropagation()
            onClose()
          }}
          onContextMenu={e => {
            e.preventDefault()
            onClose()
          }}
        />
      </foreignObject>
    )
  }

  // ----- DOM (fixed / absolute) variants --------------------------------
  const positionClass = props.portal === 'fixed' ? 'fixed z-[9999]' : 'absolute z-30'
  const itemBase = 'block w-full px-3 py-2 text-left'
  return (
    <div
      data-testid={testid}
      role="menu"
      aria-label={ariaLabel}
      className={`${positionClass} rounded border border-gray-300 bg-white text-sm shadow-md dark:border-gray-600 dark:bg-gray-800`}
      style={{ left: props.x, top: props.y, minWidth }}
      // Keep clicks inside the menu from reaching the document dismisser.
      onClick={e => e.stopPropagation()}
    >
      {header && (
        <div className="max-w-[220px] truncate border-b border-gray-100 px-3 py-1.5 text-xs text-gray-500 dark:border-gray-700 dark:text-gray-400">
          {header}
        </div>
      )}
      {visibleItems.map(item => {
        const stateClass = item.disabled
          ? 'cursor-not-allowed text-gray-400 dark:text-gray-500'
          : item.danger
            ? 'text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40'
            : 'hover:bg-gray-100 dark:text-gray-100 dark:hover:bg-gray-700'
        const borderClass = item.topBorder ? ' border-t border-gray-100 dark:border-gray-700' : ''
        return (
          <button
            key={item.key ?? item.label}
            type="button"
            data-testid={item.testid}
            role="menuitem"
            disabled={item.disabled}
            aria-disabled={item.disabled}
            title={item.reason}
            className={`${itemBase} ${stateClass}${borderClass}`}
            onClick={e => {
              // stopImmediatePropagation: a React synthetic stopPropagation does
              // NOT stop the document-level native ``click`` listener that
              // dismisses the menu, so without this the listener would fire a
              // redundant onClose. (This was the latent bug only ContactContextMenu
              // guarded against — now fixed for every DOM menu.)
              e.nativeEvent.stopImmediatePropagation()
              if (item.disabled) return
              item.onClick()
              onClose()
            }}
          >
            {item.label}
            {item.disabled && item.reason && (
              <span className="mt-0.5 block text-[10px] text-gray-400 dark:text-gray-500">
                {item.reason}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
