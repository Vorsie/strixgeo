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

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'

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
 * Discriminated target for a per-row reassignment.
 *
 * - ``'candidate'`` — the user picked an existing candidate identified by
 *   its stable ``key``.  The wire-format name is derived from the candidate
 *   at emit time (``buildManualMap``), so renaming a candidate object does
 *   not silently produce a stale entry.
 *
 * - ``'custom'`` — the user typed a free-form canonical name not in the
 *   candidate list.  The wire-format name is exactly ``name``.
 *
 * WHY discriminated union instead of bare string: storing a display NAME
 * as the target caused two bugs —
 *
 *   B1  ``isChecked`` used ``candidates.find(c => c.name === reassignedTo)``
 *       which resolves to the FIRST of several duplicate-named candidates,
 *       producing the wrong checkbox state.
 *
 *   S2  A custom canonical name always fell through to the ``targetCandidate``
 *       not-found branch and silently rendered as unchecked + disabled even
 *       though it WILL be created on Apply — a misleading UI state.
 *
 *   C1  Entering an exact candidate display name in the typeahead triggered
 *       ``handleCustom`` instead of selecting the candidate, creating a
 *       phantom custom entry in the map.
 *
 * Storing a discriminated target and resolving the display name only at
 * ``buildManualMap`` time eliminates all three.
 */
type ReassignTarget =
  | { kind: 'candidate'; key: string }
  | { kind: 'custom'; name: string }

/**
 * Per-row reassignment state.
 *
 * The map key is the reassigned candidate's ``FormationCandidate.key``
 * (normalised).  The value is a discriminated ``ReassignTarget``.
 *
 * WHY key-on-normalized-not-raw: see module docstring.
 */
type RowReassignments = Map<string, ReassignTarget>

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Derive the ``manual_map`` object from the current row-level reassignment map.
 *
 * Wire shape is ``{ candidateKey → targetDisplayName }`` — byte-identical to
 * the pre-discriminated-union contract so the backend and the discover ≡ apply
 * invariant are unaffected.
 *
 * Parameters
 * ----------
 * reassignments
 *     Per-candidate-key → ``ReassignTarget`` map built from the inline row
 *     dropdowns.
 * candidates
 *     Full candidate list — needed to resolve a ``'candidate'`` target's
 *     display name from its key.
 *
 * Returns
 * -------
 * Record<string, string>
 *     Object suitable for sending to the server as ``manual_map``.
 */
