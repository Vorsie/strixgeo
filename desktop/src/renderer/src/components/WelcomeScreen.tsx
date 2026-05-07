import { useState } from 'react'
import Button from './ui/Button'

interface Props {
  onCreateProject: (name: string) => void
}

export default function WelcomeScreen({ onCreateProject }: Props) {
  const [name, setName] = useState('')

  function handleCreate() {
    const trimmed = name.trim()
    if (!trimmed) return
    onCreateProject(trimmed)
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter') handleCreate()
  }

  return (
    <div className="flex items-center justify-center h-screen bg-gray-50">
      <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-8 w-96">
        <h1 className="text-lg font-semibold text-gray-800 mb-1">Ground Model</h1>
        <p className="text-sm text-gray-500 mb-6">
          Create a new project to start importing and analysing CPT data.
        </p>

        <label className="block text-xs font-medium text-gray-600 mb-1">Project name</label>
        <input
          autoFocus
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={handleKey}
          placeholder="e.g. GEO-22/040 Brugge"
          className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 mb-4"
        />

        <Button variant="primary" size="md" className="w-full" onClick={handleCreate} disabled={!name.trim()}>
          Create project
        </Button>

        <p className="text-[10px] text-gray-400 mt-4 text-center">
          Open project from file will be available in a future release.
        </p>
      </div>
    </div>
  )
}
