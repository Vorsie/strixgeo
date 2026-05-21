// Shared stage-toolbar button primitives (debt #46 + the rule-of-three
// extraction GeologyToolbar's header comment scheduled).
//
// ``ToolbarButton`` + ``PrimaryToolbarButton`` were copy-pasted into
// GeologyToolbar.tsx and SectionsToolbar.tsx (identical bodies, only
// docstrings differed) with a third copy due for the Export-stage
// toolbar — past the extract-on-the-third-copy window. Lifted here
// VERBATIM, plus a ``busy`` prop: docs/ux.md requires disable + an
// in-button spinner for async triggers, but only "Build model" wired
// the spinner half. ``busy`` swaps the icon for a spinning
// ``RefreshCw`` so every long verb (Fill / Seed / Dedupe / Plaxis
// export / delete) gets the affordance for free.

import { ChevronDown, RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type React from 'react'

interface PrimaryToolbarButtonProps {
  icon: React.ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
  title?: string
  /** When true, the icon is replaced by a spinning indicator (async
   * in-flight affordance). Callers still own ``disabled`` + the label
   * swap; this only adds the motion docs/ux.md requires. */
  busy?: boolean
}

/**
 * Accent-filled toolbar button for a stage's primary entry action.
 *
 * Parameters
 * ----------
 * icon
 *     Lucide icon element (13 px).
 * label
 *     Short text label rendered next to the icon.
 * onClick
 *     Action handler.
 * disabled
 *     When true, the button is non-interactive and dimmed.
 * title
 *     Tooltip text (full action description).
 * busy
 *     When true, the icon is swapped for a spinning ``RefreshCw``.
 *
 * Returns
 * -------
 * JSX.Element
 *     The accent-filled button element.
 */
export function PrimaryToolbarButton({
  icon,
  label,
  onClick,
  disabled,
  title,
  busy,
}: PrimaryToolbarButtonProps): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      aria-busy={busy}
      className={[
        'flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-semibold transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        disabled
          ? 'bg-accent/40 text-text-on-accent cursor-not-allowed'
          : 'bg-accent text-text-on-accent hover:bg-accent-muted',
      ].join(' ')}
    >
      {busy ? <RefreshCw size={13} className="animate-spin" /> : icon}
      {label}
    </button>
  )
}

interface ToolbarButtonProps {
  icon: React.ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
  title?: string
  /** Render with amber tint (stale-surface badge affordance). */
  amber?: boolean
  /** Render with red tint (destructive action affordance). */
  danger?: boolean
  /** When true, the icon is replaced by a spinning indicator (async
   * in-flight affordance). Callers still own ``disabled`` + the label
   * swap; this only adds the motion docs/ux.md requires. */
  busy?: boolean
}

/**
 * Compact toolbar button for a stage's secondary verbs.
 *
 * Parameters
 * ----------
 * icon
 *     Lucide icon element (13 px).
 * label
 *     Short text label rendered next to the icon.
 * onClick
 *     Action handler.
 * disabled
 *     When true, the button is non-interactive.
 * title
 *     Tooltip text (full action description).
 * amber
 *     Highlights the button in amber (stale-surface badge affordance).
 * danger
 *     Highlights the button in red (destructive action affordance).
 * busy
 *     When true, the icon is swapped for a spinning ``RefreshCw``.
 *
 * Returns
 * -------
 * JSX.Element
 *     The button element.
 */
export function ToolbarButton({
  icon,
  label,
  onClick,
  disabled,
  title,
  amber,
  danger,
  busy,
}: ToolbarButtonProps): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-busy={busy}
      className={[
        'flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        disabled
          ? 'text-text-muted cursor-not-allowed'
          : danger
            ? 'text-status-danger hover:bg-surface-app'
            : amber
              ? 'text-status-amber hover:bg-surface-app'
              : 'text-text-secondary hover:bg-surface-app hover:text-text-primary',
      ].join(' ')}
    >
      {busy ? <RefreshCw size={13} className="animate-spin" /> : icon}
      {label}
    </button>
  )
}

// ---------------------------------------------------------------------------
// ToolbarDropdown — single-button surface that opens a portal-rendered menu
// of secondary actions on click. Used to collapse related toolbar verbs
// (e.g. Export DXF + Plaxis 3D under "Export ▾") so the main toolbar
// stays uncluttered without losing the verbs.
// ---------------------------------------------------------------------------

export interface ToolbarDropdownItem {
  /** Menu item label. */
  label: string
  /** Optional leading icon (same size as the toolbar buttons). */
  icon?: React.ReactNode
  /** Fired when the menu item is clicked.  The menu auto-closes. */
  onClick: () => void
  /** Disable + tooltip when the action isn't applicable. */
  disabled?: boolean
  /** Hover tooltip — same conventions as ToolbarButton. */
  title?: string
  /** Optional data-testid passthrough for vitest harnesses. */
  testid?: string
}

interface ToolbarDropdownProps {
  icon: React.ReactNode
  label: string
  /** Tooltip on the trigger button itself. */
  title?: string
  /** Disable the trigger (every item becomes unreachable). */
  disabled?: boolean
  items: readonly ToolbarDropdownItem[]
  /** Optional data-testid on the trigger button. */
  testid?: string
}

/**
 * Toolbar trigger that opens a small floating menu via createPortal.
 *
 * Menu state lives in the component (open / closed boolean + position).
 * Esc + outside-click dismiss are wired with document-level listeners
 * (attached only while open).  Items fire ``onClick`` then auto-close.
 *
 * The trigger button visually matches ``ToolbarButton`` with a trailing
 * ChevronDown to signal the dropdown.  Disabled state cascades — the
 * trigger is disabled means none of the items are reachable.
 */
export function ToolbarDropdown({
  icon,
  label,
  title,
  disabled,
  items,
  testid,
}: ToolbarDropdownProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

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
  }, [open])

  function handleTriggerClick(): void {
    if (disabled) return
    const rect = triggerRef.current?.getBoundingClientRect() ?? null
    setAnchorRect(rect)
    setOpen(o => !o)
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={handleTriggerClick}
        disabled={disabled}
        title={title}
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid={testid}
        className={[
          'flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
          disabled
            ? 'text-text-muted cursor-not-allowed'
            : 'text-text-secondary hover:bg-surface-app hover:text-text-primary',
        ].join(' ')}
      >
        {icon}
        {label}
        <ChevronDown size={11} aria-hidden="true" />
      </button>
      {open && anchorRect !== null &&
        createPortal(
          <div
            style={{
              position: 'fixed',
              top: anchorRect.bottom + 4,
              left: anchorRect.left,
              zIndex: 10000,
            }}
            onMouseDown={e => e.stopPropagation()}
            className="bg-surface-overlay border border-border-default rounded shadow-lg py-1 min-w-[10rem] text-xs"
            role="menu"
            aria-label={`${label} actions`}
          >
            {items.map((item, i) => (
              <button
                key={i}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                title={item.title}
                onClick={() => {
                  if (item.disabled) return
                  item.onClick()
                  setOpen(false)
                }}
                data-testid={item.testid}
                className={[
                  'flex items-center gap-2 w-full text-left px-3 py-1.5 transition-colors',
                  item.disabled
                    ? 'text-text-muted cursor-not-allowed'
                    : 'text-text-primary hover:bg-surface-page',
                ].join(' ')}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  )
}
