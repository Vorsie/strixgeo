// The portalled floating menu every toolbar dropdown opens, plus its shared
// open/anchor hook. Lifted out of ToolbarPrimitives.tsx (which re-exports both,
// so no caller changes its import) when the menu learned GROUP rows: a row that
// carries a ``submenu`` opens its rows in a second panel beside it (owner
// 2026-10-04: "one button for cpt's with suboptions, same for drillings").
//
// One level only. The parent panel and the submenu panel render through the
// same ``MenuPanel`` / ``MenuRow`` pair, so a sub-row looks and behaves exactly
// like a top-level row; only the group row adds the chevron and the
// open-on-hover / ArrowRight behaviour.

import { ChevronRight } from 'lucide-react'
import { Fragment, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type React from 'react'

import type { ToolbarDropdownItem } from './ToolbarPrimitives'

/** Minimum width of a submenu panel. Also the width the flip-left fallback
 *  reserves when the panel would run off the right edge of the window. */
const SUBMENU_MIN_WIDTH_PX = 192

/** The panel's top padding (py-1) plus its 1 px border: shifting the submenu up
 *  by this much puts its first row level with the group row that opened it. */
const SUBMENU_TOP_OFFSET_PX = 5

/**
 * Shared open/anchor state for a portal-rendered dropdown menu.
 *
 * Owns the open boolean + the trigger's DOMRect, and wires the
 * document-level dismiss listeners (mousedown-outside + Escape) while
 * open. Used by ``ToolbarDropdown``, ``SplitToolbarButton`` and the
 * Data-stage import dropdown so the boilerplate exists exactly once.
 * Escape closes the whole menu, an open submenu included (the submenu is
 * part of the ``PortalMenu`` the caller unmounts).
 *
 * Parameters
 * ----------
 * triggerRef
 *     Ref of the button that anchors the menu — clicks inside it are
 *     ignored by the outside-click dismiss (the trigger's own onClick
 *     toggles instead).
 *
 * Returns
 * -------
 * ``{ open, anchorRect, toggle, close }``.
 */
export function usePortalMenu(triggerRef: React.RefObject<HTMLButtonElement>): {
  open: boolean
  anchorRect: DOMRect | null
  toggle: () => void
  close: () => void
} {
  const [open, setOpen] = useState(false)
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null)

  useEffect(() => {
    if (!open) return
    function handleClickAway(e: MouseEvent): void {
      // mousedown not click so the menu closes BEFORE the next click
      // can land on something behind it — matches the existing
      // ColumnContextMenu + LithoSuggestionGhostColumns context-menu
      // patterns elsewhere in the codebase.
      const t = e.target as Node
      if (triggerRef.current && triggerRef.current.contains(t)) return
      setOpen(false)
    }
    function handleKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handleClickAway)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClickAway)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open, triggerRef])

  function toggle(): void {
    setAnchorRect(triggerRef.current?.getBoundingClientRect() ?? null)
    setOpen(o => !o)
  }

  function close(): void {
    setOpen(false)
  }

  return { open, anchorRect, toggle, close }
}

interface PortalMenuProps {
  /** The trigger's bounding rect the menu anchors below. */
  anchorRect: DOMRect
  /** aria-label on the menu container. */
  ariaLabel: string
  items: readonly ToolbarDropdownItem[]
  /** Fired after an item's onClick (and by the caller's dismiss logic). */
  onClose: () => void
  /** 'left' (default) aligns to the trigger's left edge; 'right'
   *  right-aligns the menu to the trigger's right edge using widthPx
   *  (so wide items don't bleed off a narrow viewport). */
  align?: 'left' | 'right'
  /** Menu min-width in px — required for right alignment. */
  widthPx?: number
  /** Extra container classes (e.g. a fixed width utility). */
  className?: string
}

/** The group row whose submenu is showing, and where it sits on screen. */
interface OpenSubmenu {
  index: number
  rowRect: DOMRect
  /** Opened from the keyboard: the submenu takes focus on its first row. */
  focusFirst: boolean
}

