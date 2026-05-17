/**
 * Formation selection dialog — opened by the "Fill from boreholes" toolbar
 * verb in the Geology stage.
 *
 * Shows the candidate formation names discovered from borehole stratigraphy
 * (result of ``discoverBoreholeFormations``).  The user selects which
 * formations to keep; on confirm ``applyBoreholeFormationSelection`` fires.
 *
 * Manual lumping surface (2026-05-17, #55 manual-lump slice):
 *
 *   The dialog now carries a second surface below the candidate list where
 *   the user can build a "manual map": a set of groups that declare several
 *   discovered names as synonyms of a single target formation name.  Every
 *   group the user builds is sent to the server as ``manual_map`` on both
 *   the preview (discover) call and the confirm (apply) call.  The server
 *   lumps those names before creating contacts.
 *
 *   Key invariants (owner directive 2026-05-17):
 *
 *   - The anchor/search input REORDERS the full candidate list by
 *     ``rankByPartialMatch`` score — it NEVER hides any candidate.  A
 *     "show all / clear" link always returns the list to its default order.
 *     WHY rank-reorders-never-filters: the user must be able to hand-pick
 *     a zero-score name (e.g. "Lid van Saint-Maur") into an "Orchies" group
 *     when string math cannot know the synonymy.
 *
 *   - Groups are keyed on the normalised candidate ``key`` field (which equals
 *     ``normalize_formation_key(...)`` on the server), NOT on the raw display
 *     string.  WHY key-on-normalized-not-raw: the server uses the normalised
 *     key for lumping; if the client grouped by the raw display string, a
 *     candidate name with a different capitalisation / diacritic / apostrophe
 *     variant would resolve to a different server key and the discover ≡ apply
 *     invariant (same map on preview and confirm) would break.
 *
 *   - No chip or label implies the system inferred any grouping — every group
 *     is the user's explicit manual action.
 *
 *   - Collision warnings re-render live because the parent re-runs
 *     discoverBoreholeFormations with the current ``manual_map`` every time
 *     the map changes (handled in GeologyToolbar).  The ``collisions`` prop
 *     drives a clear amber panel beneath the groups section.
 *
 *   - Apply is the only irreversible action (it calls auto-populate + delete).
 *     All group edits (add group, rename target, add member, remove member,
 *     ungroup) are reversible — no confirm dialog needed.
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
 * One user-defined group: several candidate keys lumped into a single
 * target formation name.
 */
