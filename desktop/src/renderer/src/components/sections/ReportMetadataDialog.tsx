// User-editable metadata dialog for the section PDF report (debt #52
// slice 1).  Title / author / notes — the title defaults to the active
// section's name so a quick Confirm without editing produces a
// sensibly-labelled report.
//
// Same Modal shape as DeleteContactConfirmDialog: explicit Cancel
// (default focus), action-named submit ("Generate PDF"), busy state
// while the request is in-flight so a double-click can't fire twice.

import { useEffect, useRef, useState } from 'react'

import Button from '../ui/Button'
import Modal from '../ui/Modal'

interface Props {
  open: boolean
  /** Default title shown in the input when the dialog opens.  Caller
   *  builds this from the section name (e.g. "Cross-section: A-A'"). */
  defaultTitle: string
  /** Default author — typically the user's name from app config when
   *  available; "" when unknown. */
  defaultAuthor?: string
  /** Fired on Generate.  Caller owns the actual export call + save-
   *  dialog wiring; the dialog just collects the metadata. */
  onSubmit: (metadata: { title: string; author: string; notes: string }) => Promise<void>
  /** Fired on Cancel / Esc / backdrop click. */
  onCancel: () => void
  /** When true, both buttons are disabled (request in flight). */
  busy?: boolean
}

export default function ReportMetadataDialog({
  open,
  defaultTitle,
  defaultAuthor = '',
  onSubmit,
  onCancel,
  busy = false,
}: Props): JSX.Element {
  const [title, setTitle] = useState(defaultTitle)
  const [author, setAuthor] = useState(defaultAuthor)
  const [notes, setNotes] = useState('')

  // Re-seed local state every time the dialog opens — so a section
  // switch between two opens gets the new default title.
  useEffect(() => {
    if (open) {
      setTitle(defaultTitle)
      setAuthor(defaultAuthor)
      setNotes('')
    }
  }, [open, defaultTitle, defaultAuthor])

  // Default focus on the title input so a user who just wants to
  // tweak the heading is one keystroke away.  Mirrors the existing
  // dialog pattern where the most-likely-edited field gets focus.
  const titleRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (open) titleRef.current?.focus()
  }, [open])

  async function handleSubmit(): Promise<void> {
    if (busy) return
    await onSubmit({
      title: title.trim() || defaultTitle,
      author: author.trim(),
      notes: notes.trim(),
    })
  }

  return (
    <Modal
      open={open}
      onCancel={onCancel}
      labelledBy="report-metadata-title"
      busy={busy}
      cardClassName="w-[32rem]"
    >
      <div className="p-5">
        <h2
          id="report-metadata-title"
          className="text-sm font-semibold text-text-primary mb-1"
          data-testid="report-metadata-dialog-title"
        >
          Generate section PDF
        </h2>
        <p className="text-xs text-text-secondary mb-4">
          Customise the title and metadata that appear on the report&apos;s
          header.  All fields are optional — leave the title default for
          the section name.
        </p>

        <label className="block text-xs font-medium text-text-secondary mb-1">
          Title
        </label>
        <input
          ref={titleRef}
          type="text"
          value={title}
          onChange={e => setTitle(e.target.value)}
          disabled={busy}
          className="w-full px-2 py-1.5 text-sm rounded border border-border-default bg-surface-card text-text-primary disabled:opacity-40 mb-3"
          data-testid="report-metadata-title-input"
        />

        <label className="block text-xs font-medium text-text-secondary mb-1">
          Author
        </label>
        <input
          type="text"
          value={author}
          onChange={e => setAuthor(e.target.value)}
          disabled={busy}
          placeholder="Engineer name"
          className="w-full px-2 py-1.5 text-sm rounded border border-border-default bg-surface-card text-text-primary disabled:opacity-40 mb-3"
          data-testid="report-metadata-author-input"
        />

        <label className="block text-xs font-medium text-text-secondary mb-1">
          Notes
        </label>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          disabled={busy}
          rows={3}
          placeholder="Optional free-text description rendered under the metadata table."
          className="w-full px-2 py-1.5 text-sm rounded border border-border-default bg-surface-card text-text-primary disabled:opacity-40 mb-4"
          data-testid="report-metadata-notes-input"
        />

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="px-3.5 py-1.5 text-sm font-medium rounded bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-40 dark:bg-surface-page dark:border-border-default dark:text-text-primary"
            data-testid="report-metadata-cancel"
          >
            Cancel
          </button>
          <Button
            variant="primary"
            size="md"
            onClick={() => void handleSubmit()}
            disabled={busy}
            data-testid="report-metadata-submit"
          >
            {busy ? 'Generating…' : 'Generate PDF'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
