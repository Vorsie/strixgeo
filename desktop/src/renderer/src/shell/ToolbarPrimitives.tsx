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
  /** Optional data-testid passthrough for e2e harnesses. */
  testid?: string
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
 * testid
 *     Optional data-testid for e2e harness targeting.
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
  testid,
}: PrimaryToolbarButtonProps): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      aria-busy={busy}
      data-testid={testid}
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
  /** Optional data-testid passthrough for e2e harnesses. */
  testid?: string
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
 * testid
 *     Optional data-testid for e2e harness targeting.
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
  testid,
}: ToolbarButtonProps): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-busy={busy}
      data-testid={testid}
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

// ---------------------------------------------------------------------------
// SplitToolbarButton — debt #97
// ---------------------------------------------------------------------------

interface SplitToolbarButtonProps {
  /** Icon for the primary action half (lucide, 13 px). */
  icon: React.ReactNode
  /** Label for the primary action half. */
  label: string
  /** Fires when the user clicks the primary action half (left of the
   *  caret). The caret half opens the secondary-items dropdown. */
  onClick: () => void
  /** Disable the primary action only (caret stays open if it has any
   *  enabled items). Disabling the WHOLE control should be done by
   *  combining ``disabled`` with empty/disabled items. */
  disabled?: boolean
  /** Tooltip on the primary half. */
  title?: string
  /** Spinning indicator on the primary half (async in-flight). */
  busy?: boolean
  /** Render the primary half in the accent-filled style (matches
   *  ``PrimaryToolbarButton``) — for true primary verbs. Default
   *  false = same plain style as ``ToolbarButton``. */
  primary?: boolean
  /** Render the primary half with amber tint — mirrors
   *  ``ToolbarButton``'s amber for mode-active affordances (e.g. a
   *  toggleable mode that is currently ON).  Mutually exclusive with
   *  ``primary`` (amber wins on the rare collision because the
   *  active-mode signal is the more user-relevant one). */
  amber?: boolean
  /** Secondary actions surfaced under the caret. Empty = caret hidden
   *  (degenerates to a plain ToolbarButton). */
  items: readonly ToolbarDropdownItem[]
  /** Optional data-testid for the primary half. The caret half uses
   *  ``${testid}-caret`` when supplied. */
  testid?: string
}

/**
 * Split-button toolbar control: a primary action attached to a caret
 * that opens a small menu of secondary actions.
 *
 * Visual + behavioural contract
 * -----------------------------
 * - Two adjacent buttons sharing a rounded outline. Left button = the
 *   primary verb (icon + label). Right button = the caret only.
 * - The primary button calls ``onClick`` directly (no menu opens).
 * - The caret button opens the same floating menu as
 *   ``ToolbarDropdown`` (createPortal, Esc + outside-click dismiss).
 * - ``disabled`` greys the primary half; the caret stays usable so
 *   the user can still reach the secondary items (which carry their
 *   own ``disabled`` per-item).
 * - ``busy`` swaps the icon for a spinning ``RefreshCw`` on the
 *   primary half (docs/ux.md async affordance, matches
 *   ``ToolbarButton``).
 *
 * Why a new primitive (rather than reusing ``ToolbarDropdown``)
 * -------------------------------------------------------------
 * ToolbarDropdown opens its menu on the trigger CLICK; there is no
 * distinct primary action. The split-button pattern collapses 3 verbs
 * (Suggest litho / Suggest all / Suggest for new tests) into one slot
 * by promoting the most common verb to a single-click action and
 * burying the variants under the caret — exactly the toolbar-shrink
 * the #97 refactor needs.
 */
