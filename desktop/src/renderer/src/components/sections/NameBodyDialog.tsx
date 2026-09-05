// Name / rename a body (lens) dialog.
//
// Replaces the ``window.prompt`` call that hit a dead end: Electron's
// renderer process disables ``prompt()`` for security, so picking
// "Name body…" from the body context menu silently did nothing
// (dogfeed 2026-06-01). This is the Modal-based replacement, mirroring
// NewProjectDialog.
//
// Naming a body marks it user-curated: a named body survives the detector
// reconcile sweep (the preserve-named guard) — i.e. naming is how you
// "keep" (accept) a detected lens.

import { useEffect, useRef, useState } from 'react'

import Button from '../ui/Button'
import Modal from '../ui/Modal'
import { useT } from '../../i18n/translate'

interface Props {
  /** Open when a body id is being named; null = closed. */
  open: boolean
  /** Current name to pre-fill (rename), or '' for an unnamed body. */
  initialName: string
  /** Fired with the trimmed, non-empty name on submit. */
  onSubmit: (name: string) => Promise<void> | void
  /** Fired on Cancel / Esc / backdrop. */
  onCancel: () => void
}

/**
 * Modal text-input for naming or renaming a body.
 *
 * Owns its own draft + busy state; the shared Modal handles Esc + backdrop
 * dismissal. The input auto-focuses (and selects existing text) on open so a
 * rename is one keystroke away.
 */
export default function NameBodyDialog({
  open,
  initialName,
  onSubmit,
  onCancel,
}: Props): JSX.Element {
  const [name, setName] = useState(initialName)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const t = useT()

  // Seed the draft from the body's current name on each open, and focus +
  // select so a rename overwrites in one keystroke.
  useEffect(() => {
    if (!open) return
    setName(initialName)
    setBusy(false)
    const timer = setTimeout(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    }, 0)
    return () => clearTimeout(timer)
  }, [open, initialName])

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
      labelledBy="name-body-title"
      busy={busy}
      testid="name-body-dialog"
      cardClassName="w-80"
    >
      <div className="p-6">
        <h2 id="name-body-title" className="text-base font-semibold text-text-primary mb-1">
          {t('sections.lens.nameDialogTitle')}
        </h2>
        <p className="text-xs text-text-secondary mb-4">{t('sections.nameBody.keptHint')}</p>

        <label
          htmlFor="name-body-input"
          className="block text-xs font-medium text-text-secondary mb-1"
        >
          {t('sections.lens.name')}
        </label>
        <input
          ref={inputRef}
          id="name-body-input"
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={handleKey}
          disabled={busy}
          placeholder={t('sections.nameBody.placeholder')}
          data-testid="name-body-input"
          className="w-full border border-border-default rounded px-3 py-1.5 text-sm text-text-primary bg-surface-page placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent mb-4 disabled:bg-surface-card"
        />

        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="md" onClick={onCancel} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            size="md"
            onClick={() => void handleSubmit()}
            disabled={!name.trim() || busy}
            data-testid="name-body-submit"
          >
            {t('sections.lens.saveName')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
