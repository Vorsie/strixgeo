import { useState, useRef, useEffect } from 'react'
import { ChevronDown, Upload, Loader2 } from 'lucide-react'

interface ImportAction {
  label: string
  available: boolean
  onClick?: () => void
}

interface Props {
  onImportCpt: () => void
  onImportDov: () => void
  importing: boolean
  drawingBbox: boolean
}

export default function Toolbar({ onImportCpt, onImportDov, importing, drawingBbox }: Props) {
  const importActions: ImportAction[] = [
    { label: 'Import CPT (.gef)', available: true, onClick: onImportCpt },
    { label: 'Import CPT from DOV (draw bbox)', available: true, onClick: onImportDov },
    { label: 'Import Borehole', available: false },
    { label: 'Import DMT', available: false },
    { label: 'Import Lab Test', available: false },
    { label: 'Import Monitoring', available: false },
  ]

  return (
    <div className="flex items-center gap-0.5 px-2 py-1 border-b border-gray-200 bg-gray-50 select-none">
      <DropdownMenu
        label={drawingBbox ? 'Drawing bbox…' : 'Import'}
        icon={importing ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
        highlight={!importing && !drawingBbox}
      >
        {importActions.map(action => (
          <MenuItem
            key={action.label}
            label={action.label}
            disabled={!action.available || importing}
            dimmed={!action.available}
            onClick={action.onClick}
            tag={!action.available ? 'Phase 3' : undefined}
          />
        ))}
      </DropdownMenu>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Dropdown
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
// Menu items
// ---------------------------------------------------------------------------

interface MenuItemProps {
  icon?: React.ReactNode
  label: string
  shortcut?: string
  disabled?: boolean
  dimmed?: boolean
  tag?: string
  onClick?: () => void
}

function MenuItem({ icon, label, shortcut, disabled, dimmed, tag, onClick }: MenuItemProps) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={[
        'w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors',
        disabled
          ? 'cursor-not-allowed'
          : 'hover:bg-gray-50 active:bg-gray-100',
        dimmed ? 'text-gray-400' : 'text-gray-700',
      ].join(' ')}
    >
      {icon && <span className="w-4 shrink-0">{icon}</span>}
      <span className="flex-1">{label}</span>
      {shortcut && <span className="text-gray-400 text-[10px]">{shortcut}</span>}
      {tag && (
        <span className="text-[9px] bg-gray-100 text-gray-400 px-1 py-0.5 rounded">{tag}</span>
      )}
    </button>
  )
}