/**
 * Portal-rendered floating menu shared by every toolbar dropdown.
 *
 * Rendered fixed under the anchor rect via ``createPortal`` so it
 * escapes any ``overflow-hidden`` toolbar zone. Items fire ``onClick``
 * then ``onClose``. Mousedown inside the menu is stopped so the
 * document-level outside-click dismiss (see ``usePortalMenu``) never
 * sees it.
 *
 * A row with a ``submenu`` is a GROUP row: it shows a chevron, and hovering
 * it, clicking it, or pressing ArrowRight on it opens its rows in a second
 * portalled panel to its right (to its left when the window has no room).
 * ArrowLeft in that panel closes it and returns focus to the group row;
 * hovering a plain row of the parent closes it. A sub-row click runs the row
 * and closes the whole menu.
 *
 * Parameters
 * ----------
 * See ``PortalMenuProps``.
 *
 * Returns
 * -------
 * JSX.Element
 *     The portalled menu (and its open submenu, when there is one).
 */
export function PortalMenu({
  anchorRect,
  ariaLabel,
  items,
  onClose,
  align = 'left',
  widthPx,
  className,
}: PortalMenuProps): JSX.Element {
  const [openSub, setOpenSub] = useState<OpenSubmenu | null>(null)
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([])

  function openSubmenu(index: number, focusFirst: boolean): void {
    const row = rowRefs.current[index]
    if (!row) return
    setOpenSub({ index, rowRect: row.getBoundingClientRect(), focusFirst })
  }

  function closeSubmenu(refocusGroupRow: boolean): void {
    const index = openSub?.index
    setOpenSub(null)
    if (refocusGroupRow && index !== undefined) rowRefs.current[index]?.focus()
  }

  const group = openSub === null ? undefined : items[openSub.index]
  const subItems = group?.submenu

  return (
    <>
      {createPortal(
        <MenuPanel
          style={{
            top: anchorRect.bottom + 4,
            left: align === 'right' ? anchorRect.right - (widthPx ?? 200) : anchorRect.left,
            ...(widthPx !== undefined ? { minWidth: widthPx } : {}),
          }}
          className={className ?? (widthPx === undefined ? 'min-w-[10rem]' : '')}
          ariaLabel={ariaLabel}
          items={items}
          onClose={onClose}
          expandedIndex={openSub?.index ?? null}
          rowRef={(i, el) => {
            rowRefs.current[i] = el
          }}
          onRowEnter={i => {
            if (items[i].submenu === undefined) {
              if (openSub !== null) closeSubmenu(false)
            } else if (!items[i].disabled && openSub?.index !== i) {
              openSubmenu(i, false)
            }
          }}
          onGroupOpen={openSubmenu}
        />,
        document.body,
      )}
      {openSub !== null &&
        group !== undefined &&
        subItems !== undefined &&
        createPortal(
          <MenuPanel
            style={{
              top: openSub.rowRect.top - SUBMENU_TOP_OFFSET_PX,
              left:
                openSub.rowRect.right + SUBMENU_MIN_WIDTH_PX > window.innerWidth
                  ? openSub.rowRect.left - SUBMENU_MIN_WIDTH_PX
                  : openSub.rowRect.right,
              minWidth: SUBMENU_MIN_WIDTH_PX,
            }}
            className=""
            ariaLabel={group.label}
            items={subItems}
            onClose={onClose}
            autoFocusFirst={openSub.focusFirst}
            onRowKeyDown={e => {
              if (e.key !== 'ArrowLeft') return
              e.preventDefault()
              closeSubmenu(true)
            }}
          />,
          document.body,
        )}
    </>
  )
}

interface MenuPanelProps {
  /** Fixed position (top / left / min-width) of the panel. */
  style: React.CSSProperties
  /** Width utility classes for the panel container. */
  className: string
  ariaLabel: string
  items: readonly ToolbarDropdownItem[]
  onClose: () => void
  /** Index of the group row whose submenu is open (parent panel only). */
  expandedIndex?: number | null
  /** Collects each row's button so the parent can measure / refocus it. */
  rowRef?: (index: number, el: HTMLButtonElement | null) => void
  /** Pointer entered a row (parent panel only: drives open-on-hover). */
  onRowEnter?: (index: number) => void
  /** A group row asked to open (click, Enter / Space, or ArrowRight). */
  onGroupOpen?: (index: number, viaKeyboard: boolean) => void
  /** Extra key handling on every row (the submenu's ArrowLeft). */
  onRowKeyDown?: (e: React.KeyboardEvent<HTMLButtonElement>) => void
  /** Focus the first enabled row on mount (submenu opened from the keyboard). */
  autoFocusFirst?: boolean
}