export function SplitToolbarButton({
  icon,
  label,
  onClick,
  disabled,
  title,
  busy,
  primary,
  amber,
  items,
  testid,
}: SplitToolbarButtonProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null)
  const caretRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClickAway(e: MouseEvent): void {
      const t = e.target as Node
      if (caretRef.current && caretRef.current.contains(t)) return
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

  function handleCaretClick(): void {
    const rect = caretRef.current?.getBoundingClientRect() ?? null
    setAnchorRect(rect)
    setOpen(o => !o)
  }

  // When the primary acts as a caret fallback, show a clickable
  // muted-but-not-disabled style: faded text (signals "not the
  // primary verb right now") + pointer cursor + hover so the user
  // sees the button responds to hover. Cursor-not-allowed only when
  // truly disabled (no fallback to offer).
  // Primary-as-caret fallback only fires when the primary is disabled
  // AND at least one menu item is enabled — i.e. there is somewhere
  // useful for the user to land if they click the primary by accident.
  // When every item shares the same gate as the primary (all disabled
  // together — e.g. the Sections #141 correlation triad gated on
  // ``sectionHasLithoContacts``), the fallback would only lead to a
  // dead menu and should NOT make the primary appear clickable.
  const primaryActsAsCaretClassname = !!disabled && items.some(i => !i.disabled)
  // Amber wins over primary when both are set — the mode-active signal
  // (amber) is more user-relevant than the primary-verb accent fill.
  const primaryClasses = amber
    ? [
        'flex items-center gap-1.5 pl-2.5 pr-2 py-1 rounded-l text-xs font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        disabled
          ? primaryActsAsCaretClassname
            ? 'text-status-amber hover:bg-surface-app cursor-pointer'
            : 'text-status-amber/60 cursor-not-allowed'
          : 'text-status-amber hover:bg-surface-app',
      ].join(' ')
    : primary
    ? [
        'flex items-center gap-1.5 pl-2.5 pr-2 py-1 rounded-l text-xs font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        disabled
          ? primaryActsAsCaretClassname
            ? 'bg-accent/60 text-text-on-accent/80 hover:bg-accent cursor-pointer'
            : 'bg-accent/40 text-text-on-accent/60 cursor-not-allowed'
          : 'bg-accent text-text-on-accent hover:bg-accent-hover',
      ].join(' ')
    : [
        'flex items-center gap-1.5 pl-2.5 pr-2 py-1 rounded-l text-xs font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        disabled
          ? primaryActsAsCaretClassname
            ? 'text-text-muted hover:bg-surface-app hover:text-text-secondary cursor-pointer'
            : 'text-text-muted cursor-not-allowed'
          : 'text-text-secondary hover:bg-surface-app hover:text-text-primary',
      ].join(' ')

  const caretClasses = amber
    ? [
        'flex items-center px-1.5 py-1 rounded-r text-xs transition-colors border-l border-border-subtle',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        'text-status-amber hover:bg-surface-app',
      ].join(' ')
    : primary
    ? [
        'flex items-center px-1.5 py-1 rounded-r text-xs transition-colors border-l border-accent-hover/30',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        'bg-accent text-text-on-accent hover:bg-accent-hover',
      ].join(' ')
    : [
        'flex items-center px-1.5 py-1 rounded-r text-xs transition-colors border-l border-border-subtle',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        'text-text-secondary hover:bg-surface-app hover:text-text-primary',
      ].join(' ')

  // Primary-as-caret fallback (dogfeed 2026-05-23): when the primary
  // verb is disabled (e.g. Suggest needs a focused column) but the
  // caret has items the user can still reach, repurpose the primary
  // button as a second click target for the caret dropdown. Pre-fix
  // the user read the whole control as inert and gave up before
  // hunting for the small ▾. When ``items`` is empty OR every item
  // shares the primary's gate (all disabled together — the #141
  // correlation triad case), no fallback fires; the button is truly
  // disabled.
  const primaryActsAsCaret = !!disabled && items.some(i => !i.disabled)
  const primaryButtonDisabled = !!disabled && !primaryActsAsCaret
  return (
    <>
      <div className="flex items-center" data-testid={testid ? `${testid}-group` : undefined}>
        <button
          type="button"
          onClick={() => {
            if (primaryActsAsCaret) {
              handleCaretClick()
              return
            }
            if (disabled) return
            onClick()
          }}
          disabled={primaryButtonDisabled}
          title={
            primaryActsAsCaret
              ? `${title ?? label} — click for options`
              : title
          }
          data-testid={testid}
          className={primaryClasses}
        >
          {busy ? <RefreshCw size={13} className="animate-spin" /> : icon}
          {label}
        </button>
        <button
          ref={caretRef}
          type="button"
          onClick={handleCaretClick}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={`${label} options`}
          data-testid={testid ? `${testid}-caret` : undefined}
          className={caretClasses}
        >
          <ChevronDown size={11} aria-hidden="true" />
        </button>
      </div>
      {open && anchorRect !== null &&
        createPortal(
          <div
            style={{
              position: 'fixed',
              top: anchorRect.bottom + 4,
              // Right-align the menu to the caret so wider items don't
              // bleed off the toolbar's left edge on a narrow viewport.
              left: anchorRect.right - 200,
              minWidth: 200,
              zIndex: 10000,
            }}
            onMouseDown={e => e.stopPropagation()}
            className="bg-surface-overlay border border-border-default rounded shadow-lg py-1 text-xs"
            role="menu"
            aria-label={`${label} options`}
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
