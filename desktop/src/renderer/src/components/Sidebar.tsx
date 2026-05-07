import { useState } from 'react'
import { Activity, Drill, Gauge, MapPin, Trash2 } from 'lucide-react'
import type { CptListItem } from '../api/client'

type DataType = 'cpt' | 'borehole' | 'dmt'

interface Props {
  cpts: CptListItem[]
  selectedId: string | null
  onSelect: (id: string) => void
  onDelete: (id: string) => void
  projectName: string
}

const TABS: { id: DataType; label: string; icon: React.ReactNode; available: boolean }[] = [
  { id: 'cpt',      label: 'CPT',      icon: <Activity size={14} />,  available: true  },
  { id: 'borehole', label: 'Borehole', icon: <Drill size={14} />,     available: false },
  { id: 'dmt',      label: 'DMT',      icon: <Gauge size={14} />,     available: false },
]

function cptBadgeColor(type: string) {
  switch (type) {
    case 'CPTU': return 'bg-blue-100 text-blue-700'
    case 'CPTE': return 'bg-green-100 text-green-700'
    case 'CPTM': return 'bg-orange-100 text-orange-700'
    default:     return 'bg-gray-100 text-gray-500'
  }
}

export default function Sidebar({ cpts, selectedId, onSelect, onDelete, projectName }: Props) {
  const [activeTab, setActiveTab] = useState<DataType>('cpt')

  return (
    <aside className="flex flex-col w-56 shrink-0 border-r border-gray-200 bg-white overflow-hidden">
      {/* Project name */}
      <div className="px-3 py-2 border-b border-gray-200 bg-gray-50">
        <div className="text-[10px] text-gray-400 uppercase tracking-wide">Project</div>
        <div className="text-xs font-medium text-gray-700 truncate">{projectName}</div>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-gray-200">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => tab.available && setActiveTab(tab.id)}
            title={tab.available ? tab.label : `${tab.label} — Phase 3`}
            className={[
              'flex-1 flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium transition-colors',
              !tab.available ? 'text-gray-300 cursor-not-allowed' :
              activeTab === tab.id
                ? 'text-blue-600 border-b-2 border-blue-600'
                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
            ].join(' ')}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'cpt' && (
          cpts.length === 0
            ? <EmptyState label="No CPTs imported yet" />
            : cpts.map(c => (
                <CptRow
                  key={c.id}
                  cpt={c}
                  selected={c.id === selectedId}
                  onClick={() => onSelect(c.id)}
                  onDelete={() => onDelete(c.id)}
                />
              ))
        )}
        {activeTab !== 'cpt' && (
          <EmptyState label="Available in Phase 3" />
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-gray-100 px-3 py-1.5 text-[10px] text-gray-400">
        {activeTab === 'cpt' ? `${cpts.length} CPT${cpts.length !== 1 ? 's' : ''}` : '—'}
      </div>
    </aside>
  )
}

function CptRow({
  cpt,
  selected,
  onClick,
  onDelete,
}: {
  cpt: CptListItem
  selected: boolean
  onClick: () => void
  onDelete: () => void
}) {
  function handleDelete(e: React.MouseEvent) {
    e.stopPropagation()
    if (window.confirm(`Delete "${cpt.name}"? This cannot be undone.`)) {
      onDelete()
    }
  }

  return (
    <div
      className={[
        'group relative border-b border-gray-100 transition-colors',
        selected ? 'bg-blue-50' : 'hover:bg-gray-50'
      ].join(' ')}
    >
      <button onClick={onClick} className="w-full text-left px-3 py-2 pr-8">
        <div className="flex items-center gap-1.5 mb-0.5">
          <MapPin size={11} className={selected ? 'text-blue-500' : 'text-gray-400'} />
          <span className="text-xs font-medium text-gray-800 truncate">{cpt.name}</span>
        </div>
        <div className="flex items-center gap-1.5 pl-4">
          <span className={`text-[10px] px-1 rounded font-mono ${cptBadgeColor(cpt.cpt_type)}`}>
            {cpt.cpt_type}
          </span>
          {cpt.max_depth_m != null && (
            <span className="text-[10px] text-gray-400">{cpt.max_depth_m.toFixed(1)} m</span>
          )}
        </div>
      </button>

      {/* Delete button — visible on hover */}
      <button
        onClick={handleDelete}
        title="Delete CPT"
        className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded text-gray-300 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <Trash2 size={12} />
      </button>
    </div>
  )
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center h-24 text-xs text-gray-400 px-4 text-center">
      {label}
    </div>
  )
}