function buildManualMap(
  reassignments: RowReassignments,
  candidates: FormationCandidate[],
): Record<string, string> {
  const map: Record<string, string> = {}
  for (const [key, target] of reassignments) {
    // WHY key-on-normalized-not-raw: see module docstring.  The key field on
    // FormationCandidate already equals normalize_formation_key() on the server,
    // so shipping keys here ensures the discover ≡ apply invariant holds.
    if (target.kind === 'candidate') {
      const candidate = candidates.find(c => c.key === target.key)
      if (candidate) map[key] = candidate.name
    } else {
      map[key] = target.name
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
   * Previously applied lumping map — pre-populates the row reassignment
   * dropdowns when the user reopens the dialog.
   *
   * Shape: ``{ candidateKey → targetDisplayName }`` — the same wire format
   * emitted by ``buildManualMap`` and persisted in the ``.gmproj`` bundle
   * under ``stratigraphy_lumping.map``.  Only entries whose ``candidateKey``
   * is present in the current ``candidates`` list are applied; stale entries
   * (from a prior discover run with different boreholes) are silently ignored.
   *
   * A candidate target whose ``targetDisplayName`` exactly matches an
   * existing candidate's ``name`` is restored as ``{kind: 'candidate', key}``;
   * otherwise it is restored as ``{kind: 'custom', name}``.
   */
  initialReassignments?: Record<string, string>
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
 * initialReassignments
 *     Previously applied lumping map (``currentLumping.map``) — prefills
 *     the row reassignment dropdowns on reopen.  Absent on first open.
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
  initialReassignments,
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
  // Maps each reassigned candidate key to a discriminated ReassignTarget.
  // An absent entry means "keep separate" (no lumping for that row).
  //
  // WHY Map-not-object: Map iterates in insertion order and avoids prototype
  // collisions on arbitrary formation names.
  // ---------------------------------------------------------------------------

  // Bug 3 fix: restore previously applied reassignments from the persisted
  // lumping snapshot.  Only entries whose candidateKey exists in the current
  // candidates list are applied — stale entries (from a discover run with
  // different boreholes) are silently ignored.
  //
  // A candidate target is matched by name against the current candidates list
  // to determine the correct ReassignTarget discriminant:
  //   - Exact name match → {kind: 'candidate', key} so the downstream
  //     buildManualMap resolves the wire name from the live candidate object
  //     (survives name drift between sessions).
  //   - No match → {kind: 'custom', name} (user-typed canonical name; kept
  //     verbatim).
  const [reassignments, setReassignments] = useState<RowReassignments>(() => {
    if (!initialReassignments || Object.keys(initialReassignments).length === 0) {
      return new Map()
    }
    const result: RowReassignments = new Map()
    const candidateKeySet = new Set(candidates.map(c => c.key))
    for (const [candidateKey, targetName] of Object.entries(initialReassignments)) {
      // Skip entries whose source key is no longer in the current candidate list.
      if (!candidateKeySet.has(candidateKey)) continue
      const matchingCandidate = candidates.find(c => c.name === targetName)
      if (matchingCandidate) {
        result.set(candidateKey, { kind: 'candidate', key: matchingCandidate.key })
      } else {
        result.set(candidateKey, { kind: 'custom', name: targetName })
      }
    }
    return result
  })

  // ---------------------------------------------------------------------------
  // Parent notification — GROUP D state-update purity fix.
  //
  // WHY effect-not-updater: calling notifyMapChange inside the setReassignments
  // updater is an impure updater (side effect inside a pure transform).  Under
  // React StrictMode that updater fires twice, double-firing the parent
  // callback and creating non-deterministic ordering relative to the state
  // commit.  The effect runs once, after commit, with the settled state.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    onManualMapChange(buildManualMap(reassignments, candidates))
    // reason: we intentionally skip `candidates` from deps — it is only needed
    // to resolve candidate display names at notification time; its identity
    // changes when the parent re-renders after a discover call, which would
    // re-fire the notification and trigger a new discover, creating a loop.
    // The candidates list is stable between the user's reassignment gestures
    // (the dialog stays open; candidates only change on open/close).  We rely
    // on reassignments being the sole trigger here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reassignments, onManualMapChange])

  /** Set a row's reassignment target.  Clears the entry when ``target`` is null. */
  const setReassignment = useCallback(
    (candidateKey: string, target: ReassignTarget | null) => {
      setReassignments(prev => {
        const next = new Map(prev)
        if (target === null) {
          next.delete(candidateKey)
        } else {
          next.set(candidateKey, target)
        }
        return next
      })
    },
    [],
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
  // Confirm: pass EFFECTIVE selected keys and the current manual_map.
  //
  // Bug 1 fix: ``checked`` stores RAW source keys.  A reassigned row whose
  // source key was pre-checked (because the source formation existed in the
  // model before this dialog opened) still retains its source key in
  // ``checked`` — the checkbox becomes disabled on reassignment (no toggle
  // fires).  If we forward the raw ``checked`` set, the backend's
  // model-scoped delete sees the source key in ``selected_keys`` and keeps
  // the source formation instead of deleting it.
  //
  // Effective-key transformation:
  //   - Row has NO reassignment → pass source key through unchanged.
  //   - Row has 'candidate' reassignment → replace source key with TARGET key
  //     (the target is the formation that will survive; the source key should
  //     not appear in selected_keys, or the backend will keep the source).
  //   - Row has 'custom' reassignment → OMIT source key entirely.  The
  //     backend creates the custom-named formation via manual_map; the source
  //     should be deleted (not in selected_keys).
  //
  // WHY pass the map at confirm time: the parent sends the SAME map that was
  // used for the last preview (discover) call.  This eliminates the race
  // condition where the user edits the map after clicking "Apply selection"
  // but before the apply API call fires — the discover ≡ apply invariant
  // the backend enforces requires both calls to carry the identical map.
  // ---------------------------------------------------------------------------

  const handleConfirm = useCallback(() => {
    // Compute effective selected keys (see Bug 1 comment above).
    const effectiveKeys = new Set<string>()
    for (const key of checked) {
      const target = reassignments.get(key) ?? null
      if (target === null) {
        effectiveKeys.add(key)
      } else if (target.kind === 'candidate') {
        // Replace source key with target key.
        effectiveKeys.add(target.key)
      }
      // custom reassignment → omit (backend creates it via manualMap).
    }
    onConfirm(effectiveKeys, buildManualMap(reassignments, candidates))
  }, [checked, reassignments, candidates, onConfirm])

  // ---------------------------------------------------------------------------
  // Derived: total collision count for the header summary
  // ---------------------------------------------------------------------------

  const totalDropped = useMemo(
    () => collisions.reduce((acc, c) => acc + c.droppedCount, 0),
    [collisions],
  )

  // ---------------------------------------------------------------------------
  // Build the ranked peer candidate list for each row's reassignment dropdown.
  //
  // The dropdown for row X shows every OTHER candidate, ranked by
  // rankByPartialMatch(X.name, otherNames) so the most-similar likely-
  // synonym appears first.  Zero-score names are still in the list —
  // rank-reorders-never-filters.
  //
  // WHY FormationCandidate[] not string[]: using display-name strings makes
  // two candidates with the same display name indistinguishable in the option
  // list — handlePickCandidate would always resolve to the FIRST matching
  // candidate regardless of which option the user clicked.  Carrying the full
  // candidate (including its unique key) through the option list ensures the
  // pick always resolves by key.
  // ---------------------------------------------------------------------------

  /** Map from candidate.key → ranked list of OTHER candidates (by similarity). */
  const rankedTargetsByKey = useMemo(() => {
    const result = new Map<string, FormationCandidate[]>()
    for (const self of candidates) {
      const others = candidates.filter(c => c.key !== self.key)
      const otherNames = others.map(c => c.name)
      // Rank by partial-match similarity to this row's own name.
      const ranked = rankByPartialMatch(self.name, otherNames)
      // Re-map ranked names back to their candidates.  When two candidates
      // share a display name, rankByPartialMatch deduplicates names, so we
      // need to re-attach ALL candidates matching each ranked name in their
      // original relative order.
      const seen = new Set<string>()
      const orderedCandidates: FormationCandidate[] = []
      for (const r of ranked) {
        for (const c of others) {
          if (c.name === r.name && !seen.has(c.key)) {
            seen.add(c.key)
            orderedCandidates.push(c)
          }
        }
      }
      result.set(self.key, orderedCandidates)
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
                const target = reassignments.get(candidate.key) ?? null
                // A reassigned row's include-checkbox follows the target:
                // included iff the target row is included.  WHY: the raw name
                // will be created as the target on the section; it is
                // meaningless to "include" the raw but "exclude" the target.
                //
                // WHY resolve by key not name (GROUP A / B1): two candidates may
                // share the same display name but carry distinct keys.
                // Resolving by key makes the correct candidate's checked state
                // unambiguous regardless of name collisions.
                //
                // WHY 'custom' renders checked + disabled (GROUP A / S2): a
                // custom canonical name WILL be created on Apply; showing it
                // unchecked was misleading.  The row is included (the custom
                // name is the creation target) so we show it checked.
                const isChecked =
                  target === null
                    ? checked.has(candidate.key)
                    : target.kind === 'candidate'
                      ? checked.has(target.key)
                      : true  // custom target — always included (will be created)
                // Display label shown inline next to the candidate name.
                const targetLabel =
                  target === null
                    ? null
                    : target.kind === 'candidate'
                      ? (candidates.find(c => c.key === target.key)?.name ?? null)
                      : target.name
                return (
                  <li key={candidate.key} className="group/row">
                    <div className={[
                      'flex items-start gap-2 py-1.5 px-2 rounded transition-colors',
                      target !== null
                        ? 'bg-surface-page/60 pl-6'   // indented when reassigned
                        : 'hover:bg-surface-page',
                    ].join(' ')}>
                      <label className="flex items-start gap-2 flex-1 min-w-0 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          aria-label={candidate.name}
                          className="mt-0.5 h-3.5 w-3.5 rounded border-border-default text-accent focus:ring-accent focus:ring-1 shrink-0"
                          checked={isChecked}
                          disabled={target !== null}
                          onChange={() => {
                            // Only toggle when not reassigned; when reassigned the
                            // checkbox follows the target row's state.
                            if (target === null) toggle(candidate.key)
                          }}
                        />
                        <span className="flex-1 min-w-0">
                          <span className={[
                            'block text-xs font-medium truncate',
                            target !== null ? 'text-text-muted' : 'text-text-primary',
                          ].join(' ')}>
                            {candidate.name}
                            {targetLabel !== null && (
                              <span className="ml-1.5 text-xs text-accent font-normal not-italic">
                                → {targetLabel}
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
                          candidates={candidates}
                          currentTarget={target}
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
 * ARIA: the trigger is a button with ``aria-haspopup="listbox"`` +
 * ``aria-expanded``.  The popup root IS the ``role="listbox"``; there is no
 * intermediate ``role="dialog"`` wrapper (that was a broken hybrid violating
 * WCAG 2.2 AA).  Options are ``<li role="option">`` on non-button elements
 * so the listbox owns keyboard semantics correctly.
 *
 * Outside-click and Esc (regardless of focus location) both close the
 * dropdown.
 *
 * Parameters
 * ----------
 * candidateKey
 *     The normalised key for this candidate (used as the manual_map key).
 * candidateName
 *     Display name — used as the partial-match query for initial ranking.
 * candidates
 *     Full candidate list — needed to resolve a ``'candidate'`` target's
 *     display name for the trigger label, and to detect when a typed query
 *     exactly matches an existing candidate name (C1 fix).
 * currentTarget
 *     Currently selected ``ReassignTarget``, or null if "Keep separate".
 * rankedTargets
 *     Other candidates pre-ranked by similarity to this row.  Each entry
 *     carries its unique ``key`` so duplicate display names are distinguishable.
 * onSelect
 *     Callback fired with (candidateKey, ReassignTarget | null) — null =
 *     keep separate.
 *
 * Returns
 * -------
 * JSX.Element
 */
function RowReassignDropdown({
  candidateKey,
  candidateName,
  candidates,
  currentTarget,
  rankedTargets,
  onSelect,
}: {
  candidateKey: string
  candidateName: string
  candidates: FormationCandidate[]
  currentTarget: ReassignTarget | null
  rankedTargets: FormationCandidate[]
  onSelect: (key: string, target: ReassignTarget | null) => void
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const buttonId = useId()
  const listboxId = useId()

  // Re-rank as the user types.  NEVER removes options — rank-reorders-never-filters.
  // WHY re-rank on FormationCandidate[]: we rank by display name (the partial-
  // match query is against names), then re-attach the full candidate so the
  // option can always resolve by key.  When two candidates share a name they
  // both survive the ranking and preserve their distinct keys.
  const displayedTargets = useMemo<FormationCandidate[]>(() => {
    if (query.trim() === '') return rankedTargets
    const names = rankedTargets.map(c => c.name)
    const ranked = rankByPartialMatch(query, names)
    // Re-map to candidates in ranked-name order; preserve all candidates with
    // that name so duplicates are not collapsed.
    const seen = new Set<string>()
    const result: FormationCandidate[] = []
    for (const r of ranked) {
      for (const c of rankedTargets) {
        if (c.name === r.name && !seen.has(c.key)) {
          seen.add(c.key)
          result.push(c)
        }
      }
    }
    return result
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

  // Outside-click handler (GROUP B).  Attached to document while open;
  // cleaned up on close/unmount.  Uses pointerdown so it fires before the
  // browser delivers focus/click — matching the standard dismissible-popover
  // contract for comboboxes.
  useEffect(() => {
    if (!open) return
    const handler = (e: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        handleClose()
      }
    }
    document.addEventListener('pointerdown', handler)
    return () => document.removeEventListener('pointerdown', handler)
  }, [open, handleClose])

  // Esc-close regardless of focus (GROUP B).  Separate from the input's
  // onKeyDown so it fires even when focus is on an option button or elsewhere
  // inside the dropdown.
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        handleClose()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, handleClose])

  const handlePickCandidate = useCallback(
    (targetKey: string) => {
      onSelect(candidateKey, { kind: 'candidate', key: targetKey })
      handleClose()
    },
    [candidateKey, onSelect, handleClose],
  )

  const handleKeepSeparate = useCallback(() => {
    onSelect(candidateKey, null)
    handleClose()
  }, [candidateKey, onSelect, handleClose])

  // Enter in the typeahead:
  //   - If the typed string exactly matches a candidate display name → resolve
  //     to that candidate ('candidate' kind), not custom (GROUP A / C1 fix).
  //   - Otherwise → custom canonical name.
  const handleTypeaheadEnter = useCallback(() => {
    const trimmed = query.trim()
    if (trimmed === '' || trimmed === candidateName) {
      handleClose()
      return
    }
    const exactCandidate = candidates.find(c => c.name === trimmed && c.key !== candidateKey)
    if (exactCandidate) {
      onSelect(candidateKey, { kind: 'candidate', key: exactCandidate.key })
    } else {
      onSelect(candidateKey, { kind: 'custom', name: trimmed })
    }
    handleClose()
  }, [query, candidateName, candidateKey, candidates, onSelect, handleClose])

  const handleCustomPick = useCallback(() => {
    const trimmed = query.trim()
    if (trimmed !== '' && trimmed !== candidateName) {
      onSelect(candidateKey, { kind: 'custom', name: trimmed })
    }
    handleClose()
  }, [query, candidateName, candidateKey, onSelect, handleClose])

  // Resolve the trigger label from the discriminated target.
  const currentTargetLabel =
    currentTarget === null
      ? null
      : currentTarget.kind === 'candidate'
        ? (candidates.find(c => c.key === currentTarget.key)?.name ?? null)
        : currentTarget.name

  // Determine aria-selected for the "Keep separate" option.
  const keepSeparateSelected = currentTarget === null

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        id={buttonId}
        type="button"
        aria-label={
          currentTargetLabel !== null
            ? `Reassigned to "${currentTargetLabel}" — click to change`
            : `Reassign "${candidateName}" to another formation`
        }
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        className={[
          'text-xs rounded focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent px-1.5 py-0.5 border transition-colors',
          currentTargetLabel !== null
            ? 'text-accent border-accent/40 bg-accent/5'
            : 'text-text-muted border-border-subtle hover:text-accent hover:border-accent/40 opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100',
        ].join(' ')}
        onClick={open ? handleClose : handleOpen}
      >
        {currentTargetLabel !== null ? `→ ${currentTargetLabel}` : '→ same as'}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 w-56 bg-surface-overlay border border-border-default rounded shadow-lg flex flex-col">
          {/* Typeahead input — sits above the listbox, not inside it */}
          <div className="p-1.5 border-b border-border-subtle">
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => {
                // Esc handled by the document-level effect; stop bubbling here
                // so the modal's own Esc handler doesn't also fire.
                if (e.key === 'Escape') { e.stopPropagation() }
                if (e.key === 'Enter') { e.preventDefault(); handleTypeaheadEnter() }
              }}
              placeholder="Type to re-rank or enter name…"
              aria-label="Filter or type a target formation name"
              className="w-full text-xs px-2 py-1 rounded border border-border-default bg-surface-page text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>

          {/* Option list — the popup root IS the listbox (WCAG 2.2 AA combobox
              pattern).  Options are <li role="option"> on non-button elements so
              the listbox owns keyboard semantics; onClick on each <li> handles
              selection.  No intermediate role="dialog" wrapper. */}
          <ul
            id={listboxId}
            role="listbox"
            aria-label="Target formation options"
            className="max-h-44 overflow-y-auto"
          >
            {/* Keep separate option — always first */}
            <li
              role="option"
              aria-selected={keepSeparateSelected}
              className={[
                'w-full text-left px-3 py-1.5 text-xs transition-colors cursor-pointer',
                keepSeparateSelected
                  ? 'bg-accent/10 text-accent font-medium'
                  : 'text-text-muted hover:bg-surface-page',
              ].join(' ')}
              onClick={handleKeepSeparate}
            >
              Keep separate
            </li>

            {/* Custom-name option — only when user typed something new that
                does not exactly match any existing candidate's display name */}
            {query.trim() !== '' &&
              !rankedTargets.some(c => c.name === query.trim()) &&
              query.trim() !== candidateName && (
                <li
                  role="option"
                  aria-selected={
                    currentTarget?.kind === 'custom' && currentTarget.name === query.trim()
                  }
                  className="w-full text-left px-3 py-1.5 text-xs text-text-primary italic hover:bg-surface-page transition-colors cursor-pointer"
                  onClick={handleCustomPick}
                >
                  Use "{query.trim()}"
                </li>
              )}

            {/* Ranked peer options — each carries a unique key so two
                candidates with the same display name are always distinct. */}
            {displayedTargets.map(peer => {
              const isSelected =
                currentTarget !== null &&
                currentTarget.kind === 'candidate' &&
                currentTarget.key === peer.key
              return (
                <li
                  key={peer.key}
                  role="option"
                  aria-selected={isSelected}
                  className={[
                    'w-full text-left px-3 py-1.5 text-xs transition-colors cursor-pointer',
                    isSelected
                      ? 'bg-accent/10 text-accent font-medium'
                      : 'text-text-primary hover:bg-surface-page',
                  ].join(' ')}
                  onClick={() => handlePickCandidate(peer.key)}
                >
                  {peer.name}
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}
