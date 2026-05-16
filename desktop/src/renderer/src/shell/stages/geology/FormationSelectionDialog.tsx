/**
 * Formation selection dialog — opened by the "Fill from boreholes" toolbar
 * verb in the Geology stage.
 *
 * Shows the candidate formation names discovered from borehole stratigraphy
 * (result of ``discoverBoreholeFormations``).  The user selects which
 * formations to keep; on confirm ``applyBoreholeFormationSelection`` fires.
 *
 * Key design rules (from ``docs/geology-stage-architecture.md`` §10.2–§10.4):
 *
 * - Default state: candidates whose name matches an existing model formation
 *   are pre-checked; new candidates are unchecked (opt-in, not opt-out).
 * - Deletion warning: live-recomputed as the user toggles checkboxes.
 *   Red ``text-red-600`` copy; Cancel gets ``autoFocus`` when any deletion
 *   would occur.
 * - The deletion set is every formation in ``currentFormations`` whose name is
 *   NOT in the selected set — including manually-added formations not in the
 *   candidate list.
 * - Apply / Cancel buttons; confirm button text is ``"Apply selection"``,
 *   never "OK".
 *
 * Theming: uses the app's semantic CSS-var tokens (``surface-*`` /
 * ``text-*`` / ``border-*`` / ``status-danger``) which flip with the
 * ``.dark`` class.  NOT Tailwind ``dark:`` variants — those key off OS
 * ``prefers-color-scheme`` and are dead on a light-OS host, which is
 * why this dialog previously rendered white over the dark app.
 */

import { useCallback, useMemo, useState } from 'react'

