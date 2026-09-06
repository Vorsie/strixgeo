// Bed-override list for the Data inspector (owner ruling 2026-09-06).
//
// Renders the project's manual bed-level polygons with per-row edit / delete,
// and the create / edit form that appears when a polygon is drawn on the map or
// an existing row is edited. All state lives in the ``bedOverrides`` slice of
// the shell bus (``useBedOverrides``); this component is the view.
//
// Reversible actions (edit) fire immediately; the irreversible delete is
// guarded by a confirmation dialog with Cancel default-focused (docs/ux.md).

import { useEffect, useState } from 'react'

import { Pencil, Trash2, Waves } from 'lucide-react'

import ConfirmDialog from '../../../components/ui/ConfirmDialog'
import { useShell } from '../../ShellContext'
import { useT } from '../../../i18n/translate'

/**
 * The bed-override list + form panel for the Data inspector.
 *
 * Returns nothing when the bus has no bed-override slice (a partial test
 * shell); otherwise the panel is always shown so the empty state teaches the
 * Bed level tool.
 */
export default function BedOverrideList(): JSX.Element | null {
  const shell = useShell()
  const bed = shell.bedOverrides
  const t = useT()
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  if (bed === undefined) return null

  const formOpen = bed.pendingPolygon !== null || bed.editingId !== null
  const editing = bed.editingId !== null
  const editingRow = editing ? bed.overrides.find(o => o.id === bed.editingId) ?? null : null
  const deleteRow = pendingDeleteId
    ? bed.overrides.find(o => o.id === pendingDeleteId) ?? null
    : null

  return (
    <div
      className="border-t border-[--color-border-subtle] flex-shrink-0"
      data-testid="bed-override-panel"
    >
      <div className="flex items-center gap-2 px-3 py-1.5 text-[11px] font-medium text-[--color-text-secondary]">
        <Waves size={12} />
        <span>{t('bedOverride.title')}</span>
        {bed.overrides.length > 0 && (
          <span className="text-[--color-text-muted]">({bed.overrides.length})</span>
        )}
      </div>

      {formOpen && (
        <BedOverrideForm
          key={bed.editingId ?? 'new'}
          initialLabel={editingRow?.label ?? ''}
          initialLevel={editingRow?.level_m ?? null}
          onSubmit={(label, level) => bed.submit(label, level)}
          onCancel={bed.cancelForm}
        />
      )}

      {!formOpen && bed.overrides.length === 0 && (
        <p className="px-3 pb-2 text-[10px] leading-snug text-[--color-text-muted]">
          {t('bedOverride.empty')}
        </p>
      )}

      {bed.overrides.length > 0 && (
        <ul className="max-h-48 overflow-y-auto">
          {bed.overrides.map(o => (
            <li
              key={o.id}
              data-testid={`bed-override-row-${o.id}`}
              className="group flex items-center gap-2 px-3 py-1 text-[11px] hover:bg-[--color-surface-app]"
            >
              <span className="flex-1 truncate">{o.label}</span>
              <span className="text-[--color-text-muted] tabular-nums">
                {o.level_m.toFixed(2)} {t('bedOverride.levelSuffix')}
              </span>
              <button
                type="button"
                data-testid={`bed-override-row-edit-${o.id}`}
                title={t('bedOverride.edit')}
                onClick={() => bed.startEdit(o.id)}
                className="opacity-0 group-hover:opacity-100 text-[--color-text-muted] hover:text-[--color-text-primary] transition-opacity"
              >
                <Pencil size={12} />
              </button>
              <button
                type="button"
                data-testid={`bed-override-row-delete-${o.id}`}
                title={t('bedOverride.delete')}
                onClick={() => setPendingDeleteId(o.id)}
                className="opacity-0 group-hover:opacity-100 text-red-600 hover:text-red-700 transition-opacity"
              >
                <Trash2 size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={deleteRow !== null}
        labelledBy="bed-override-delete-title"
        titleTestid="bed-override-delete-title"
        title={t('bedOverride.deleteConfirmTitle')}
        body={t('bedOverride.deleteConfirmBody', { label: deleteRow?.label ?? '' })}
        busy={deleting}
        confirm={{
          label: t('bedOverride.deleteConfirmButton'),
          variant: 'danger',
          testid: 'bed-override-delete-confirm',
          onClick: async () => {
            if (pendingDeleteId === null) return
            setDeleting(true)
            await bed.remove(pendingDeleteId)
            setDeleting(false)
            setPendingDeleteId(null)
          },
        }}
        onCancel={() => setPendingDeleteId(null)}
      />
    </div>
  )
}

interface BedOverrideFormProps {
  initialLabel: string
  initialLevel: number | null
  onSubmit: (label: string, levelM: number) => Promise<boolean>
  onCancel: () => void
}

/** The create / edit form: a name and a bed level (m TAW). */
function BedOverrideForm({
  initialLabel,
  initialLevel,
  onSubmit,
  onCancel,
}: BedOverrideFormProps): JSX.Element {
  const t = useT()
  const [label, setLabel] = useState(initialLabel)
  const [level, setLevel] = useState(initialLevel === null ? '' : String(initialLevel))
  const [saving, setSaving] = useState(false)
  const editing = initialLabel !== '' || initialLevel !== null

  // Focus the label field when the form opens.
  const [labelEl, setLabelEl] = useState<HTMLInputElement | null>(null)
  useEffect(() => {
    labelEl?.focus()
  }, [labelEl])

  const levelNumber = Number(level)
  const canSave = label.trim().length > 0 && level.trim().length > 0 && Number.isFinite(levelNumber)

  async function handleSave(): Promise<void> {
    if (!canSave) return
    setSaving(true)
    const ok = await onSubmit(label.trim(), levelNumber)
    setSaving(false)
    if (ok) onCancel()
  }

  return (
    <div
      className="px-3 pb-2 flex flex-col gap-1.5"
      data-testid="bed-override-form"
    >
      <div className="text-[10px] uppercase tracking-wide text-[--color-text-muted]">
        {editing ? t('bedOverride.formEditTitle') : t('bedOverride.formCreateTitle')}
      </div>
      <label className="flex flex-col gap-0.5 text-[10px] text-[--color-text-secondary]">
        {t('bedOverride.labelField')}
        <input
          ref={setLabelEl}
          type="text"
          data-testid="bed-override-label-input"
          value={label}
          placeholder={t('bedOverride.labelPlaceholder')}
          onChange={e => setLabel(e.target.value)}
          className="px-1.5 py-1 rounded border border-[--color-border-subtle] bg-[--color-surface-card] text-[11px]"
        />
      </label>
      <label className="flex flex-col gap-0.5 text-[10px] text-[--color-text-secondary]">
        {t('bedOverride.levelField')}
        <input
          type="number"
          step="0.1"
          inputMode="decimal"
          data-testid="bed-override-level-input"
          value={level}
          onChange={e => setLevel(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && canSave) void handleSave()
          }}
          className="px-1.5 py-1 rounded border border-[--color-border-subtle] bg-[--color-surface-card] text-[11px]"
        />
      </label>
      <div className="flex items-center gap-1.5 pt-0.5">
        <button
          type="button"
          data-testid="bed-override-form-save"
          disabled={!canSave || saving}
          onClick={() => void handleSave()}
          className="px-2 py-1 rounded bg-accent text-white text-[11px] font-medium disabled:opacity-50"
        >
          {t('bedOverride.save')}
        </button>
        <button
          type="button"
          data-testid="bed-override-form-cancel"
          onClick={onCancel}
          className="px-2 py-1 rounded text-[11px] text-[--color-text-secondary] hover:bg-[--color-surface-app]"
        >
          {t('bedOverride.cancel')}
        </button>
      </div>
    </div>
  )
}
