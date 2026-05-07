import { FolderOpen, Save, Upload, Loader2 } from 'lucide-react'

interface Props {
  onImportCpt: () => void
  importing: boolean
}

export default function Toolbar({ onImportCpt, importing }: Props) {
  return (
    <div className="flex items-center gap-1 px-2 py-1 border-b border-gray-200 bg-gray-50 select-none">
      {/* Standard file operations — placeholders for future project save/open */}
      <ToolButton icon={<FolderOpen size={15} />} label="Open" disabled />
      <ToolButton icon={<Save size={15} />} label="Save" disabled />

      <div className="w-px h-5 bg-gray-300 mx-1" />

      {/* Import actions */}
      <ToolButton
        icon={importing ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
        label="Import CPT"
        onClick={onImportCpt}
        disabled={importing}
        primary
      />
      <ToolButton icon={<Upload size={15} />} label="Import Borehole" disabled />
      <ToolButton icon={<Upload size={15} />} label="Import DMT" disabled />
    </div>
  )
}

interface BtnProps {
  icon: React.ReactNode
  label: string
  onClick?: () => void
  disabled?: boolean
  primary?: boolean
}

function ToolButton({ icon, label, onClick, disabled, primary }: BtnProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      className={[
        'flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors',
        disabled
          ? 'text-gray-400 cursor-not-allowed'
          : primary
          ? 'text-blue-700 hover:bg-blue-50 active:bg-blue-100'
          : 'text-gray-600 hover:bg-gray-200 active:bg-gray-300',
      ].join(' ')}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  )
}
