// Confirm / reassign / detach dialog for a litho unit whose parent
// geological formation was inferred from TIN extrapolation (debt #87)
// or that has no parent at all (orphan). Opened from the amber dot on
// LithoFormationRoster rows.
//
// Three actions:
//   • Confirm — keep the current parent; clears parent_extrapolated=false.
//   • Reassign — pick a different parent; clears parent_extrapolated=false.
//   • Detach — clear the parent entirely (parent_formation_id=null) and
//             parent_extrapolated=false.  Soft because the row stays;
//             only the link goes away.  Useful when the engineer wants
//             to delete the orphan instead — Detach + delete is two
//             clicks.
//
// Default focus is on the parent select so the keyboard flow is
// Enter→Confirm (the user has glanced at the suggested parent and
// approves).  Esc / Cancel leaves the row unchanged.

import { useEffect, useMemo, useRef, useState } from 'react'

import type { GeologicalFormationResponse } from '../../../api/client'
import Button from '../../../components/ui/Button'
import Modal from '../../../components/ui/Modal'
import { useT } from '../../../i18n/translate'

interface Props {
  open: boolean
  /** Litho unit being reviewed. */
  formation: GeologicalFormationResponse | null
  /** Candidate parent geological formations (project geological list, no litho rows). */
  geoFormations: readonly GeologicalFormationResponse[]
  /** Fired with the chosen parent id (or null for Detach). The handler also
   *  clears parent_extrapolated as part of the same PATCH. */
  onSubmit: (nextParentId: string | null) => Promise<void>
  /** Fired on Cancel / Esc / backdrop. */
  onCancel: () => void
  busy?: boolean
}

export default function ConfirmParentDialog({
  open,
  formation,
  geoFormations,
  onSubmit,
  onCancel,
  busy = false,
}: Props): JSX.Element {
  const t = useT()
  // Local selection — seeds from the unit's current parent. Reset every
  // time the dialog opens with a new formation.
  const [selectedParentId, setSelectedParentId] = useState<string | null>(
    formation?.parent_formation_id ?? null,
  )
  useEffect(() => {
    if (open) setSelectedParentId(formation?.parent_formation_id ?? null)
  }, [open, formation])

  const selectRef = useRef<HTMLSelectElement>(null)
  useEffect(() => {
    if (open) selectRef.current?.focus()
  }, [open])

  // Sort parent options by display_order (oldest first — superposition
  // convention used by every other renderer).
  const sortedParents = useMemo(
    () => [...geoFormations].sort((a, b) => a.display_order - b.display_order),
    [geoFormations],
  )

  const isOrphan = formation?.parent_formation_id == null
  const titleText = isOrphan
    ? t('litho.assignParent')
    : t('litho.confirmExtrapolatedParent')

  return (
    <Modal
      open={open}
      onCancel={onCancel}
      labelledBy="confirm-parent-title"
      busy={busy}
      cardClassName="w-[28rem]"
    >
      <div className="p-5">
        <h2
          id="confirm-parent-title"
          className="text-sm font-semibold text-text-primary mb-1"
        >
          {titleText}
        </h2>
        <p className="text-xs text-text-secondary mb-3">
          {isOrphan ? t('litho.orphanBlurb') : t('litho.extrapolatedBlurb')}
        </p>

        <label
          htmlFor="confirm-parent-select"
          className="block text-[11px] font-medium text-text-secondary mb-1"
        >
          {t('litho.parentFormation')}
        </label>
        <select
          id="confirm-parent-select"
          ref={selectRef}
          value={selectedParentId ?? ''}
          onChange={e => setSelectedParentId(e.target.value || null)}
          disabled={busy}
          className="w-full px-2 py-1.5 text-sm rounded border border-border-default bg-surface-card text-text-primary disabled:opacity-40"
          data-testid="confirm-parent-select"
        >
          <option value="">{t('litho.noParent')}</option>
          {sortedParents.map(f => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>

        <div className="flex justify-end gap-2 mt-5">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="px-3.5 py-1.5 text-sm font-medium rounded bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-40 dark:bg-surface-page dark:border-border-default dark:text-text-primary"
            data-testid="confirm-parent-cancel"
          >
            {t('common.cancel')}
          </button>
          <Button
            variant="primary"
            size="md"
            onClick={() => void onSubmit(selectedParentId)}
            disabled={busy}
            data-testid="confirm-parent-submit"
          >
            {selectedParentId === null
              ? t('litho.detach')
              : selectedParentId === formation?.parent_formation_id
                ? t('litho.confirm')
                : t('litho.reassign')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
