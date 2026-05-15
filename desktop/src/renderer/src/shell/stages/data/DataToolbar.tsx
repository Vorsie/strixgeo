// Data stage toolbar — import actions wired from the ShellContext bus.
//
// Reproduces the import dropdown from Toolbar.tsx, now sourcing
// ``onImportCpt`` / ``onImportDov`` / ``onImportBoreholeDov`` / ``importing``
// / ``drawingBbox`` from ``useShell().investigations`` and
// ``useShell().investigations.bboxImportType``.
//
// The ThemeToggle from the old Toolbar.tsx moves to the StageToolbar right
// zone (committed in a subsequent step). This file owns only the stage-
// specific import verbs.

import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Upload, Loader2 } from 'lucide-react'

import { useShell } from '../../ShellContext'

/**
 * Import action verbs for the Data stage toolbar.
 *
 * Rendered in the left zone of ``StageToolbar`` when the Data stage is
 * active.  Reads import state and handlers from ``useShell().investigations``
 * — no props required (matches the ``StageDescriptor.ToolbarComponent``
 * contract).
 *
 * Returns
 * -------
 * JSX.Element
 *     The toolbar verb buttons element.
 */
export default function DataToolbar(): JSX.Element {
  const {
    investigations: {
      importing,
      dovImporting,
      bboxImportType,
      handleImportCpt,
      handleImportDov,
      handleImportBoreholeDov,
    },
  } = useShell()

  const isImporting = importing || dovImporting
  const drawingBbox = bboxImportType !== null

  const importActions: ImportAction[] = [
    { label: 'Import CPT (.gef)', available: true, onClick: handleImportCpt },
    { label: 'Import CPT from DOV (draw bbox)', available: true, onClick: handleImportDov },
    {
      label: 'Import Borehole from DOV (draw bbox)',
      available: true,
      onClick: handleImportBoreholeDov,
    },
    { label: 'Import DMT', available: false },
    { label: 'Import Lab Test', available: false },
    { label: 'Import Monitoring', available: false },
  ]

  return (
    <DropdownMenu
      label={drawingBbox ? 'Drawing bbox…' : 'Import'}
      icon={
        isImporting ? (
          <Loader2 size={13} className="animate-spin" />
        ) : (
          <Upload size={13} />
        )
      }
      highlight={!isImporting && !drawingBbox}
    >
      {importActions.map(action => (
        <MenuItem
          key={action.label}
          label={action.label}
          disabled={!action.available || isImporting}
          dimmed={!action.available}
          onClick={action.onClick}
          tag={!action.available ? 'Phase 4' : undefined}
        />
      ))}
    </DropdownMenu>
  )
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface ImportAction {
  label: string
  available: boolean
  onClick?: () => void
}

// ---------------------------------------------------------------------------
// Dropdown — identical in shape to the one in the (now-deleted) Toolbar.tsx;
// kept local so this stage is self-contained. This is the SECOND copy of
// the pattern in the codebase's history (Toolbar's was the first, now gone,
// so effectively one live copy). Extraction window: if a second live
// toolbar stage (e.g. SectionsToolbar) needs the same dropdown, lift
// DropdownMenu/MenuItem to components/ui/ then — per the project's
// extract-on-the-second-live-copy rule. Not before (one copy ≠ duplication).
// ---------------------------------------------------------------------------

interface DropdownMenuProps {
  label: string
  icon?: React.ReactNode
  highlight?: boolean
  children: React.ReactNode
}

function DropdownMenu({ label, icon, highlight, children }: DropdownMenuProps) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      const t = e.target as Node
      // The menu is portalled to <body>, so the trigger's wrapper does
      // NOT contain it — check both the button and the menu explicitly.
      if (btnRef.current?.contains(t) || menuRef.current?.contains(t)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  function toggle(): void {
    setOpen(o => {
      const next = !o
      // Anchor the portalled menu under the button. Portalled +
      // position:fixed so it escapes StageToolbar's `overflow-hidden`
      // left zone (a plain absolute menu was clipped to the 40px-tall
      // toolbar — the import menu was invisible).
      if (next && btnRef.current) {
        const r = btnRef.current.getBoundingClientRect()
        setPos({ top: r.bottom + 2, left: r.left })
      }
      return next
    })
  }

  return (
    <div className="relative">
      <button
        ref={btnRef}
        onClick={toggle}
        className={[
          'flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors',
          open
            ? 'bg-surface-app text-text-primary'
            : highlight
            ? 'text-accent hover:bg-surface-app'
            : 'text-text-secondary hover:bg-surface-app',
        ].join(' ')}
      >
        {icon}
        {label}
        <ChevronDown size={11} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            style={{ position: 'fixed', top: pos.top, left: pos.left }}
            // z above the toast stack (z-[1100]) so it's never occluded.
            className="w-56 bg-surface-overlay border border-border-subtle rounded shadow-lg z-[1200] py-1"
            onClick={() => setOpen(false)}
          >
            {children}
          </div>,
          document.body,
        )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Menu item
// ---------------------------------------------------------------------------

interface MenuItemProps {
  label: string
  disabled?: boolean
  dimmed?: boolean
  tag?: string
  onClick?: () => void
}

function MenuItem({ label, disabled, dimmed, tag, onClick }: MenuItemProps) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={[
        'w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors',
        disabled ? 'cursor-not-allowed' : 'hover:bg-surface-card active:bg-surface-card',
        dimmed ? 'text-text-muted' : 'text-text-primary',
      ].join(' ')}
    >
      <span className="flex-1">{label}</span>
      {tag && (
        <span className="text-[9px] bg-surface-card text-text-muted px-1 py-0.5 rounded">{tag}</span>
      )}
    </button>
  )
}
