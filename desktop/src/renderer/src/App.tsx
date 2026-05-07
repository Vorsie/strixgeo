import { useEffect, useState, useCallback, useRef } from 'react'
import { Map as MapIcon, BarChart2, AlertTriangle, CheckCircle } from 'lucide-react'
import { api, setBaseUrl, DuplicateCptError } from './api/client'
import type { CptListItem, CptResponse, CptPlotResponse } from './api/client'
import { useProject } from './hooks/useProject'
import Toolbar from './components/Toolbar'
import Sidebar from './components/Sidebar'
import MapView from './components/MapView'
import CptChart from './components/CptChart'
import WelcomeScreen from './components/WelcomeScreen'

declare global {
  interface Window {
    electron: {
      getApiBaseUrl: () => Promise<string>
      waitForApi: () => Promise<boolean>
      openFile: (filters: Electron.FileFilter[]) => Promise<string | null>
      openFiles: (filters: Electron.FileFilter[]) => Promise<string[]>
      readFile: (filePath: string) => Promise<Buffer>
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
  const { project, createProject } = useProject()

  const [ready, setReady] = useState(false)
  const [apiError, setApiError] = useState(false)
  const [cpts, setCpts] = useState<CptListItem[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detailMap, setDetailMap] = useState<Map<string, CptResponse>>(new Map())
  const [plotMap, setPlotMap] = useState<Map<string, CptPlotResponse>>(new Map())
  const [view, setView] = useState<View>('map')
  const [importing, setImporting] = useState(false)
  const [toasts, setToasts] = useState<Toast[]>([])
  const toastId = useRef(0)

  // ---------------------------------------------------------------------------
  // Boot — wait for API regardless of project state
  // ---------------------------------------------------------------------------

  useEffect(() => {
    async function boot() {
      const base = await window.electron.getApiBaseUrl()
      setBaseUrl(base)
      const ok = await window.electron.waitForApi()
      if (ok) setReady(true)
      else setApiError(true)
    }
    boot()
  }, [])

  // Load CPTs whenever the API is ready and a project is selected
  useEffect(() => {
    if (ready && project) refreshList()
  }, [ready, project?.id])

  // Wire Electron menu → import
  useEffect(() => {
    const off = window.electron.onMenuImportCpt(handleImportCpt)
    return off
  }, [])

  // ---------------------------------------------------------------------------
  // Data loading
  // ---------------------------------------------------------------------------

  const refreshList = useCallback(async () => {
    if (!project) return
    try {
      const list = await api.cpt.list(project.id)
      setCpts(list)
      for (const c of list) {
        if (!detailMap.has(c.id)) {
          api.cpt.get(c.id).then(detail => {
            setDetailMap(prev => new Map(prev).set(c.id, detail))
          })
        }
      }
    } catch {
      toast('error', 'Failed to load CPT list')
    }
  }, [detailMap, project])

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
    if (!project) return
    const filePaths = await window.electron.openFiles([
      { name: 'GEF Files', extensions: ['gef'] },
      { name: 'All Files', extensions: ['*'] }
    ])
    if (filePaths.length === 0) return

    setImporting(true)
    try {
      const results = await Promise.allSettled(
        filePaths.map(fp => api.cpt.import(fp, project.id))
      )

      let imported = 0, warnings = 0, duplicates = 0, errors = 0
      let firstId: string | null = null

      for (const r of results) {
        if (r.status === 'fulfilled') {
          if (r.value.has_errors) warnings++
          else imported++
          firstId ??= r.value.cpt_id
        } else if (r.reason instanceof DuplicateCptError) {
          duplicates++
          firstId ??= r.reason.cptId
        } else {
          errors++
        }
      }

      const ok = imported + warnings
      const parts: string[] = []
      if (ok > 0) parts.push(`${ok} imported${warnings > 0 ? ` (${warnings} with warnings)` : ''}`)
      if (duplicates > 0) parts.push(`${duplicates} already existed`)
      if (errors > 0) parts.push(`${errors} failed`)
      toast(errors > 0 && ok === 0 ? 'error' : 'success', parts.join(', '))

      await refreshList()
      if (firstId) {
        setSelectedId(firstId)
        await loadChart(firstId)
        if (filePaths.length === 1) setView('chart')
      }
    } finally {
      setImporting(false)
    }
  }, [project, refreshList, loadChart])

  // ---------------------------------------------------------------------------
  // Delete
  // ---------------------------------------------------------------------------

  const handleDelete = useCallback(async (id: string) => {
    try {
      await api.cpt.delete(id)
      setCpts(prev => prev.filter(c => c.id !== id))
      setDetailMap(prev => { const m = new Map(prev); m.delete(id); return m })
      setPlotMap(prev => { const m = new Map(prev); m.delete(id); return m })
      if (selectedId === id) {
        setSelectedId(null)
        setView('map')
      }
      toast('success', 'CPT deleted')
    } catch {
      toast('error', 'Failed to delete CPT')
    }
  }, [selectedId])

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

  if (apiError) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-gray-100 text-gray-500 text-sm gap-2">
        <div className="text-red-500 font-medium">Failed to start the Ground Model API</div>
        <div className="text-xs text-gray-400">Check the developer console for the Python traceback.</div>
      </div>
    )
  }

  if (!ready) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-100 text-gray-500 text-sm gap-2">
        <div className="animate-spin rounded-full border-2 border-gray-300 border-t-blue-500 w-5 h-5" />
        Starting Ground Model API…
      </div>
    )
  }

  if (!project) {
    return <WelcomeScreen onCreateProject={name => createProject(name)} />
  }

  const selectedCpt = cpts.find(c => c.id === selectedId)

  return (
    <div className="flex flex-col h-screen bg-white overflow-hidden">
      <Toolbar onImportCpt={handleImportCpt} importing={importing} />

      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          cpts={cpts}
          selectedId={selectedId}
          onSelect={handleSelect}
          onDelete={handleDelete}
          projectName={project.name}
        />

        <main className="flex flex-col flex-1 overflow-hidden">
          {selectedId && (
            <div className="flex items-center gap-1 px-3 py-1 border-b border-gray-200 bg-gray-50">
              <ViewTab icon={<MapIcon size={13} />} label="Map" active={view === 'map'} onClick={() => setView('map')} />
              <ViewTab icon={<BarChart2 size={13} />} label="Chart" active={view === 'chart'} onClick={() => setView('chart')} />
            </div>
          )}

          <div className="flex-1 overflow-hidden">
            {view === 'map' || !selectedId ? (
              <MapView cpts={cpts} selectedId={selectedId} detailMap={detailMap} onSelect={handleSelect} />
            ) : (
              selectedCpt && plotMap.has(selectedId)
                ? <CptChart
                    plot={plotMap.get(selectedId)!}
                    name={selectedCpt.name}
                    detail={detailMap.get(selectedId)}
                  />
                : <div className="flex items-center justify-center h-full text-sm text-gray-400">Loading chart…</div>
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
            {t.type === 'success' ? <CheckCircle size={14} /> : <AlertTriangle size={14} />}
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
