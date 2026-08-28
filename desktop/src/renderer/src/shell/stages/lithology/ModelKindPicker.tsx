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
//
// UX-review (ux-reviewer, #55): renders as its OWN row at the same
// visual weight as the geological "Stratigraphy ·" line above (not a
// 10px muted annotation) so the two ground-model axes read as peers;
// tokens are the real registry only (surface-app / border-default /
// accent / status / text-secondary — there is no surface-input /
// surface-hover / status-success token); text is text-secondary (the
// 10px text-muted used by the sibling line fails WCAG AA — that is
// pre-existing #51-tail debt, not propagated here); activation has a
// busy guard; the empty state is an actionable CTA, not "none yet".

import { useState } from 'react'
import { Check, Layers, Plus, Trash2, X } from 'lucide-react'

import { useShell } from '../../ShellContext'
import Modal from '../../../components/ui/Modal'
import Button from '../../../components/ui/Button'
import { useT } from '../../../i18n/translate'

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
      handleDeleteLithoModel,
    },
  } = useShell()

  const [creating, setCreating] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [busy, setBusy] = useState(false)
  const [activating, setActivating] = useState(false)
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  // Unconditional hook — above the ``activeGeologicalModel === null`` early
  // return below, per the hook rules.
  const t = useT()

  async function confirmDelete(): Promise<void> {
    if (activeLithoModel === null || deleting) return
    setDeleting(true)
    try {
      await handleDeleteLithoModel(activeLithoModel.id)
      setConfirmDeleteOpen(false)
    } catch {
      // handleDeleteLithoModel already toasted the reason; keep the
      // dialog open so the user sees the action did not complete.
    } finally {
      setDeleting(false)
    }
  }

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

  async function activate(modelId: string): Promise<void> {
    if (activating) return
    setActivating(true)
    try {
      await handleActivateLithoModel(modelId)
    } finally {
      setActivating(false)
    }
  }

  return (
    <>
    <div
      className="flex items-center gap-1.5 pl-5 text-[11px] text-text-secondary"
      data-testid="model-kind-picker"
    >
      <Layers size={11} className="shrink-0 text-text-muted" aria-hidden />
      <span className="shrink-0 font-medium">{t('litho.model')}</span>

      {creating ? (
        <form
          className="flex items-center gap-1"
          onSubmit={e => {
            e.preventDefault()
            void commitCreate()
          }}
        >
          {/* autoFocus: the user just clicked "New", focus the field
              so they can type immediately (no extra click). */}
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
            placeholder={t('litho.modelNamePlaceholder')}
            aria-label={t('litho.newModelNameLabel')}
            className="w-36 rounded border border-border-default bg-surface-app px-1.5 py-0.5 text-[11px] text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <button
            type="submit"
            disabled={busy || draftName.trim() === ''}
            title={t('litho.createModel')}
            aria-label={t('litho.createModel')}
            className="rounded p-0.5 text-accent hover:bg-surface-app disabled:opacity-40"
          >
            <Check size={12} />
          </button>
          <button
            type="button"
            onClick={() => {
              setCreating(false)
              setDraftName('')
            }}
            title={t('common.cancel')}
            aria-label={t('litho.cancelNewModel')}
            className="rounded p-0.5 text-text-secondary hover:bg-surface-app hover:text-text-primary"
          >
            <X size={12} />
          </button>
        </form>
      ) : lithoModels.length > 0 ? (
        <>
          <select
            value={activeLithoModel?.id ?? ''}
            disabled={activating}
            onChange={e => void activate(e.target.value)}
            aria-label={t('litho.activeModel')}
            className="max-w-[10rem] truncate rounded border border-border-default bg-surface-app px-1 py-0.5 text-[11px] text-text-primary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
          >
            {activeLithoModel === null && (
              <option value="" disabled>
                {t('litho.selectPlaceholder')}
              </option>
            )}
            {lithoModels.map(m => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setCreating(true)}
            title={t('litho.newModelHint')}
            aria-label={t('litho.newModel')}
            className="flex items-center gap-0.5 rounded px-1 py-0.5 text-accent hover:bg-surface-app"
          >
            <Plus size={11} />
            {t('litho.newShort')}
          </button>
          {activeLithoModel !== null && (
            <button
              type="button"
              onClick={() => setConfirmDeleteOpen(true)}
              title={t('litho.deleteModelHint')}
              aria-label={t('litho.deleteModel')}
              className="rounded p-0.5 text-text-secondary hover:bg-surface-app hover:text-status-danger"
            >
              <Trash2 size={12} />
            </button>
          )}
        </>
      ) : (
        // C1 — first-run discoverability moment: an actionable CTA, not
        // a muted "none yet". This is where the engineer forms the
        // mental model that litho is a second, separate ground-model
        // axis they must create before picking contacts on sections.
        <button
          type="button"
          onClick={() => setCreating(true)}
          title={t('litho.createModelHint')}
          aria-label={t('litho.createModel')}
          className="flex items-center gap-1 rounded border border-dashed border-border-default px-1.5 py-0.5 text-accent hover:bg-surface-app"
        >
          <Plus size={11} />
          {t('litho.createOneToPick')}
        </button>
      )}
    </div>

    {/* Delete confirm — irreversible; default focus on Cancel
        (docs/ux.md irreversible-action rule, mirrors GeologyToolbar). */}
    <Modal
      open={confirmDeleteOpen}
      onCancel={() => {
        if (!deleting) setConfirmDeleteOpen(false)
      }}
      labelledBy="delete-litho-model-title"
      busy={deleting}
      cardClassName="w-80"
    >
      <div className="p-5">
        <h2
          id="delete-litho-model-title"
          className="mb-1 text-sm font-semibold text-text-primary"
        >
          {t('litho.deleteModelConfirm')}
        </h2>
        <p className="mb-4 text-xs text-text-secondary">
          <span className="font-medium text-text-primary">
            {activeLithoModel?.name ?? t('litho.thisModelFallback')}
          </span>{' '}
          {t('litho.deleteModelBody')}
        </p>
        <div className="flex justify-end gap-2">
          <Button
            variant="secondary"
            size="md"
            // reason: autoFocus on Cancel is the safe default for a
            // destructive-confirm modal — the user must actively choose
            // the destructive action, not accidentally confirm it.
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
            onClick={() => setConfirmDeleteOpen(false)}
            disabled={deleting}
          >
            {t('common.cancel')}
          </Button>
          <Button
            variant="danger"
            size="md"
            onClick={() => void confirmDelete()}
            disabled={deleting}
          >
            {t('common.delete')}
          </Button>
        </div>
      </div>
    </Modal>
    </>
  )
}
