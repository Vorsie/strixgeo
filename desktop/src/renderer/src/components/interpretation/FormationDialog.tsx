/**
 * Create / edit a geological formation.
 *
 * Same Modal + Button shell as NewProjectDialog. Three fields:
 *
 *   * name — required, the engineer-facing label
 *     (e.g. "Boom Klei", "Diest Zand")
 *   * color — HTML5 colour input; defaults to a neutral grey when
 *     the user opens "new"
 *   * regional_ref — optional regional reference / external code
 *     (e.g. a stratigraphic chart code). Free-text.
 *
 * ``initialValue === null`` ⇒ create mode (empty fields, title
 * "New formation"). Non-null ⇒ edit mode (fields prefilled, title
 * "Edit formation"). The submit handler is async; the modal stays
 * busy + locked until it resolves.
 *
 * Fields the backend supports but we don't surface yet:
 * ``code``, ``display_order``, ``description``. They land when the
 * formations list needs sort + categorisation; for now defaults
 * are fine.
 */

import { useEffect, useRef, useState } from 'react'

import type {
  GeologicalFormationCreatePayload,
  GeologicalFormationResponse,
  GeologicalFormationUpdatePayload,
} from '../../api/client'
import Button from '../ui/Button'
import Modal from '../ui/Modal'

const DEFAULT_COLOR = '#9ca3af' // gray-400 — same neutral as the backend default

interface Props {
  open: boolean
  /** ``null`` = create mode; non-null = edit mode (pre-filled). */
  initialValue: GeologicalFormationResponse | null
  onSubmit: (
    payload: GeologicalFormationCreatePayload | GeologicalFormationUpdatePayload,
  ) => Promise<void> | void
  onCancel: () => void
}

export default function FormationDialog({
  open,
  initialValue,
  onSubmit,
  onCancel,
}: Props): JSX.Element | null {
  const [name, setName] = useState('')
  const [color, setColor] = useState(DEFAULT_COLOR)
  const [regionalRef, setRegionalRef] = useState('')
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Reset + prefill on open. Without this the dialog leaks state
  // across cancel / re-open and edit / create cycles.
  useEffect(() => {
    if (!open) return
    setName(initialValue?.name ?? '')
    setColor(initialValue?.color ?? DEFAULT_COLOR)
    setRegionalRef(initialValue?.regional_ref ?? '')
    setBusy(false)
    const timer = setTimeout(() => inputRef.current?.focus(), 0)
    return () => clearTimeout(timer)
  }, [open, initialValue])

  async function handleSubmit(): Promise<void> {
    const trimmedName = name.trim()
    if (!trimmedName || busy) return
    const trimmedRef = regionalRef.trim()
    setBusy(true)
    try {
      await onSubmit({
        name: trimmedName,
        color,
        regional_ref: trimmedRef === '' ? null : trimmedRef,
      })
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

  const isEdit = initialValue !== null
  return (
    <Modal open={open} onCancel={onCancel} labelledBy="formation-dialog-title" busy={busy}>
      <div className="p-6">
        <h2
          id="formation-dialog-title"
          className="text-base font-semibold text-gray-800 mb-1"
        >
          {isEdit ? 'Edit formation' : 'New formation'}
        </h2>
        <p className="text-xs text-gray-500 mb-4">
          A formation is a substrate unit you reference in the
          geological model — e.g. <em>Boom Klei</em>, <em>Diest Zand</em>,
          <em> Quaternary deposits</em>.
        </p>

        <label
          htmlFor="formation-name"
          className="block text-xs font-medium text-gray-600 mb-1"
        >
          Name
        </label>
        <input
          ref={inputRef}
          id="formation-name"
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={handleKey}
          disabled={busy}
          placeholder="e.g. Boom Klei"
          className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 mb-3 disabled:bg-gray-50"
        />

        <div className="grid grid-cols-[auto_1fr] gap-3 items-start mb-3">
          <div>
            <label
              htmlFor="formation-color"
              className="block text-xs font-medium text-gray-600 mb-1"
            >
              Colour
            </label>
            <input
              id="formation-color"
              type="color"
              value={color}
              onChange={e => setColor(e.target.value)}
              disabled={busy}
              className="w-10 h-9 border border-gray-300 rounded cursor-pointer disabled:cursor-not-allowed"
            />
          </div>
          <div>
            <label
              htmlFor="formation-regional-ref"
              className="block text-xs font-medium text-gray-600 mb-1"
            >
              Regional reference <span className="text-gray-400">(optional)</span>
            </label>
            <input
              id="formation-regional-ref"
              type="text"
              value={regionalRef}
              onChange={e => setRegionalRef(e.target.value)}
              disabled={busy}
              placeholder="e.g. stratigraphic chart code"
              className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <Button variant="secondary" size="md" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="md"
            onClick={() => void handleSubmit()}
            disabled={!name.trim() || busy}
          >
            {isEdit ? 'Save' : 'Create'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