interface LumpGroup {
  /** Unique dialog-local id (not sent to the server). */
  groupId: string
  /**
   * The target formation name the user typed (may be an existing formation
   * name or a new one).  Sent as the value in the server's ``manual_map``.
   */
  targetName: string
  /**
   * Candidate keys (normalised, matches ``FormationCandidate.key``) the user
   * added to this group.  WHY keys-not-display-names: the server lumps on
   * normalised keys; grouping on raw display strings would break when two
   * boreholes use different diacritics for the same formal code.
   */
  memberKeys: string[]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Derive the ``manual_map`` object from the current group list. */
function buildManualMap(groups: LumpGroup[]): Record<string, string> {
  const map: Record<string, string> = {}
  for (const group of groups) {
    for (const key of group.memberKeys) {
      // WHY key-on-normalized-not-raw: see module docstring. The key field
      // on FormationCandidate already equals normalize_formation_key() on the
      // server, so shipping keys here ensures discover ≡ apply invariant.
      map[key] = group.targetName
    }
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
   * live as the user edits groups because the parent re-runs discover
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
   *     Current manual_map as built from the group list.
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
 * optional manual lumping.
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
 * onManualMapChange
 *     Callback fired whenever the lumping group list changes; parent
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
  // Search / rank state (rank-reorders-never-filters)
  //
  // WHY rank-reorders-never-filters: typing into the search box reorders the
  // candidate list by match score but NEVER removes any candidate.  A zero-
  // score name (e.g. "Lid van Saint-Maur") must remain visible at the bottom
  // so the user can hand-pick it into an "Orchies" group when string math
  // cannot know the synonymy.  The "Show all / clear" link is always present.
  // ---------------------------------------------------------------------------

  const [searchQuery, setSearchQuery] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)

  const rankedCandidates = useMemo(() => {
    if (searchQuery.trim() === '') return candidates
    // Build a name→score map from rankByPartialMatch and sort candidates by
    // their score. We never round-trip through .find() so:
    //   (a) duplicate display names receive the same score (correct — they
    //       rank equally by name match) and both remain selectable with their
    //       own distinct ``key`` values, and
    //   (b) there is no unguarded non-null assertion that could hide a missing
    //       candidate when names diverge between the ranked array and the list.
    const scored = rankByPartialMatch(searchQuery, candidates.map(c => c.name))
    // name → best score (last-write-wins; duplicate names share the same score
    // so any ordering among duplicates is equally valid).
    const scoreByName = new Map<string, number>(scored.map(r => [r.name, r.score]))
    return [...candidates]
      .map(c => ({ candidate: c, score: scoreByName.get(c.name) ?? 0 }))
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score
        return a.candidate.name.localeCompare(b.candidate.name)
      })
      .map(({ candidate }) => candidate)
  }, [searchQuery, candidates])

  // ---------------------------------------------------------------------------
  // Manual lumping groups
  // ---------------------------------------------------------------------------

  const [groups, setGroups] = useState<LumpGroup[]>([])
  // Transient UI state for building a new group target name input.
  const [newGroupTarget, setNewGroupTarget] = useState('')
  // Counter for stable group ids (dialog-local, not sent to server).
  const groupCounter = useRef(0)

  const newGroupId = useId()

  /** Set of candidate keys already assigned to any group. */
  const assignedKeys = useMemo(
    () => new Set(groups.flatMap(g => g.memberKeys)),
    [groups],
  )

  /** Notify the parent of a map change so it can refresh collision warnings. */
  const notifyMapChange = useCallback(
    (nextGroups: LumpGroup[]) => {
      onManualMapChange(buildManualMap(nextGroups))
    },
    [onManualMapChange],
  )

  const handleAddGroup = useCallback(() => {
    const target = newGroupTarget.trim()
    if (target === '') return
    const newGroup: LumpGroup = {
      groupId: `group-${groupCounter.current++}`,
      targetName: target,
      memberKeys: [],
    }
    setGroups(prev => {
      const next = [...prev, newGroup]
      notifyMapChange(next)
      return next
    })
    setNewGroupTarget('')
  }, [newGroupTarget, notifyMapChange])

  const handleAddMember = useCallback(
    (groupId: string, candidateKey: string) => {
      setGroups(prev => {
        const next = prev.map(g =>
          g.groupId === groupId
            ? { ...g, memberKeys: [...g.memberKeys, candidateKey] }
            : g,
        )
        notifyMapChange(next)
        return next
      })
    },
    [notifyMapChange],
  )

  const handleRemoveMember = useCallback(
    (groupId: string, candidateKey: string) => {
      setGroups(prev => {
        const next = prev.map(g =>
          g.groupId === groupId
            ? { ...g, memberKeys: g.memberKeys.filter(k => k !== candidateKey) }
            : g,
        )
        notifyMapChange(next)
        return next
      })
    },
    [notifyMapChange],
  )

  const handleRemoveGroup = useCallback(
    (groupId: string) => {
      setGroups(prev => {
        const next = prev.filter(g => g.groupId !== groupId)
        notifyMapChange(next)
        return next
      })
    },
    [notifyMapChange],
  )

  const handleRenameGroup = useCallback(
    (groupId: string, newTarget: string) => {
      setGroups(prev => {
        const next = prev.map(g =>
          g.groupId === groupId ? { ...g, targetName: newTarget } : g,
        )
        notifyMapChange(next)
        return next
      })
    },
    [notifyMapChange],
  )

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
    onConfirm(checked, buildManualMap(groups))
  }, [checked, groups, onConfirm])

  // ---------------------------------------------------------------------------
  // Derived: total collision count for the header summary
  // ---------------------------------------------------------------------------

  const totalDropped = useMemo(
    () => collisions.reduce((acc, c) => acc + c.droppedCount, 0),
    [collisions],
  )

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <Modal
      open={open}
      onCancel={onCancel}
      labelledBy="fill-from-boreholes-title"
      cardClassName="w-[600px] max-h-[90vh] flex flex-col"
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
          Select formations to include. Unselected formations and their contacts
          will be permanently deleted. Group names to lump synonyms before applying.
        </p>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto min-h-0">

        {/* ── Candidate list ──────────────────────────────────────────── */}
        <section aria-label="Formation candidates" className="px-5 pt-4 pb-2">
          {/* Search + Select all/none row */}
          <div className="flex items-center gap-2 mb-2">
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search to reorder…"
              aria-label="Search candidates — reorders list, never hides names"
              className="flex-1 text-xs px-2 py-1 rounded border border-border-default bg-surface-page text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent"
            />
            {searchQuery !== '' && (
              <button
                type="button"
                className="text-xs text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded shrink-0"
                onClick={() => setSearchQuery('')}
              >
                Show all
              </button>
            )}
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
              {rankedCandidates.map(candidate => {
                const isChecked = checked.has(candidate.key)
                const isAssigned = assignedKeys.has(candidate.key)
                return (
                  <li key={candidate.key} className="group/row">
                    <div className="flex items-start gap-2 py-1.5 px-2 rounded hover:bg-surface-page transition-colors">
                      <label className="flex items-start gap-2 flex-1 min-w-0 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          className="mt-0.5 h-3.5 w-3.5 rounded border-border-default text-accent focus:ring-accent focus:ring-1 shrink-0"
                          checked={isChecked}
                          onChange={() => toggle(candidate.key)}
                        />
                        <span className="flex-1 min-w-0">
                          <span className="block text-xs font-medium text-text-primary truncate">
                            {candidate.name}
                            {isAssigned && (
                              <span className="ml-1.5 text-xs text-text-muted font-normal italic">
                                (in group)
                              </span>
                            )}
                          </span>
                          <span className="block text-xs text-text-muted">
                            found in {candidate.boreholeCount}{' '}
                            {candidate.boreholeCount === 1 ? 'borehole' : 'boreholes'}
                          </span>
                        </span>
                      </label>
                      {/* Add-to-group dropdown */}
                      {groups.length > 0 && !isAssigned && (
                        <GroupAssigner
                          candidateKey={candidate.key}
                          candidateName={candidate.name}
                          groups={groups}
                          onAdd={handleAddMember}
                        />
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        {/* ── Manual lumping groups ────────────────────────────────────── */}
        <section
          aria-label="Manual lumping groups"
          className="px-5 pt-2 pb-4 border-t border-border-subtle mt-2"
        >
          <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-2 mt-2">
            Lump synonyms
          </h3>
          <p className="text-xs text-text-muted mb-3">
            Name a group, then add candidate names to it. All members will be
            treated as one formation. Every group is your explicit choice — the
            system infers nothing.
          </p>

          {/* New group row */}
          <div className="flex items-center gap-2 mb-3" id={newGroupId}>
            <input
              type="text"
              value={newGroupTarget}
              onChange={e => setNewGroupTarget(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  handleAddGroup()
                }
              }}
              placeholder="Target formation name…"
              aria-label="New group target formation name"
              className="flex-1 text-xs px-2 py-1 rounded border border-border-default bg-surface-page text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent"
            />
            <Button
              variant="secondary"
              size="sm"
              onClick={handleAddGroup}
              disabled={newGroupTarget.trim() === ''}
            >
              Add group
            </Button>
          </div>

          {/* Group list */}
          {groups.length > 0 ? (
            <ul className="space-y-2" role="list" aria-label="Lumping groups">
              {groups.map(group => (
                <LumpGroupRow
                  key={group.groupId}
                  group={group}
                  candidates={candidates}
                  assignedKeys={assignedKeys}
                  onRename={handleRenameGroup}
                  onRemoveMember={handleRemoveMember}
                  onRemoveGroup={handleRemoveGroup}
                />
              ))}
            </ul>
          ) : (
            <p className="text-xs text-text-muted italic">
              No groups yet. Add a group above to start lumping.
            </p>
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
            {!collisionsUpdating && <ul className="space-y-1.5" role="list">
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
            </ul>}
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
 * Dropdown to add a candidate to one of the existing groups.
 *
 * Parameters
 * ----------
 * candidateKey
 *     The candidate's normalised key (used as the map key).
 * candidateName
 *     Display name (shown in the button label).
 * groups
 *     Current group list.
 * onAdd
 *     Callback fired with (groupId, candidateKey) when the user picks a group.
 *
 * Returns
 * -------
 * JSX.Element
 */
function GroupAssigner({
  candidateKey,
  candidateName,
  groups,
  onAdd,
}: {
  candidateKey: string
  candidateName: string
  groups: LumpGroup[]
  onAdd: (groupId: string, candidateKey: string) => void
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const buttonId = useId()

  return (
    <div className="relative shrink-0">
      <button
        id={buttonId}
        type="button"
        aria-label={`Add ${candidateName} to a group`}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="text-xs text-accent hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent rounded opacity-0 group-hover/row:opacity-100 transition-opacity"
        onClick={() => setOpen(v => !v)}
      >
        + Group
      </button>
      {open && (
        <div
          role="listbox"
          aria-label="Pick a group"
          className="absolute right-0 top-full z-10 mt-1 min-w-[140px] bg-surface-overlay border border-border-default rounded shadow-lg"
        >
          {groups.map(group => (
            <button
              key={group.groupId}
              role="option"
              aria-selected={false}
              type="button"
              className="w-full text-left px-3 py-1.5 text-xs text-text-primary hover:bg-surface-page transition-colors"
              onClick={() => {
                onAdd(group.groupId, candidateKey)
                setOpen(false)
              }}
            >
              {group.targetName}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * One lumping group row — shows the target name (editable inline), its
 * member candidates (expandable), and an Ungroup button.
 *
 * Parameters
 * ----------
 * group
 *     The group data.
 * candidates
 *     Full candidate list (for display name lookup from key).
 * assignedKeys
 *     Keys already assigned to ANY group (for the dropdown exclude list).
 * onRename
 *     Callback fired when the target name is edited.
 * onRemoveMember
 *     Callback fired when a member is removed from the group.
 * onRemoveGroup
 *     Callback fired when the whole group is deleted.
 *
 * Returns
 * -------
 * JSX.Element
 */
function LumpGroupRow({
  group,
  candidates,
  assignedKeys: _assignedKeys,
  onRename,
  onRemoveMember,
  onRemoveGroup,
}: {
  group: LumpGroup
  candidates: FormationCandidate[]
  assignedKeys: ReadonlySet<string>
  onRename: (groupId: string, newTarget: string) => void
  onRemoveMember: (groupId: string, candidateKey: string) => void
  onRemoveGroup: (groupId: string) => void
}): JSX.Element {
  const [expanded, setExpanded] = useState(true)
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState(group.targetName)
  const editInputRef = useRef<HTMLInputElement>(null)

  const commitRename = useCallback(() => {
    const trimmed = editValue.trim()
    if (trimmed !== '' && trimmed !== group.targetName) {
      onRename(group.groupId, trimmed)
    } else {
      setEditValue(group.targetName)
    }
    setEditing(false)
  }, [editValue, group.targetName, group.groupId, onRename])

  // Build display name map from candidates list.
  const nameByKey = useMemo(
    () => new Map(candidates.map(c => [c.key, c.name])),
    [candidates],
  )

  return (
    <li className="border border-border-subtle rounded">
      {/* Group header */}
      <div className="flex items-center gap-1 px-2 py-1.5 bg-surface-page rounded-t">
        <button
          type="button"
          aria-label={expanded ? 'Collapse group' : 'Expand group'}
          className="text-text-muted hover:text-text-primary focus-visible:outline-none text-xs"
          onClick={() => setExpanded(v => !v)}
        >
          {expanded ? '▾' : '▸'}
        </button>
        {editing ? (
          <input
            ref={editInputRef}
            type="text"
            value={editValue}
            onChange={e => setEditValue(e.target.value)}
            onBlur={commitRename}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); commitRename() }
              if (e.key === 'Escape') { setEditValue(group.targetName); setEditing(false) }
            }}
            aria-label="Edit group target name"
            className="flex-1 text-xs px-1 py-0.5 rounded border border-accent bg-surface-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
            // reason: this input needs focus immediately after the user clicks
            // the name to edit it — the autoFocus is intentional and scoped to
            // an in-dialog inline edit, not a page-level accessibility concern.
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
          />
        ) : (
          <button
            type="button"
            aria-label={`Rename group "${group.targetName}"`}
            title="Click to rename"
            className="flex-1 text-left text-xs font-medium text-text-primary hover:text-accent focus-visible:outline-none truncate"
            onClick={() => setEditing(true)}
          >
            {group.targetName}
          </button>
        )}
        <span className="text-xs text-text-muted ml-1 shrink-0">
          {group.memberKeys.length} member{group.memberKeys.length === 1 ? '' : 's'}
        </span>
        <button
          type="button"
          aria-label={`Remove group "${group.targetName}"`}
          className="text-xs text-status-danger hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent rounded ml-1 shrink-0"
          onClick={() => onRemoveGroup(group.groupId)}
        >
          Ungroup
        </button>
      </div>

      {/* Member list */}
      {expanded && (
        <ul className="px-3 py-1.5 space-y-0.5" role="list">
          {group.memberKeys.length === 0 ? (
            <li className="text-xs text-text-muted italic">
              No members yet — use "+ Group" on a candidate above.
            </li>
          ) : (
            group.memberKeys.map(key => (
              <li key={key} className="flex items-center gap-1.5">
                <span className="flex-1 text-xs text-text-primary truncate">
                  {nameByKey.get(key) ?? key}
                </span>
                <button
                  type="button"
                  aria-label={`Remove "${nameByKey.get(key) ?? key}" from group`}
                  className="text-xs text-text-muted hover:text-status-danger focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent rounded"
                  onClick={() => onRemoveMember(group.groupId, key)}
                >
                  ×
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </li>
  )
}
