/**
 * Formation picker for the click-to-place contact workflow.
 *
 * Opens after the user picks a depth on a borehole or CPT in the
 * cross-section. Lists every project formation with its colour +
 * name + regional reference; clicking a row POSTs the contact
 * back through ``onSelect`` and the modal closes. The subtitle
 * surfaces the anchor + depth so the user can confirm what
 * they're committing.
 *
 * v1 scope:
 *   * Formation rows, scrollable list.
 *   * Subtitle with anchor name + depth + elevation.
 *   * "+ New formation here" escape hatch — opens the existing
 *     ``FormationDialog`` in create mode pre-seeded with the
 *     current depth so the user can introduce a formation without
 *     leaving the flow.
 *
 * Deferred:
 *   * Search/filter when project carries 30+ formations.
 *   * Recent / pinned formations row.
 */

import { useState } from 'react'
import { Plus } from 'lucide-react'

import type {
  GeologicalFormationCreatePayload,
  GeologicalFormationResponse,
} from '../../api/client'
import { formationsYoungestFirst } from '../../utils/formationOrder'
import Button from '../ui/Button'
import Modal from '../ui/Modal'
import FormationDialog from './FormationDialog'
import { useT } from '../../i18n/translate'

interface Props {
  open: boolean
  formations: readonly GeologicalFormationResponse[]
  /** What we're placing the contact on — surfaces in the subtitle
   * so the user knows the depth's reference frame. */
  anchor: {
    kind: 'cpt' | 'borehole'
    name: string
    depth_m: number
    elevationM: number
  } | null
  /** Picked an existing formation — caller POSTs the contact. */
  onSelect: (formationId: string) => Promise<void> | void
  /** Inline create — caller POSTs the new formation, returns its
   * id, then this dialog selects it immediately to chain the
   * commit without a second click. */
  onCreateFormation: (
    payload: GeologicalFormationCreatePayload,
  ) => Promise<{ id: string } | null>
  onCancel: () => void
}

export default function FormationPickerDialog({
  open,
  formations,
  anchor,
  onSelect,
  onCreateFormation,
  onCancel,
}: Props): JSX.Element | null {
  const t = useT()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)

  async function pick(formationId: string): Promise<void> {
    if (busyId !== null) return
    setBusyId(formationId)
    try {
      await onSelect(formationId)
    } finally {
      setBusyId(null)
    }
  }

  async function handleInlineCreate(
    payload: GeologicalFormationCreatePayload,
  ): Promise<void> {
    const created = await onCreateFormation(payload)
    setCreateDialogOpen(false)
    if (created) await pick(created.id)
  }

  return (
    <>
      <Modal
        open={open && !createDialogOpen}
        onCancel={onCancel}
        labelledBy="formation-picker-title"
        busy={busyId !== null}
        cardClassName="w-[28rem]"
      >
        <div className="p-5">
          <h2
            id="formation-picker-title"
            className="text-base font-semibold text-text-primary mb-1"
          >
            {t('formation.topOfWhichFormation')}
          </h2>
          {anchor && (
            <p className="text-xs text-text-secondary mb-4">
              {t('dialog.pickerAnchorPre')}{' '}
              <span className="font-medium text-text-primary">{anchor.name}</span>{' '}
              {t('dialog.pickerAnchorAt', {
                depth: anchor.depth_m.toFixed(2),
                taw: `${anchor.elevationM >= 0 ? '+' : ''}${anchor.elevationM.toFixed(2)}`,
              })}
            </p>
          )}

          <div className="max-h-72 overflow-y-auto -mx-2 px-2">
            {formations.length === 0 ? (
              <div className="text-xs text-text-muted italic px-1 py-3">
                {t('formation.noneDefinedPickerPre')}{' '}
                <em>{t('formation.fromBoreholes')}</em>{' '}
                {t('formation.noneDefinedPickerPost')}
              </div>
            ) : (
              <ul className="flex flex-col gap-1">
                {/* Youngest-first (surface at top) so this reads like the
                    GeologyInspector list / a borehole log. */}
                {formationsYoungestFirst(formations).map(f => (
                  <li key={f.id}>
                    <button
                      onClick={() => void pick(f.id)}
                      disabled={busyId !== null}
                      className={[
                        'w-full flex items-center gap-2 px-2 py-2 rounded text-left',
                        'border border-border-default hover:border-accent hover:bg-surface-page',
                        'disabled:opacity-60 disabled:cursor-not-allowed transition-colors',
                      ].join(' ')}
                    >
                      <span
                        className="inline-block w-4 h-4 rounded border border-border-default shrink-0"
                        style={{ backgroundColor: f.color }}
                      />
                      <span className="flex flex-col min-w-0">
                        <span className="text-xs font-medium text-text-primary truncate">
                          {f.name}
                        </span>
                        {f.regional_ref && (
                          <span className="text-[10px] text-text-muted truncate">
                            {f.regional_ref}
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex justify-between items-center gap-2 mt-4 pt-3 border-t border-border-subtle">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setCreateDialogOpen(true)}
              disabled={busyId !== null}
              title={t('formation.newHereHint')}
            >
              <Plus size={12} className="mr-1" />
              {t('formation.newHere')}
            </Button>
            <Button
              variant="secondary"
              size="md"
              onClick={onCancel}
              disabled={busyId !== null}
            >
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      </Modal>

      <FormationDialog
        open={createDialogOpen}
        initialValue={null}
        onSubmit={async payload => {
          await handleInlineCreate(payload as GeologicalFormationCreatePayload)
        }}
        onCancel={() => setCreateDialogOpen(false)}
      />
    </>
  )
}
