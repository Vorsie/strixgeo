// Model-kind picker (#55, litho slice 4 step 1).
//
// The geological model is the v1 single backbone (shown read-only by
// GeologyInspector). This control manages the LITHOSTRATIGRAPHIC
// sibling lifecycle: pick which litho model is active (the one the
// suggest-litho / ghost-overlay flow targets) and create a new one
// under the active geological parent. Geotechnical models are a later
// phase — not surfaced here yet (don't build UI for a kind we can't
// populate).
//
// Reads everything from useShell().geoModel; takes no props (shell
// convention). Backend enforces the parent invariant + per-kind
// is_active — this is a thin, assisted control over those.

import { useState } from 'react'
import { Check, Plus, X } from 'lucide-react'

import { useShell } from '../../ShellContext'

/**
 * Compact lithostratigraphic-model selector + creator.
 *
 * Renders nothing until a geological backbone exists (a litho model
 * cannot be created without a geological parent — backend invariant).
 *
 * Returns
 * -------
 * JSX.Element | null
 *     The picker row, or null when there is no geological model.
 */
export default function ModelKindPicker(): JSX.Element | null {
  const {
    geoModel: {
      activeGeologicalModel,
      models,
      activeLithoModel,
      handleCreateLithoModel,
      handleActivateLithoModel,
    },
  } = useShell()

  const [creating, setCreating] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [busy, setBusy] = useState(false)

  // Litho models cannot exist without a geological parent.
  if (activeGeologicalModel === null) return null

  const lithoModels = models.filter(m => m.kind === 'lithostratigraphic')

  async function commitCreate(): Promise<void> {
    const name = draftName.trim()
    if (name === '' || busy) return
    setBusy(true)
    try {
      const created = await handleCreateLithoModel(name)
      if (created !== null) {
        setCreating(false)
        setDraftName('')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="flex items-center gap-1.5 pl-5 text-[10px] text-text-muted"
      data-testid="model-kind-picker"
    >
      <span className="shrink-0">Lithology model</span>

      {creating ? (
        <form
          className="flex items-center gap-1"
          onSubmit={e => {
            e.preventDefault()
            void commitCreate()
          }}
        >
          {/* autoFocus: the user just clicked "+", focus the field so
              they can type the name immediately (no extra click). */}
          {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
          <input
            autoFocus
            value={draftName}
            onChange={e => setDraftName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Escape') {
                setCreating(false)
                setDraftName('')
              }
            }}
            maxLength={200}
            placeholder="Model name…"
            aria-label="New lithostratigraphic model name"
            className="w-36 rounded border border-border-default bg-surface-input px-1.5 py-0.5 text-[10px] text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <button
            type="submit"
            disabled={busy || draftName.trim() === ''}
            title="Create lithostratigraphic model"
            aria-label="Create lithostratigraphic model"
            className="rounded p-0.5 text-status-success hover:bg-surface-hover disabled:opacity-40"
          >
            <Check size={12} />
          </button>
          <button
            type="button"
            onClick={() => {
              setCreating(false)
              setDraftName('')
            }}
            title="Cancel"
            aria-label="Cancel new model"
            className="rounded p-0.5 text-text-muted hover:bg-surface-hover"
          >
            <X size={12} />
          </button>
        </form>
      ) : (
        <>
          {lithoModels.length > 0 ? (
            <select
              value={activeLithoModel?.id ?? ''}
              onChange={e => void handleActivateLithoModel(e.target.value)}
              aria-label="Active lithostratigraphic model"
              className="max-w-[10rem] truncate rounded border border-border-default bg-surface-input px-1 py-0.5 text-[10px] text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
            >
              {activeLithoModel === null && (
                <option value="" disabled>
                  — select —
                </option>
              )}
              {lithoModels.map(m => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          ) : (
            <span className="italic">none yet</span>
          )}
          <button
            type="button"
            onClick={() => setCreating(true)}
            title="New lithostratigraphic model (refines the active geological model)"
            aria-label="New lithostratigraphic model"
            className="flex items-center gap-0.5 rounded px-1 py-0.5 text-accent hover:bg-surface-hover"
          >
            <Plus size={11} />
            New
          </button>
        </>
      )}
    </div>
  )
}