/** One menu panel: the container plus its rows (and group headers). */
function MenuPanel({
  style,
  className,
  ariaLabel,
  items,
  onClose,
  expandedIndex = null,
  rowRef,
  onRowEnter,
  onGroupOpen,
  onRowKeyDown,
  autoFocusFirst = false,
}: MenuPanelProps): JSX.Element {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!autoFocusFirst) return
    panelRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus()
  }, [autoFocusFirst])

  return (
    <div
      ref={panelRef}
      style={{ position: 'fixed', zIndex: 10000, ...style }}
      onMouseDown={e => e.stopPropagation()}
      className={[
        'bg-surface-overlay border border-border-default rounded shadow-lg py-1 text-xs',
        className,
      ].join(' ')}
      role="menu"
      aria-label={ariaLabel}
    >
      {items.map((item, i) => (
        <Fragment key={i}>
          {item.groupHeader !== undefined && (
            // role="presentation" keeps it out of the menu's item list: the
            // heading names the rows below it, it is not one of them.
            <div
              role="presentation"
              data-testid="toolbar-menu-group-header"
              className="px-3 pt-2 pb-0.5 text-[10px] font-semibold uppercase tracking-wide text-text-muted first:pt-1"
            >
              {item.groupHeader}
            </div>
          )}
          <MenuRow
            item={item}
            isGroup={onGroupOpen !== undefined && item.submenu !== undefined}
            expanded={expandedIndex === i}
            buttonRef={el => rowRef?.(i, el)}
            onMouseEnter={() => onRowEnter?.(i)}
            onActivate={viaKeyboard => {
              if (item.disabled) return
              if (onGroupOpen !== undefined && item.submenu !== undefined) {
                onGroupOpen(i, viaKeyboard)
                return
              }
              item.onClick()
              onClose()
            }}
            onKeyDown={e => {
              if (
                e.key === 'ArrowRight' &&
                onGroupOpen !== undefined &&
                item.submenu !== undefined &&
                !item.disabled
              ) {
                e.preventDefault()
                onGroupOpen(i, true)
                return
              }
              onRowKeyDown?.(e)
            }}
          />
        </Fragment>
      ))}
    </div>
  )
}

interface MenuRowProps {
  item: ToolbarDropdownItem
  /** The row opens a submenu instead of running ``onClick``. */
  isGroup: boolean
  /** The row's submenu is showing (group rows only). */
  expanded: boolean
  buttonRef: (el: HTMLButtonElement | null) => void
  onMouseEnter: () => void
  /** Click / Enter / Space. ``viaKeyboard`` is true for a keyboard press. */
  onActivate: (viaKeyboard: boolean) => void
  onKeyDown: (e: React.KeyboardEvent<HTMLButtonElement>) => void
}

/** One menu row: icon, label, shortcut, tag, and a chevron on a group row. */
function MenuRow({
  item,
  isGroup,
  expanded,
  buttonRef,
  onMouseEnter,
  onActivate,
  onKeyDown,
}: MenuRowProps): JSX.Element {
  return (
    <button
      ref={buttonRef}
      type="button"
      role="menuitem"
      disabled={item.disabled}
      title={item.title}
      // A keyboard-synthesised click carries detail 0; a pointer click >= 1.
      onClick={e => onActivate(e.detail === 0)}
      onMouseEnter={onMouseEnter}
      onKeyDown={onKeyDown}
      data-testid={item.testid}
      {...(isGroup ? { 'aria-haspopup': 'menu' as const, 'aria-expanded': expanded } : {})}
      className={[
        'flex items-center gap-2 w-full text-left px-3 py-1.5 transition-colors',
        item.disabled
          ? 'text-text-muted cursor-not-allowed'
          : expanded
            ? 'text-text-primary bg-surface-page'
            : 'text-text-primary hover:bg-surface-page',
      ].join(' ')}
    >
      {item.icon}
      <span className="flex-1">
        {item.label}
        {(item.shortcut ?? item.shortcutHint) && (
          <span className="text-text-muted"> ({item.shortcut ?? item.shortcutHint})</span>
        )}
      </span>
      {item.tag && (
        <span className="text-[9px] bg-surface-card text-text-muted px-1 py-0.5 rounded">
          {item.tag}
        </span>
      )}
      {isGroup && (
        <ChevronRight
          size={12}
          aria-hidden="true"
          data-testid="portal-menu-submenu-chevron"
          className="text-text-muted"
        />
      )}
    </button>
  )
}
