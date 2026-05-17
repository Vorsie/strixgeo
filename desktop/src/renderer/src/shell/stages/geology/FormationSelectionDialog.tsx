/**
 * Formation selection dialog — opened by the "Fill from boreholes" toolbar
 * verb in the Geology stage.
 *
 * Shows the candidate formation names discovered from borehole stratigraphy
 * (result of ``discoverBoreholeFormations``).  The user selects which
 * formations to keep; on confirm ``applyBoreholeFormationSelection`` fires.
 *
 * Per-row reassignment surface (2026-05-17, #55 manual-lump slice — reworked):
 *
 *   Each discovered candidate row now carries an inline "→ same as …"
 *   dropdown/combobox.  The user selects a target row directly on the
 *   candidate, rather than assembling separate "lump groups" elsewhere in
 *   the dialog.  The same ``manual_map: { candidateKey -> targetName }``
 *   contract is produced and sent to the server unchanged.
 *
 *   Key invariants (owner directive 2026-05-17):
 *
 *   - The reassignment dropdown on each row shows the OTHER discovered
 *     formation names ordered by ``rankByPartialMatch(thisRow.displayName,
 *     otherNames)`` so the most-similar likely-synonym is on top.
 *   - The typeahead input RE-RANKS as the user types but NEVER hard-filters
 *     out options.  Every name in the list is always reachable.  WHY
 *     rank-reorders-never-filters: the user must be able to hand-pick a
 *     zero-score name (e.g. "Lid van Saint-Maur") into an "Orchies" group
 *     when string math cannot know the synonymy.
 *   - The dropdown also offers "Keep separate" (clears any reassignment)
 *     and the user may type a brand-new canonical name not in the list.
 *   - Reassignments are keyed on the candidate's normalised ``key`` field
 *     (which equals ``normalize_formation_key(...)`` on the server), NOT on
 *     the raw display string.  WHY key-on-normalized-not-raw: the server lumps
 *     on normalised keys; if the client stored the raw display string a
 *     diacritic/capitalisation variant would resolve to a different server
 *     key and the discover ≡ apply invariant would break.
 *   - A reassigned row's include-checkbox follows the target: the row is
 *     included iff its target is included.  WHY: a raw name reassigned to T
 *     creates its contacts as T on the section (server does this via
 *     manual_map); it is meaningless to "include" the raw name but exclude
 *     the target.
 *   - The collision warning panel stays and updates live as reassignments
 *     change (same debounced last-write-wins refresh the parent fires after
 *     onManualMapChange).
 *   - Apply is the only irreversible action; all row reassignments are
 *     reversible — no per-change confirm dialog.
 *
 * Key design rules (from ``docs/geology-stage-architecture.md`` §10.2–§10.4):
 *
 * - Default state: candidates whose name matches an existing model formation
 *   are pre-checked; new candidates are unchecked (opt-in, not opt-out).
 * - Deletion warning: live-recomputed as the user toggles checkboxes.
 *   ``status-danger`` copy; Cancel gets ``autoFocus`` when any deletion
 *   would occur.
 * - The deletion set is every formation in ``currentFormations`` whose name is
 *   NOT in the selected set — including manually-added formations not in the
 *   candidate list.
 * - Apply / Cancel buttons; confirm button text is ``"Apply selection"``,
 *   never "OK".
 *
 * Theming: uses the app's semantic CSS-var tokens (``surface-*`` /
 * ``text-*`` / ``border-*`` / ``status-danger``) which flip with the
 * ``.dark`` class.  NOT Tailwind ``dark:`` variants.
 */

import { useCallback, useId, useMemo, useRef, useState } from 'react'

import type { FormationCandidate, LumpingCollision } from '../../../hooks/useGeologicalModel'
import type {
  FormationContactResponse,
  GeologicalFormationResponse,
} from '../../../api/client'
import Modal from '../../../components/ui/Modal'
import Button from '../../../components/ui/Button'
import { rankByPartialMatch } from '../../../utils/partialMatch'

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/**
 * Per-row reassignment state.
 *
 * The key is the reassigned candidate's ``FormationCandidate.key`` (normalised).
 * The value is the target display name the user picked.
 *
 * WHY key-on-normalized-not-raw: see module docstring.  Using raw display
 * strings would break the discover ≡ apply invariant when a candidate name
 * contains diacritics or unusual capitalisation.
 */
type RowReassignments = Map<string, string>

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Derive the ``manual_map`` object from the current row-level reassignment map.
 *
 * Parameters
 * ----------
 * reassignments
 *     Per-candidate-key → target-name map built from the inline row dropdowns.
 *
 * Returns
 * -------
 * Record<string, string>
 *     Object suitable for sending to the server as ``manual_map``.
 */
