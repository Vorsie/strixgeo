import { useEffect, useState, useCallback, useRef } from 'react'
import { Map as MapIcon, BarChart2, AlertTriangle, CheckCircle } from 'lucide-react'
import { api, setBaseUrl } from './api/client'
import type { CptListItem, CptResponse, CptPlotResponse } from './api/client'
import Toolbar from './components/Toolbar'
import Sidebar from './components/Sidebar'
import MapView from './components/MapView'
import CptChart from './components/CptChart'

declare global {
  interface Window {
    electron: {
      getApiBaseUrl: () => Promise<string>
      waitForApi: () => Promise<boolean>
      openFile: (filters: Electron.FileFilter[]) => Promise<string | null>
      onMenuImportCpt: (cb: () => void) => () => void
      onMenuImportBorehole: (cb: () => void) => () => void
    }
  }
}

type View = 'map' | 'chart'

interface Toast {
  id: number
  type: 'success' | 'error'
  message: string
}

export default function App() {
  const [ready, setReady] = useState(false)
  const [cpts, setCpts] = useState<CptListItem[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detailMap, setDetailMap] = useState<Map<string, CptResponse>>(new Map())
  const [plotMap, setPlotMap] = useState<Map<string, CptPlotResponse>>(new Map())
  const [view, setView] = useState<View>('map')
  const [importing, setImporting] = useState(false)
  const [toasts, setToasts] = useState<Toast[]>([])
  const toastId = useRef(0)

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------

  useEffect(() => {
    async function boot() {
      const base = await window.electron.getApiBaseUrl()
      setBaseUrl(base)
      const ok = await window.electron.waitForApi()
      if (ok) {
        setReady(true)
        await refreshList()
      }
    }
    boot()
  }, [])

  // Wire menu → import action
  useEffect(() => {
    const off = window.electron.onMenuImportCpt(handleImportCpt)
    return off
  }, [])

  // ---------------------------------------------------------------------------
  // Data loading
  // ---------------------------------------------------------------------------

  const refreshList = useCallback(async () => {
    try {
      const list = await api.cpt.list()
      setCpts(list)
      // Load detail (location) for any CPTs we don't have yet
      for (const c of list) {
        if (!detailMap.has(c.id)) {
          api.cpt.get(c.id).then(detail => {
            setDetailMap(prev => new Map(prev).set(c.id, detail))
          })
        }
      }
    } catch (e) {
      toast('error', 'Failed to load CPT list')
    }
  }, [detailMap])

  const loadChart = useCallback(async (id: string) => {
    if (plotMap.has(id)) return
    try {
      const plot = await api.cpt.plot(id)
      setPlotMap(prev => new Map(prev).set(id, plot))
    } catch {
      toast('error', 'Failed to load chart data')
    }
  }, [plotMap])

  // ---------------------------------------------------------------------------
  // Selection
  // ---------------------------------------------------------------------------

  const handleSelect = useCallback(async (id: string) => {
    setSelectedId(id)
    await loadChart(id)
    setView('chart')
  }, [loadChart])

  // ---------------------------------------------------------------------------
  // Import
  // ---------------------------------------------------------------------------

  const handleImportCpt = useCallback(async () => {
    const filePath = await window.electron.openFile([
      { name: 'GEF Files', extensions: ['gef'] },
      { name: 'All Files', extensions: ['*'] }
    ])
    if (!filePath) return

    setImporting(true)
    try {
      const result = await api.cpt.import(filePath)
      if (result.has_errors) {
        const codes = result.issues.filter(i => i.level === 'error').map(i => i.code).join(', ')
        toast('error', `Imported with errors: ${codes}`)
      } else {
        toast('success', 'CPT imported successfully')
      }
      await refreshList()
      setSelectedId(result.cpt_id)
      await loadChart(result.cpt_id)
      setView('chart')
    } catch (e) {
      toast('error', `Import failed: ${e instanceof Error ? e.message : 'unknown error'}`)
    } finally {
      setImporting(false)
    }
  }, [refreshList, loadChart])

  // ---------------------------------------------------------------------------
  // Toasts
  // ---------------------------------------------------------------------------

  function toast(type: 'success' | 'error', message: string) {
    const id = ++toastId.current
    setToasts(prev => [...prev, { id, type, message }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000)
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (!ready) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-100 text-gray-500 text-sm gap-2">
        <div className="animate-spin rounded-full border-2 border-gray-300 border-t-blue-500 w-5 h-5" />
        Starting Ground Model API…
      </div>
    )
  }

  const selectedCpt = cpts.find(c => c.id === selectedId)

  return (
    <div className="flex flex-col h-screen bg-white overflow-hidden">
      <Toolbar onImportCpt={handleImportCpt} importing={importing} />

      <div className="flex flex-1 overflow-hidden">
        <Sidebar cpts={cpts} selectedId={selectedId} onSelect={handleSelect} />

        {/* Main content */}
        <main className="flex flex-col flex-1 overflow-hidden">
          {/* View switcher — only shown when a CPT is selected */}
          {selectedId && (
            <div className="flex items-center gap-1 px-3 py-1 border-b border-gray-200 bg-gray-50">
              <ViewTab
                icon={<MapIcon size={13} />}
                label="Map"
                active={view === 'map'}
                onClick={() => setView('map')}
              />
              <ViewTab
                icon={<BarChart2 size={13} />}
                label="Chart"
                active={view === 'chart'}
                onClick={() => setView('chart')}
              />
            </div>
          )}

          <div className="flex-1 overflow-hidden">
            {view === 'map' || !selectedId ? (
              <MapView
                cpts={cpts}
                selectedId={selectedId}
                detailMap={detailMap}
                onSelect={handleSelect}
              />
            ) : (
              selectedCpt && plotMap.has(selectedId)
                ? <CptChart plot={plotMap.get(selectedId)!} name={selectedCpt.name} />
                : <div className="flex items-center justify-center h-full text-sm text-gray-400">
                    Loading chart…
                  </div>
            )}
          </div>
        </main>
      </div>

      {/* Toast stack */}
      <div className="fixed bottom-4 right-4 flex flex-col gap-2 z-50">
        {toasts.map(t => (
          <div
            key={t.id}
            className={[
              'flex items-center gap-2 px-3 py-2 rounded shadow-lg text-sm text-white',
              t.type === 'success' ? 'bg-green-600' : 'bg-red-600'
            ].join(' ')}
          >
            {t.type === 'success'
              ? <CheckCircle size={14} />
              : <AlertTriangle size={14} />}
            {t.message}
          </div>
        ))}
      </div>
    </div>
  )
}

function ViewTab({ icon, label, active, onClick }: {
  icon: React.ReactNode; label: string; active: boolean; onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={[
        'flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition-colors',
        active ? 'bg-white border border-gray-200 shadow-sm text-gray-800' : 'text-gray-500 hover:text-gray-700'
      ].join(' ')}
    >
      {icon}
      {label}
    </button>
  )
}
