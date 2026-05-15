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
// Dropdown — identical in shape to the one in Toolbar.tsx; kept here to
// avoid importing from a file we're about to delete, and to keep this
// stage self-contained.
// ---------------------------------------------------------------------------

interface DropdownMenuProps {
  label: string
  icon?: React.ReactNode
  highlight?: boolean
  children: React.ReactNode
}

function DropdownMenu({ label, icon, highlight, children }: DropdownMenuProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className={[
          'flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors',
          open
            ? 'bg-gray-200 text-gray-800'
            : highlight
            ? 'text-blue-700 hover:bg-blue-50'
            : 'text-gray-600 hover:bg-gray-200',
        ].join(' ')}
      >
        {icon}
        {label}
        <ChevronDown size={11} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          className="absolute top-full left-0 mt-0.5 w-52 bg-white border border-gray-200 rounded shadow-lg z-50 py-1"
          onClick={() => setOpen(false)}
        >
          {children}
        </div>
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
        disabled ? 'cursor-not-allowed' : 'hover:bg-gray-50 active:bg-gray-100',
        dimmed ? 'text-gray-400' : 'text-gray-700',
      ].join(' ')}
    >
      <span className="flex-1">{label}</span>
      {tag && (
        <span className="text-[9px] bg-gray-100 text-gray-400 px-1 py-0.5 rounded">{tag}</span>
      )}
    </button>
  )
}
