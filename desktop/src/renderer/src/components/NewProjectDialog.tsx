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
import Modal from './ui/Modal'
import { useT } from '../i18n/translate'

interface Props {
  open: boolean
  onSubmit: (name: string) => Promise<void> | void
  onCancel: () => void
}

export default function NewProjectDialog({ open, onSubmit, onCancel }: Props) {
  const t = useT()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Reset + auto-focus on open. Without the reset the dialog would
  // remember the last typed name across cancels — surprising. The shared
  // Modal handles Esc + backdrop close; we just own the form state +
  // the focus call.
  useEffect(() => {
    if (!open) return
    setName('')
    setBusy(false)
    // Focus on the next tick so the input is mounted before we ask.
    const timer = setTimeout(() => inputRef.current?.focus(), 0)
    return () => clearTimeout(timer)
  }, [open])

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
    <Modal
      open={open}
      onCancel={onCancel}
      labelledBy="new-project-title"
      busy={busy}
      testid="new-project-dialog"
    >
      <div className="p-6">
        <h2
          id="new-project-title"
          className="text-base font-semibold text-text-primary mb-1"
        >
          {t('project.new')}
        </h2>
        <p className="text-xs text-text-secondary mb-4">
          {t('project.newBlurb')}
        </p>

        <label
          htmlFor="new-project-name"
          className="block text-xs font-medium text-text-secondary mb-1"
        >
          {t('project.name')}
        </label>
        <input
          ref={inputRef}
          id="new-project-name"
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={handleKey}
          disabled={busy}
          placeholder={t('project.namePlaceholderExample')}
          data-testid="new-project-name-input"
          className="w-full border border-border-default rounded px-3 py-1.5 text-sm text-text-primary bg-surface-page placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent mb-4 disabled:bg-surface-card"
        />

        <div className="flex justify-end gap-2">
          <Button
            variant="secondary"
            size="md"
            onClick={onCancel}
            disabled={busy}
          >
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            size="md"
            onClick={() => void handleSubmit()}
            disabled={!name.trim() || busy}
            data-testid="new-project-submit"
          >
            {t('project.createEllipsis')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