function buildManualMap(reassignments: RowReassignments): Record<string, string> {
  const map: Record<string, string> = {}
  for (const [key, target] of reassignments) {
    // WHY key-on-normalized-not-raw: see module docstring.  The key field on
    // FormationCandidate already equals normalize_formation_key() on the server,
    // so shipping keys here ensures the discover ≡ apply invariant holds.
    map[key] = target
  }
  return map
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface FormationSelectionDialogProps {
  /** Whether the dialog is open. */
  open: boolean
  /** Candidate formation names from the discovery scan. */
  candidates: FormationCandidate[]
  /**
   * Collision warnings from the last discover scan with the current
   * ``manual_map``.  Rendered as an amber non-blocking panel.  Updated
   * live as the user edits reassignments because the parent re-runs discover
   * with the new map.
   */
  collisions: LumpingCollision[]
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
   * True while the parent is re-running discoverBoreholeFormations after a
   * manual-map change.  Drives the "Updating…" indicator on the collision
   * panel so the user sees the dialog is reacting to their edit.
   */
  collisionsUpdating?: boolean
  /**
   * Fired when the manual_map changes so the parent can re-run discover
   * with the new map to get updated collision warnings.
   *
   * Parameters
   * ----------
   * map
   *     Current manual_map as built from the row-level reassignment state.
   */
  onManualMapChange: (map: Record<string, string>) => void
  /**
   * Fired on confirm with the set of selected stable keys (not display names)
   * AND the current manual_map.
   *
   * The same ``manual_map`` that was used for the last preview is sent to
   * the confirm call — the parent must NOT re-discover between this callback
   * and the apply API call.  This eliminates the open-dialog/edit race and
   * preserves the discover ≡ apply invariant the backend enforces.
   *
   * Parameters
   * ----------
   * selectedKeys
   *     Stable candidate keys the user checked.
   * manualMap
   *     The lumping map at confirm time — mirrors the last-previewed map.
   */
  onConfirm: (selectedKeys: ReadonlySet<string>, manualMap: Record<string, string>) => void
  /** Fired on cancel or backdrop click. */
  onCancel: () => void
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Modal dialog for the "Fill from boreholes" curated selection flow with
 * optional per-row reassignment (synonym lumping).
 *
 * Parameters
 * ----------
 * open
 *     Whether the dialog is visible.
 * candidates
 *     Formation name candidates returned by the discovery scan.
 * collisions
 *     Lumping collisions from the last discover scan — rendered as warnings.
 * currentFormations
 *     Formations currently in the geological model.
 * currentContacts
 *     Contacts currently in the geological model.
 * collisionsUpdating
 *     True while the parent is re-running discover after a map change.
 * onManualMapChange
 *     Callback fired whenever the reassignment state changes; parent
 *     re-runs discover to refresh collision warnings.
 * onConfirm
 *     Callback fired on "Apply selection" with selected keys + manual map.
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
  collisions,
  currentFormations,
  currentContacts,
  collisionsUpdating = false,
  onManualMapChange,
  onConfirm,
  onCancel,
}: FormationSelectionDialogProps): JSX.Element {
  // ---------------------------------------------------------------------------
  // Checked state — stable keys
  // ---------------------------------------------------------------------------

  const currentKeySet = useMemo(
    () =>
      new Set(
        currentFormations.map(f => (f.regional_ref ?? f.name).toLowerCase()),
      ),
    [currentFormations],
  )

  const [checked, setChecked] = useState<ReadonlySet<string>>(() => {
    return new Set(
      candidates
        .filter(c => currentKeySet.has(c.key.toLowerCase()))
        .map(c => c.key),
    )
  })

  // ---------------------------------------------------------------------------
  // Per-row reassignment state
  //
  // Maps each reassigned candidate key to the target display name.  An absent
  // entry means "keep separate" (no lumping for that row).
  //
  // WHY Map-not-object: Map iterates in insertion order and avoids prototype
  // collisions on arbitrary formation names.
  // ---------------------------------------------------------------------------

  const [reassignments, setReassignments] = useState<RowReassignments>(new Map())

  /** Notify the parent of a map change so it can refresh collision warnings. */
  const notifyMapChange = useCallback(
    (next: RowReassignments) => {
      onManualMapChange(buildManualMap(next))
    },
    [onManualMapChange],
  )

  /** Set a row's reassignment target.  Clears the entry when ``target`` is null. */
  const setReassignment = useCallback(
    (candidateKey: string, target: string | null) => {
      setReassignments(prev => {
        const next = new Map(prev)
        if (target === null) {
          next.delete(candidateKey)
        } else {
          next.set(candidateKey, target)
        }
        notifyMapChange(next)
        return next
      })
    },
    [notifyMapChange],
  )

  // ---------------------------------------------------------------------------
  // Deletion accounting (live)
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
  // Toggle helpers
  // ---------------------------------------------------------------------------

  const toggle = useCallback(
    (key: string) => {
      setChecked(prev => {
        const next = new Set(prev)
        if (next.has(key)) next.delete(key)
        else next.add(key)
        return next
      })
    },
    [],
  )

  const selectAll = useCallback(() => {
    setChecked(new Set(candidates.map(c => c.key)))
  }, [candidates])

  const selectNone = useCallback(() => {
    setChecked(new Set())
  }, [])

  // ---------------------------------------------------------------------------
  // Confirm: pass both checked keys and the current manual_map.
  //
  // WHY pass the map at confirm time: the parent sends the SAME map that was
  // used for the last preview (discover) call.  This eliminates the race
  // condition where the user edits the map after clicking "Apply selection"
  // but before the apply API call fires — the discover ≡ apply invariant
  // the backend enforces requires both calls to carry the identical map.
  // ---------------------------------------------------------------------------

  const handleConfirm = useCallback(() => {
    onConfirm(checked, buildManualMap(reassignments))
  }, [checked, reassignments, onConfirm])

  // ---------------------------------------------------------------------------
  // Derived: total collision count for the header summary
  // ---------------------------------------------------------------------------

  const totalDropped = useMemo(
    () => collisions.reduce((acc, c) => acc + c.droppedCount, 0),
    [collisions],
  )

  // ---------------------------------------------------------------------------
  // Build the target-name list for each row's reassignment dropdown.
  //
  // The dropdown for row X shows every OTHER candidate name, ranked by
  // rankByPartialMatch(X.name, otherNames) so the most-similar likely-
  // synonym appears first.  Zero-score names are still in the list —
  // rank-reorders-never-filters.
  // ---------------------------------------------------------------------------

  /** Map from candidate.key → ranked list of OTHER candidate display names. */
  const rankedTargetsByKey = useMemo(() => {
    const result = new Map<string, string[]>()
    for (const self of candidates) {
      const otherNames = candidates
        .filter(c => c.key !== self.key)
        .map(c => c.name)
      // Use a single call to rankByPartialMatch with the row's own name as the
      // query so the most-similar peer ranks first in the dropdown.
      const ranked = rankByPartialMatch(self.name, otherNames)
      result.set(self.key, ranked.map(r => r.name))
    }
    return result
  }, [candidates])

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <Modal
      open={open}
      onCancel={onCancel}
      labelledBy="fill-from-boreholes-title"
      cardClassName="w-[620px] max-h-[90vh] flex flex-col"
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
          Select formations to include. Use "→ same as" on a row to lump it into another
          formation. Unselected formations and their contacts will be permanently deleted.
        </p>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto min-h-0">

        {/* ── Candidate list ──────────────────────────────────────────── */}
        <section aria-label="Formation candidates" className="px-5 pt-4 pb-4">
          {/* Select all/none row */}
          <div className="flex items-center gap-2 mb-2">
            <span className="flex-1 text-xs text-text-muted">
              {candidates.length} formation{candidates.length === 1 ? '' : 's'} found
            </span>
            <button
              type="button"
              className="text-xs text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded shrink-0"
              onClick={selectAll}
            >
              All
            </button>
            <button
              type="button"
              className="text-xs text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded shrink-0"
              onClick={selectNone}
            >
              None
            </button>
          </div>

          {candidates.length === 0 ? (
            <p className="py-4 text-center text-xs text-text-muted">
              No stratigraphy candidates found.
            </p>
          ) : (
            <ul className="space-y-0.5" role="list">
              {candidates.map(candidate => {
                const reassignedTo = reassignments.get(candidate.key) ?? null
                // A reassigned row's include-checkbox follows the target:
                // included iff the target row is included.  WHY: the raw name
                // will be created as the target on the section; it is
                // meaningless to "include" the raw but "exclude" the target.
                const isChecked = reassignedTo !== null
                  ? (() => {
                      const targetCandidate = candidates.find(c => c.name === reassignedTo)
                      return targetCandidate ? checked.has(targetCandidate.key) : checked.has(candidate.key)
                    })()
                  : checked.has(candidate.key)
                return (
                  <li key={candidate.key} className="group/row">
                    <div className={[
                      'flex items-start gap-2 py-1.5 px-2 rounded transition-colors',
                      reassignedTo !== null
                        ? 'bg-surface-page/60 pl-6'   // indented when reassigned
                        : 'hover:bg-surface-page',
                    ].join(' ')}>
                      <label className="flex items-start gap-2 flex-1 min-w-0 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          className="mt-0.5 h-3.5 w-3.5 rounded border-border-default text-accent focus:ring-accent focus:ring-1 shrink-0"
                          checked={isChecked}
                          disabled={reassignedTo !== null}
                          onChange={() => {
                            // Only toggle when not reassigned; when reassigned the
                            // checkbox follows the target row's state.
                            if (reassignedTo === null) toggle(candidate.key)
                          }}
                        />
                        <span className="flex-1 min-w-0">
                          <span className={[
                            'block text-xs font-medium truncate',
                            reassignedTo !== null ? 'text-text-muted' : 'text-text-primary',
                          ].join(' ')}>
                            {candidate.name}
                            {reassignedTo !== null && (
                              <span className="ml-1.5 text-xs text-accent font-normal not-italic">
                                → {reassignedTo}
                              </span>
                            )}
                          </span>
                          <span className="block text-xs text-text-muted">
                            found in {candidate.boreholeCount}{' '}
                            {candidate.boreholeCount === 1 ? 'borehole' : 'boreholes'}
                          </span>
                        </span>
                      </label>

                      {/* Per-row "→ same as …" reassignment control */}
                      {candidates.length > 1 && (
                        <RowReassignDropdown
                          candidateKey={candidate.key}
                          candidateName={candidate.name}
                          currentTarget={reassignedTo}
                          rankedTargets={rankedTargetsByKey.get(candidate.key) ?? []}
                          onSelect={setReassignment}
                        />
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        {/* ── Collision warnings ───────────────────────────────────────── */}
        {(collisions.length > 0 || collisionsUpdating) && (
          <section
            aria-label="Lumping collision warnings"
            className="px-5 pb-4 pt-2 border-t border-border-subtle"
          >
            <h3 className="text-xs font-semibold text-status-warning uppercase tracking-wide mb-2 mt-2 flex items-center gap-1">
              <span aria-hidden="true">⚠</span>
              {collisionsUpdating ? (
                <span className="text-text-muted normal-case font-normal">Updating…</span>
              ) : (
                <>
                  {collisions.length} borehole{collisions.length === 1 ? '' : 's'} had
                  layers lumping to the same formation — kept shallowest, dropped{' '}
                  {totalDropped}{' '}
                  {totalDropped === 1 ? 'boundary' : 'boundaries'}; review your grouping
                </>
              )}
            </h3>
            {!collisionsUpdating && (
              <ul className="space-y-1.5" role="list">
                {collisions.map((col, i) => (
                  <li
                    key={i}
                    className="text-xs bg-surface-page border border-border-subtle rounded px-2 py-1.5"
                  >
                    <span className="font-medium text-text-primary">
                      {col.targetFormationName}
                    </span>
                    <span className="text-text-muted ml-1">
                      in borehole{' '}
                      <span className="font-mono">{col.boreholeId.slice(0, 8)}…</span>
                      : colliding names:{' '}
                      {col.collidingRawNames.map((n, j) => (
                        <span key={j}>
                          {j > 0 && ', '}
                          <span className="italic">{n}</span>
                        </span>
                      ))}
                      . Kept top at {col.keptTopM}m, dropped {col.droppedCount}.
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>

      {/* Deletion warning */}
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
        {/* Cancel has autoFocus when a deletion warning is visible — safe
            default for a destructive-confirm modal per docs/ux.md. */}
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
          onClick={handleConfirm}
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

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/**
 * Inline "→ same as …" dropdown for a single candidate row.
 *
 * Shows every OTHER candidate name, ranked by partial-match similarity to
 * this row's own display name.  A typeahead input re-ranks as the user types
 * but NEVER removes any option — full list always reachable.
 *
 * Parameters
 * ----------
 * candidateKey
 *     The normalised key for this candidate (used as the manual_map key).
 * candidateName
 *     Display name — used as the partial-match query for initial ranking.
 * currentTarget
 *     Currently selected target name, or null if "Keep separate".
 * rankedTargets
 *     Other candidate names pre-ranked by similarity to this row.
 * onSelect
 *     Callback fired with (candidateKey, target | null) — null = keep separate.
 *
 * Returns
 * -------
 * JSX.Element
 */
function RowReassignDropdown({
  candidateKey,
  candidateName,
  currentTarget,
  rankedTargets,
  onSelect,
}: {
  candidateKey: string
  candidateName: string
  currentTarget: string | null
  rankedTargets: string[]
  onSelect: (key: string, target: string | null) => void
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const buttonId = useId()

  // Re-rank as the user types.  NEVER removes options — rank-reorders-never-filters.
  const displayedTargets = useMemo(() => {
    if (query.trim() === '') return rankedTargets
    return rankByPartialMatch(query, rankedTargets).map(r => r.name)
  }, [query, rankedTargets])

  const handleOpen = useCallback(() => {
    setOpen(true)
    setQuery('')
    // Focus the typeahead on next tick so the dropdown mounts first.
    setTimeout(() => inputRef.current?.focus(), 0)
  }, [])

  const handleClose = useCallback(() => {
    setOpen(false)
    setQuery('')
  }, [])

  const handlePick = useCallback(
    (target: string | null) => {
      onSelect(candidateKey, target)
      handleClose()
    },
    [candidateKey, onSelect, handleClose],
  )

  const handleCustom = useCallback(() => {
    const trimmed = query.trim()
    if (trimmed !== '' && trimmed !== candidateName) {
      onSelect(candidateKey, trimmed)
    }
    handleClose()
  }, [query, candidateName, candidateKey, onSelect, handleClose])

  return (
    <div className="relative shrink-0">
      <button
        id={buttonId}
        type="button"
        aria-label={
          currentTarget !== null
            ? `Reassigned to "${currentTarget}" — click to change`
            : `Reassign "${candidateName}" to another formation`
        }
        aria-haspopup="listbox"
        aria-expanded={open}
        className={[
          'text-xs rounded focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent px-1.5 py-0.5 border transition-colors',
          currentTarget !== null
            ? 'text-accent border-accent/40 bg-accent/5'
            : 'text-text-muted border-border-subtle hover:text-accent hover:border-accent/40 opacity-0 group-hover/row:opacity-100',
        ].join(' ')}
        onClick={open ? handleClose : handleOpen}
      >
        {currentTarget !== null ? `→ ${currentTarget}` : '→ same as'}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Reassign to formation"
          className="absolute right-0 top-full z-20 mt-1 w-56 bg-surface-overlay border border-border-default rounded shadow-lg flex flex-col"
        >
          {/* Typeahead input */}
          <div className="p-1.5 border-b border-border-subtle">
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Escape') { e.stopPropagation(); handleClose() }
                if (e.key === 'Enter') { e.preventDefault(); handleCustom() }
              }}
              placeholder="Type to re-rank or enter name…"
              aria-label="Filter or type a target formation name"
              className="w-full text-xs px-2 py-1 rounded border border-border-default bg-surface-page text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>

          {/* Option list — scrollable */}
          <ul
            role="listbox"
            aria-label="Target formation options"
            className="max-h-44 overflow-y-auto"
          >
            {/* Keep separate option — always first */}
            <li>
              <button
                role="option"
                aria-selected={currentTarget === null}
                type="button"
                className={[
                  'w-full text-left px-3 py-1.5 text-xs transition-colors',
                  currentTarget === null
                    ? 'bg-accent/10 text-accent font-medium'
                    : 'text-text-muted hover:bg-surface-page',
                ].join(' ')}
                onClick={() => handlePick(null)}
              >
                Keep separate
              </button>
            </li>

            {/* Custom-name option — only when user typed something new */}
            {query.trim() !== '' &&
              !rankedTargets.includes(query.trim()) &&
              query.trim() !== candidateName && (
                <li>
                  <button
                    role="option"
                    aria-selected={currentTarget === query.trim()}
                    type="button"
                    className="w-full text-left px-3 py-1.5 text-xs text-text-primary italic hover:bg-surface-page transition-colors"
                    onClick={handleCustom}
                  >
                    Use "{query.trim()}"
                  </button>
                </li>
              )}

            {/* Ranked peer options */}
            {displayedTargets.map(name => (
              <li key={name}>
                <button
                  role="option"
                  aria-selected={currentTarget === name}
                  type="button"
                  className={[
                    'w-full text-left px-3 py-1.5 text-xs transition-colors',
                    currentTarget === name
                      ? 'bg-accent/10 text-accent font-medium'
                      : 'text-text-primary hover:bg-surface-page',
                  ].join(' ')}
                  onClick={() => handlePick(name)}
                >
                  {name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