import type { FormationCandidate } from '../../../hooks/useGeologicalModel'
import type {
  FormationContactResponse,
  GeologicalFormationResponse,
} from '../../../api/client'
import Modal from '../../../components/ui/Modal'
import Button from '../../../components/ui/Button'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface FormationSelectionDialogProps {
  /** Whether the dialog is open. */
  open: boolean
  /** Candidate formation names from the discovery scan. */
  candidates: FormationCandidate[]
  /**
   * Current formations in the model — used to pre-check rows and compute
   * how many would be deleted.
   */
  currentFormations: GeologicalFormationResponse[]
  /**
   * Current contacts in the model — used to compute the M in "M contacts
   * will be deleted".
   */
  currentContacts: FormationContactResponse[]
  /**
   * Fired on confirm with the set of selected stable keys (not display names).
   * Stable key = ``candidate.key`` (``regional_ref`` when present, else
   * ``name``).  The hook passes these directly to the server's
   * ``selected_keys`` filter so identity is preserved regardless of working-
   * name variation across boreholes sharing a formal stratigraphy code.
   */
  onConfirm: (selectedKeys: ReadonlySet<string>) => void
  /** Fired on cancel or backdrop click. */
  onCancel: () => void
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Modal dialog for the "Fill from boreholes" curated selection flow.
 *
 * Parameters
 * ----------
 * open
 *     Whether the dialog is visible.
 * candidates
 *     Formation name candidates returned by the discovery scan.
 * currentFormations
 *     Formations currently in the geological model.
 * currentContacts
 *     Contacts currently in the geological model.
 * onConfirm
 *     Callback fired on "Apply selection" with the user-chosen name set.
 * onCancel
 *     Callback fired on Cancel or backdrop click.
 *
 * Returns
 * -------
 * JSX.Element
 *     The modal dialog element (renders null when ``open`` is false).
 */
export default function FormationSelectionDialog({
  open,
  candidates,
  currentFormations,
  currentContacts,
  onConfirm,
  onCancel,
}: FormationSelectionDialogProps): JSX.Element {
  // ---------------------------------------------------------------------------
  // Checked state: stable keys of candidates the user has selected.
  //
  // Stable key = candidate.key (regional_ref when present, else name).
  // Selection is keyed on the stable identity — NOT the display name — so two
  // boreholes that use different working names for the same formal code both
  // resolve to a single checkable row in the dialog, and the confirmed set
  // passed to the server is the same key the server used for deduplication.
  //
  // Pre-checked: candidates whose stable key already matches an existing
  // formation (by regional_ref or name fallback).
  // ---------------------------------------------------------------------------

  // Build a stable-key set from current formations: regional_ref when present,
  // else name (mirrors the server's stable-key definition).
  const currentKeySet = useMemo(
    () =>
      new Set(
        currentFormations.map(f => (f.regional_ref ?? f.name).toLowerCase()),
      ),
    [currentFormations],
  )

  const [checked, setChecked] = useState<ReadonlySet<string>>(() => {
    // Pre-check candidates that already have a matching formation in the model.
    // New candidates (not yet in the model) start unchecked — the user must
    // opt in to adding them, not opt out of deleting things.
    return new Set(
      candidates
        .filter(c => currentKeySet.has(c.key.toLowerCase()))
        .map(c => c.key),
    )
  })

  // ---------------------------------------------------------------------------
  // Deletion accounting (live — recomputed on every checkbox change).
  //
  // Deleted formations: every CURRENT formation whose stable key is NOT in
  // ``checked``. This intentionally includes manually-added formations not in
  // the candidate list (see §10.2 sharp-edge note).
  // ---------------------------------------------------------------------------

  const { deletedFormationCount, deletedContactCount } = useMemo(() => {
    const checkedLower = new Set(Array.from(checked).map(k => k.toLowerCase()))
    const toDelete = currentFormations.filter(f => {
      const stableKey = (f.regional_ref ?? f.name).toLowerCase()
      return !checkedLower.has(stableKey)
    })
    const deletedIds = new Set(toDelete.map(f => f.id))
    return {
      deletedFormationCount: toDelete.length,
      deletedContactCount: currentContacts.filter(c =>
        deletedIds.has(c.formation_id),
      ).length,
    }
  }, [checked, currentFormations, currentContacts])

  const willDelete = deletedFormationCount > 0

  // ---------------------------------------------------------------------------
  // Toggle helpers — operate on candidate.key, not candidate.name
  // ---------------------------------------------------------------------------

  const toggle = useCallback((key: string) => {
    setChecked(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const selectAll = useCallback(() => {
    setChecked(new Set(candidates.map(c => c.key)))
  }, [candidates])

  const selectNone = useCallback(() => {
    setChecked(new Set())
  }, [])

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <Modal
      open={open}
      onCancel={onCancel}
      labelledBy="fill-from-boreholes-title"
      cardClassName="w-[480px] max-h-[80vh] flex flex-col"
    >
      {/* Header */}
      <div className="px-5 pt-5 pb-3 border-b border-border-default">
        <h2
          id="fill-from-boreholes-title"
          className="text-sm font-semibold text-text-primary"
        >
          Fill from boreholes
        </h2>
        <p className="mt-1 text-xs text-text-secondary">
          Select the formations to include in the model. Unselected formations
          and their contacts will be permanently deleted.
        </p>
      </div>

      {/* Select all / none controls */}
      <div className="flex justify-end gap-3 px-5 py-2 border-b border-border-subtle">
        <button
          type="button"
          className="text-xs text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded"
          onClick={selectAll}
        >
          Select all
        </button>
        <button
          type="button"
          className="text-xs text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded"
          onClick={selectNone}
        >
          Select none
        </button>
      </div>

      {/* Candidate list — scrollable when tall */}
      <div className="flex-1 overflow-y-auto px-5 py-2 min-h-0">
        {candidates.length === 0 ? (
          <p className="py-4 text-center text-xs text-text-muted">
            No stratigraphy candidates found.
          </p>
        ) : (
          <ul className="space-y-1" role="list">
            {candidates.map(candidate => {
              const isChecked = checked.has(candidate.key)
              return (
                <li key={candidate.key}>
                  <label className="flex items-start gap-2.5 py-1.5 px-2 rounded cursor-pointer hover:bg-surface-page transition-colors select-none">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-3.5 w-3.5 rounded border-border-default text-accent focus:ring-accent focus:ring-1 shrink-0"
                      checked={isChecked}
                      onChange={() => toggle(candidate.key)}
                    />
                    <span className="flex-1 min-w-0">
                      <span className="block text-xs font-medium text-text-primary truncate">
                        {candidate.name}
                      </span>
                      <span className="block text-xs text-text-muted">
                        found in {candidate.boreholeCount}{' '}
                        {candidate.boreholeCount === 1 ? 'borehole' : 'boreholes'}
                      </span>
                    </span>
                  </label>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/* Deletion warning — shown only when at least one formation would be deleted */}
      {willDelete && (
        <div className="px-5 py-2 border-t border-border-default bg-surface-page">
          <p className="text-xs text-status-danger font-medium">
            {deletedFormationCount} formation{deletedFormationCount === 1 ? '' : 's'} and{' '}
            {deletedContactCount} contact{deletedContactCount === 1 ? '' : 's'} will be
            permanently deleted.
          </p>
        </div>
      )}

      {/* Footer */}
      <div className="flex justify-end gap-2 px-5 py-4 border-t border-border-default">
        {/* Cancel has autoFocus when a deletion warning is visible — the safe
            default for a destructive-confirm modal per docs/ux.md. When no
            deletions would occur, the confirm button takes focus instead. */}
        <Button
          variant="secondary"
          size="md"
          onClick={onCancel}
          // reason: autoFocus on Cancel is the safe default for a destructive
          // confirm dialog when deletions would occur — the user must actively
          // choose the destructive action. When willDelete is false (no
          // deletions), the confirm button is focused instead.
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus={willDelete}
        >
          Cancel
        </Button>
        <Button
          variant={willDelete ? 'danger' : 'primary'}
          size="md"
          onClick={() => onConfirm(checked)}
          disabled={checked.size === 0 && currentFormations.length === 0}
          // reason: autoFocus on the confirm button when no deletions occur —
          // the action is additive-only and safe to confirm with Enter.
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus={!willDelete}
        >
          Apply selection
        </Button>
      </div>
    </Modal>
  )
}
