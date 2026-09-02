// Gesture & shortcut cheatsheet. Reached from Help → Gesture cheatsheet…
//
// Debt #95: the section editor's bottom hint pill lists only a handful of
// canvas gestures; the rest of the interaction surface (marquee select,
// Alt-drag MOVE vs plain-drag COPY, the litho-axis gestures, the borelog
// zoom keys) is undiscoverable except by reading docs/ux.md. This dialog
// is the single searchable reference for every gesture across every stage.
//
// Content source of truth: docs/ux.md "Keyboard shortcuts" + "Selection" +
// "Map" + "Borelog" tables and the section CanvasHints pill. When a gesture
// changes in either place, update the matching row here in the same commit.
//
// Layout: a Modal (Esc + backdrop dismiss come free) with a live search box
// and area-grouped rows. The search matches the trigger, the action text,
// and the scope, so "alt", "zoom" or "marquee" all home in fast.

import { Keyboard, Search, SearchX, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import Modal from './Modal'
import { useT } from '../../i18n/translate'

/** One gesture / shortcut entry. ``trigger`` is the key combo or mouse
 *  gesture; ``action`` is what it does. Both feed the search filter. */
interface CheatRow {
  trigger: string
  action: string
}

/** A titled group of related gestures (mirrors a docs/ux.md table or a
 *  single stage's interaction surface). */
interface CheatGroup {
  heading: string
  rows: readonly CheatRow[]
}

// ---------------------------------------------------------------------------
// Content — authored from docs/ux.md + the section CanvasHints pill.
// ---------------------------------------------------------------------------

const GROUPS: readonly CheatGroup[] = [
  // Ctrl+A (select all) and Ctrl+F (filter) are listed in docs/ux.md as
  // "Future — list views" and are NOT wired yet, so they're deliberately
  // omitted here until they work — a cheatsheet of dead shortcuts misleads.
  {
    heading: 'Global',
    rows: [
      {
        trigger: 'Esc',
        action:
          'Context-dependent: close dialog / panel · cancel draw, drag or marquee · peel one section interaction layer · clear selection',
      },
      { trigger: 'Ctrl + Z', action: 'Undo' },
      // App.tsx accepts BOTH Ctrl+Shift+Z and Ctrl+Y for redo — the latter
      // is muscle memory for the Windows / gINT / AutoCAD audience.
      { trigger: 'Ctrl + Shift + Z  /  Ctrl + Y', action: 'Redo' },
      { trigger: 'Ctrl + ,', action: 'Open Settings' },
      { trigger: 'F1', action: 'Open this gesture cheatsheet' },
    ],
  },
  {
    heading: 'Lists & sidebar',
    rows: [
      { trigger: 'Click row', action: 'Select / open detail (single-select)' },
      {
        trigger: 'Checkbox',
        action: 'Multi-select — always visible, left of the row icon',
      },
      {
        trigger: 'Hover → X',
        action: 'Remove one row (project-local hide, never a DB delete)',
      },
      {
        trigger: 'Delete / Backspace',
        action: 'Remove the checked selection (project-local)',
      },
    ],
  },
  {
    heading: 'Map',
    rows: [
      {
        trigger: 'Drag a rectangle',
        action: 'Draw the import bounding box (crosshair mode)',
      },
      { trigger: 'Esc', action: 'Cancel the bbox draw' },
      { trigger: 'Click marker', action: 'Select + fly-to at zoom 17' },
      { trigger: 'Hover marker', action: 'Tooltip — name + key fact' },
    ],
  },
  {
    heading: 'Borehole log & charts',
    rows: [
      { trigger: 'Ctrl + wheel', action: 'Zoom the vertical depth scale' },
      { trigger: 'Ctrl + 0', action: 'Reset zoom to 100%' },
      { trigger: 'Wheel', action: 'Scroll vertically' },
      { trigger: 'Click sample', action: 'Select + auto-center its depth' },
    ],
  },
  {
    heading: 'Sections — canvas',
    rows: [
      { trigger: 'Drag', action: 'Pan the viewport' },
      { trigger: 'Scroll', action: 'Zoom' },
      { trigger: 'Right-click a column', action: 'Focus that column (section-local)' },
      { trigger: 'Double-click a column', action: 'Open the investigation' },
      {
        trigger: 'Shift + drag (anywhere)',
        action: 'Marquee select — additive, preserves the existing selection',
      },
      { trigger: 'Click empty background', action: 'Clear the contact selection' },
      // Owner 2026-08-14: a one-key clear-the-view for the lab-sample markers
      // (litho + geotech axes); the grain-size hover preview stays menu-only.
      { trigger: 'P', action: 'Show / hide the lab-sample markers' },
      // Owner 2026-08-15: "toggling quite often when doing step 1" — the litho
      // fill earns its own key. Axis-aware: the geotech axis's "Show litho
      // fill", the litho axis's "Fill bands"; nothing on the geology axis.
      { trigger: 'L', action: 'Show / hide the litho fill (litho + geotech axes)' },
      // Owner 2026-08-15: "Turn the fill on (l this is for litho fill so this
      // wouldn't work)" — the packing fill is a second toggle he flips as
      // often, so it gets a second key. Geotech axis only.
      { trigger: 'F', action: 'Show / hide the packing (NAD) fill (geotech axis)' },
    ],
  },
  {
    heading: 'Sections — contacts',
    rows: [
      {
        trigger: 'Click a contact line',
        action: 'Select + start drag; cursor on release = new (column, depth)',
      },
      {
        trigger: 'Ctrl / Cmd + click',
        action: 'Toggle this contact in / out of the selection (no drag)',
      },
      {
        trigger: 'Shift + click',
        action: 'Range-select shallow → deep within the source anchor',
      },
      {
        trigger: 'Drag cross-column (no Alt)',
        action: 'COPY — stamp new contact(s) on the target anchor; originals stay',
      },
      {
        trigger: 'Alt + drag cross-column',
        action: 'MOVE — re-anchors the existing contact(s) to the target column',
      },
      {
        trigger: 'Drag same-column',
        action: 'Re-pick depth (or shift all selected depths)',
      },
      { trigger: 'Right-click a contact', action: 'Delete the contact (confirm)' },
    ],
  },
  {
    heading: 'Sections — Litho axis',
    rows: [
      { trigger: 'Double-click a litho layer', action: 'Accept the suggestion' },
      {
        trigger: 'Alt + drag (litho layer)',
        action: 'Copy the composition onto a nearby test',
      },
      {
        trigger: 'Shift + drag past neighbour midpoint',
        action: 'Absorb the layer into its neighbour',
      },
      {
        trigger: 'Right-click a litho band',
        action: 'More actions — remove this unit, link to geology, …',
      },
      { trigger: 'Right-click empty space', action: 'Add a new suggestion here' },
    ],
  },
  {
    heading: 'Detail panel (inspector)',
    rows: [
      {
        trigger: 'Single-click an item',
        action: 'Open the inspector (push-mode, non-modal)',
      },
      { trigger: 'Esc / X', action: 'Close the inspector' },
      { trigger: '← / →', action: 'Previous / next item' },
    ],
  },
]

interface Props {
  open: boolean
  onClose: () => void
}

/**
 * Searchable, area-grouped reference of every gesture and keyboard shortcut.
 *
 * Parameters
 * ----------
 * open
 *     Whether the dialog is shown. When false the component renders nothing.
 * onClose
 *     Called when the user dismisses the dialog (X button, Esc, or backdrop
 *     click — the last two are wired by the shared ``Modal``).
 */
export default function CheatsheetDialog({ open, onClose }: Props): JSX.Element {
  const t = useT()
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // Reset the filter and focus the search box each time the dialog opens, so
  // a stale query from a previous session never hides rows on reopen and the
  // user can type immediately (docs/ux.md: the caller owns default focus).
  useEffect(() => {
    if (open) {
      setQuery('')
      // The input mounts with the portal on the same tick; focus after paint.
      const id = requestAnimationFrame(() => inputRef.current?.focus())
      return () => cancelAnimationFrame(id)
    }
    return undefined
  }, [open])

  // Filter rows by trigger + action against the normalised query. Groups with
  // no surviving rows are dropped so the layout collapses around matches.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return GROUPS
    return GROUPS.map(g => ({
      ...g,
      rows: g.rows.filter(
        r =>
          r.trigger.toLowerCase().includes(q) ||
          r.action.toLowerCase().includes(q),
      ),
    })).filter(g => g.rows.length > 0)
  }, [query])

  return (
    <Modal
      open={open}
      onCancel={onClose}
      labelledBy="cheatsheet-title"
      cardClassName="w-[760px] max-h-[85vh] flex flex-col"
      testid="cheatsheet-dialog"
    >
      <div className="flex flex-col flex-1 min-h-0">
        {/* Header: title + X close. */}
        <div className="px-6 pt-5 pb-3 border-b border-border-subtle flex items-center gap-2">
          <Keyboard size={16} className="text-text-muted" />
          <h2
            id="cheatsheet-title"
            className="text-base font-semibold text-text-primary flex-1"
          >
            {t('cheatsheet.title')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            data-testid="cheatsheet-close"
            aria-label={t('cheatsheet.close')}
            className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-surface-card"
          >
            <X size={16} />
          </button>
        </div>

        {/* Search box. */}
        <div className="px-6 py-3 border-b border-border-subtle">
          <div className="relative">
            <Search
              size={14}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none"
            />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              data-testid="cheatsheet-search"
              placeholder={t('cheatsheet.searchPlaceholder')}
              aria-label={t('cheatsheet.search')}
              className="w-full border border-border-default rounded pl-8 pr-3 py-1.5 text-sm bg-surface-overlay text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
        </div>

        {/* Grouped rows. */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          {filtered.length === 0 ? (
            <div
              data-testid="cheatsheet-no-results"
              className="flex flex-col items-center gap-2 text-text-muted py-10 text-center"
            >
              <SearchX size={20} />
              <p className="text-sm">{t('cheatsheet.noMatch', { query: query.trim() })}</p>
            </div>
          ) : (
            filtered.map(group => (
              <div key={group.heading}>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-text-secondary mb-2">
                  {group.heading}
                </h3>
                {/* Two-column grid so long triggers wrap inside the fixed
                    first column without breaking the action column's
                    alignment (keeps the cheatsheet scannable). */}
                <div className="space-y-1">
                  {group.rows.map(row => (
                    <div
                      key={`${row.trigger}|${row.action}`}
                      className="grid grid-cols-[13rem_1fr] items-start gap-3 text-xs"
                    >
                      <kbd className="px-1.5 py-0.5 rounded border border-border-default bg-surface-card text-text-primary font-mono text-[11px] leading-snug break-words">
                        {row.trigger}
                      </kbd>
                      <span className="text-text-secondary leading-snug pt-0.5">
                        {row.action}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </Modal>
  )
}
