import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Clock } from 'lucide-react'
import Button from './ui/Button'

interface RecentEntry {
  path: string
  name: string
  lastOpened: string
}

interface Props {
  // Caller decides what metadata to gather. Today the welcome screen
  // collects only the name; richer fields live in the project-metadata
  // editor that opens after creation.
  onCreateProject: (name: string) => Promise<void> | void
  onOpenProject: () => Promise<void> | void
  // Click handler for a recent-projects entry. Receives the file path
  // and returns whether the open succeeded — when it didn't (most
  // commonly because the DB row is gone) the welcome screen surfaces
  // an inline banner and refreshes the recent list so the stale entry
  // disappears.
  onOpenRecent: (path: string) => Promise<boolean>
}

export default function WelcomeScreen({
  onCreateProject,
  onOpenProject,
  onOpenRecent,
}: Props) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [recent, setRecent] = useState<RecentEntry[]>([])
  const [openError, setOpenError] = useState<string | null>(null)

  const refreshRecent = useCallback(() => {
    window.electron
      .getRecentProjects()
      .then(setRecent)
      .catch(() => setRecent([]))
  }, [])

  // Load the recent list on mount. Fire-and-forget; an empty list just
  // hides the section. Errors here aren't worth surfacing to the user —
  // the New + Open buttons are always available.
  useEffect(() => {
    refreshRecent()
  }, [refreshRecent])

  async function handleCreate(): Promise<void> {
    const trimmed = name.trim()
    if (!trimmed || busy) return
    setBusy(true)
    try {
      await onCreateProject(trimmed)
    } finally {
      setBusy(false)
    }
  }

  async function handleOpen(): Promise<void> {
    if (busy) return
    setBusy(true)
    try {
      await onOpenProject()
    } finally {
      setBusy(false)
    }
  }

  async function handleRecent(path: string): Promise<void> {
    if (busy) return
    setBusy(true)
    setOpenError(null)
    try {
      const ok = await onOpenRecent(path)
      if (!ok) {
        const entry = recent.find(r => r.path === path)
        setOpenError(
          entry
            ? `Couldn't open "${entry.name}". The project may have been removed from the database.`
            : `Couldn't open the project file. It may have been removed from the database.`,
        )
        refreshRecent()
      }
    } finally {
      setBusy(false)
    }
  }

  function handleKey(e: React.KeyboardEvent): void {
    if (e.key === 'Enter') void handleCreate()
  }

  return (
    <div className="flex items-center justify-center h-screen bg-gray-50">
      <div className="flex flex-col gap-3 max-w-[800px]">
        {openError !== null && (
          <div
            role="alert"
            className="flex items-start gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded text-sm text-amber-900"
          >
            <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-600" />
            <div className="flex-1">{openError}</div>
            <button
              onClick={() => setOpenError(null)}
              className="text-amber-700 hover:text-amber-900 text-xs"
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        )}
        <div className="flex gap-6">
        {/* Create / Open column */}
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-8 w-96">
          <h1 className="text-lg font-semibold text-gray-800 mb-1">Ground Model</h1>
          <p className="text-sm text-gray-500 mb-6">
            Open an existing project file or create a new one to start importing
            and analysing data.
          </p>

          <label
            htmlFor="welcome-project-name"
            className="block text-xs font-medium text-gray-600 mb-1"
          >
            Project name
          </label>
          <input
            autoFocus
            id="welcome-project-name"
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={handleKey}
            placeholder="e.g. GEO-22/040 Brugge"
            disabled={busy}
            className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 mb-4 disabled:bg-gray-50"
          />

          <Button
            variant="primary"
            size="md"
            className="w-full"
            onClick={() => void handleCreate()}
            disabled={!name.trim() || busy}
          >
            Create project…
          </Button>

          {/* Visual divider between the two entry points. */}
          <div className="flex items-center gap-2 my-3 text-[10px] text-gray-400">
            <span className="flex-1 border-t border-gray-200" />
            <span>or</span>
            <span className="flex-1 border-t border-gray-200" />
          </div>

          <Button
            variant="secondary"
            size="md"
            className="w-full"
            onClick={() => void handleOpen()}
            disabled={busy}
          >
            Open project from file…
          </Button>
        </div>

        {/* Recent projects column. Hidden when there are no recent
            entries — first-launch users shouldn't see an empty
            placeholder hugging the create card. */}
        {recent.length > 0 && (
          <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-6 w-80 flex flex-col">
            <div className="flex items-center gap-1.5 mb-3">
              <Clock size={13} className="text-gray-400" />
              <h2 className="text-xs font-medium uppercase tracking-wide text-gray-500">
                Recent projects
              </h2>
            </div>
            <ul className="flex flex-col gap-1 overflow-y-auto max-h-80 -mx-2">
              {recent.map(entry => (
                <li key={entry.path}>
                  <button
                    onClick={() => void handleRecent(entry.path)}
                    disabled={busy}
                    title={entry.path}
                    className="w-full text-left px-2 py-1.5 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed group"
                  >
                    <div className="text-sm text-gray-800 truncate">{entry.name}</div>
                    <div className="text-[10px] text-gray-400 truncate font-mono">
                      {entry.path}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        </div>
      </div>
    </div>
  )
}
