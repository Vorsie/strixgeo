import { useState } from 'react'
import Button from './ui/Button'

interface Props {
  // Caller decides what metadata to gather. Today the welcome screen
  // collects only the name; richer fields live in the project-metadata
  // editor that opens after creation.
  onCreateProject: (name: string) => Promise<void> | void
  onOpenProject: () => Promise<void> | void
}

export default function WelcomeScreen({ onCreateProject, onOpenProject }: Props) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

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

  function handleKey(e: React.KeyboardEvent): void {
    if (e.key === 'Enter') void handleCreate()
  }

  return (
    <div className="flex items-center justify-center h-screen bg-gray-50">
      <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-8 w-96">
        <h1 className="text-lg font-semibold text-gray-800 mb-1">Ground Model</h1>
        <p className="text-sm text-gray-500 mb-6">
          Open an existing project file or create a new one to start importing
          and analysing data.
        </p>

        <label className="block text-xs font-medium text-gray-600 mb-1">Project name</label>
        <input
          autoFocus
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

        {/* Visual divider between the two entry points. The "or" copy
            sits flush with the line so we don't waste vertical space; an
            "Open existing project" affordance is one of the most-clicked
            things on this screen for repeat users. */}
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
    </div>
  )
}
