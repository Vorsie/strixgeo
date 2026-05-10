// Minimal new-project dialog. MVP for the multi-project flow: just the
// name field. The full metadata editor (project number, client, site,
// description, tags, default CRSes, phase, status) lands in a follow-up
// — at that point this becomes the "create" mode of a unified
// CreateOrEditProjectDialog.
//
// Replaces the failed ``window.prompt`` call: Electron's renderer
// process disables ``prompt()`` for security, which is why the previous
// path threw 'prompt() is not supported' the moment the user picked
// File → New Project.

import { useEffect, useRef, useState } from 'react'

import Button from './ui/Button'
import { isTypingTarget } from '../utils/keyboard'

interface Props {
  open: boolean
  onSubmit: (name: string) => Promise<void> | void
  onCancel: () => void
}

export default function NewProjectDialog({ open, onSubmit, onCancel }: Props) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Reset + auto-focus on open. Without the reset the dialog would
  // remember the last typed name across cancels — surprising.
  useEffect(() => {
    if (!open) return
    setName('')
    setBusy(false)
    // Focus on the next tick so the input is mounted before we ask.
    const timer = setTimeout(() => inputRef.current?.focus(), 0)
    return () => clearTimeout(timer)
  }, [open])

  // Esc closes the dialog from anywhere except inside an input where
  // Esc has its own meaning (cancelling autocomplete, etc.). Since the
  // input here doesn't have autocomplete, treating Esc as "cancel"
  // throughout is fine.
  useEffect(() => {
    if (!open) return
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key !== 'Escape') return
      if (busy) return
      // Don't intercept when typing in OTHER inputs (none today, but
      // future-proof). The dialog's input itself wants Esc, so we let
      // it through.
      const target = e.target
      if (
        target !== inputRef.current &&
        isTypingTarget(target as EventTarget | null)
      ) {
        return
      }
      e.preventDefault()
      onCancel()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, busy, onCancel])

  if (!open) return null

  async function handleSubmit(): Promise<void> {
    const trimmed = name.trim()
    if (!trimmed || busy) return
    setBusy(true)
    try {
      await onSubmit(trimmed)
    } finally {
      setBusy(false)
    }
  }

  function handleKey(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'Enter') {
      e.preventDefault()
      void handleSubmit()
    }
  }

  return (
    // Backdrop swallows clicks outside the dialog. ``role="dialog"`` +
    // ``aria-modal`` keep screen readers + assistive tech informed.
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
      onClick={() => !busy && onCancel()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-project-title"
        className="bg-white border border-gray-200 rounded-lg shadow-lg p-6 w-96"
        onClick={e => e.stopPropagation()}
      >
        <h2
          id="new-project-title"
          className="text-base font-semibold text-gray-800 mb-1"
        >
          New project
        </h2>
        <p className="text-xs text-gray-500 mb-4">
          Name it now; richer details (client, site, tags, default CRSes…)
          can be added from the project's metadata editor when that lands.
        </p>

        <label
          htmlFor="new-project-name"
          className="block text-xs font-medium text-gray-600 mb-1"
        >
          Project name
        </label>
        <input
          ref={inputRef}
          id="new-project-name"
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={handleKey}
          disabled={busy}
          placeholder="e.g. GEO-22/040 Brugge"
          className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 mb-4 disabled:bg-gray-50"
        />

        <div className="flex justify-end gap-2">
          <Button
            variant="secondary"
            size="md"
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            size="md"
            onClick={() => void handleSubmit()}
            disabled={!name.trim() || busy}
          >
            Create…
          </Button>
        </div>
      </div>
    </div>
  )
}
