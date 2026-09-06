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
import { formationStableKey, normaliseFormationKey } from '../../../utils/formationKey'
import { rankByPartialMatch } from '../../../utils/partialMatch'
import { useT } from '../../../i18n/translate'

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

/**
 * Rebuild the row-reassignment state from a persisted ``manual_map`` snapshot.
 *
 * Every entry in the snapshot is KEPT.  There is deliberately no
 * "drop entries whose source key is not a current candidate" filter — see the
 * 2026-08-03 note below.
 *
 * A target that exactly matches a current candidate's display name is restored
 * as ``{kind: 'candidate', key}`` so ``buildManualMap`` re-resolves the wire
 * name from the live candidate (survives a name drift between sessions).
 * Everything else is restored as ``{kind: 'custom', name}`` and travels
 * verbatim.
 *
 * WHY no candidate-presence filter (2026-08-03 data-loss incident): the
 * discover scan returns EFFECTIVE keys.  A raw key the user has lumped away is
 * therefore ABSENT from ``candidates`` by construction — indistinguishable
 * from a genuinely stale key left over from a different borehole set.  The old
 * filter could not tell them apart and deleted the user's groupings on every
 * reopen.  Carrying an unknown source key costs nothing: the server applies
 * ``manual_map`` only to raw keys it actually encounters, so an entry for a key
 * that never appears is a no-op.  Losing a real grouping costs the engineer
 * their work — the asymmetry decides it.
 *
 * Parameters
 * ----------
 * initialReassignments
 *     Persisted ``{ candidateKey → targetDisplayName }`` snapshot, or absent.
 * candidates
 *     Current candidate list, used only to pick the target discriminant.
 *
 * Returns
 * -------
 * RowReassignments
 *     Reconstructed per-row state (empty when the snapshot is empty/absent).
 */
function buildInitialReassignments(
  initialReassignments: Record<string, string> | undefined,
  candidates: FormationCandidate[],
): RowReassignments {
  const result: RowReassignments = new Map()
  if (!initialReassignments) return result
  for (const [candidateKey, targetName] of Object.entries(initialReassignments)) {
    const matchingCandidate = candidates.find(c => c.name === targetName)
    if (matchingCandidate) {
      result.set(candidateKey, { kind: 'candidate', key: matchingCandidate.key })
    } else {
      result.set(candidateKey, { kind: 'custom', name: targetName })
    }
  }
  return result
}

/**
 * Pre-check the candidates that already exist as formations in the model.
 *
 * Parameters
 * ----------
 * candidates
 *     Current candidate list.
 * currentFormations
 *     Formations already in the model; matched on the same stable key the
 *     server uses (``regional_ref`` when present, else ``name``).
 *
 * Returns
 * -------
 * ReadonlySet<string>
 *     Candidate keys that start out checked.
 */
function buildInitialChecked(
  candidates: FormationCandidate[],
  currentFormations: GeologicalFormationResponse[],
): ReadonlySet<string> {
  // Normalised on BOTH sides — a raw .toLowerCase() reads
  // "paleogeen: formatie van aalter" as a different unit from the server's
  // "paleogeen formatie van aalter", so every punctuated formation silently
  // failed to pre-check and went into Apply looking unselected.
  const currentKeys = new Set(currentFormations.map(formationStableKey))
  return new Set(
    candidates.filter(c => currentKeys.has(normaliseFormationKey(c.key))).map(c => c.key),
  )
}

/**
 * Reduce a DOV catalogue name to its member/unit name.
 *
 * The DOV formal-stratigraphy lexicon names a member as
 * ``"Lid van <member> (Formatie van <formation>)"``.  The member is what makes
 * two codes "the same unit": ``TtEg`` → ``"Lid van Egem (Formatie van Tielt)"``
 * and ``HyEg`` → ``"Lid van Egem (Formatie van Hyon)"`` (the 2017 NCS renamed
 * Tielt to Hyon) both reduce to ``"Lid van Egem"``.  Offering the member as the
 * one-click lumping target is therefore how old and new codes for one member
 * are recognised as one unit (owner ruling 2026-09-05).
 *
 * A formation- or group-level name (``"Formatie van Boom"``,
 * ``"Groep van Quartaire afzetting"``) has no parenthetical and is returned
 * unchanged.
 *
 * Parameters
 * ----------
 * catalogName
 *     The full canonical Dutch name from the DOV lexicon.
 *
 * Returns
 * -------
 * string
 *     The member/unit name (the text before the first ``" ("``), trimmed.
 */
function dovMemberName(catalogName: string): string {
  const idx = catalogName.indexOf(' (')
  return (idx >= 0 ? catalogName.slice(0, idx) : catalogName).trim()
}

/**
 * The DOV member name to offer as a one-click lumping target for a candidate.
 *
 * Uses the highest-count formal code the DOV lexicon knows (``formalCodes`` is
 * already sorted count-descending by the backend), reduced to its member name.
 * Returns ``null`` when no formal code resolves in the lexicon — the dialog
 * then offers no DOV target and the engineer lumps by hand as before.
 *
 * Parameters
 * ----------
 * candidate
 *     The candidate whose formal codes to consult.
 *
 * Returns
 * -------
 * string | null
 *     The member name, or ``null`` when the catalogue knows none of the codes.
 */
function suggestedDovName(candidate: FormationCandidate): string | null {
  for (const fc of candidate.formalCodes ?? []) {
    if (fc.catalogName) return dovMemberName(fc.catalogName)
  }
  return null
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
   * under ``stratigraphy_lumping.map``.  EVERY entry is restored, including
   * ones whose ``candidateKey`` is absent from the current ``candidates``
   * list — a lumped-away raw key looks exactly like that, and dropping it
   * destroys the user's grouping (see ``buildInitialReassignments``).
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
  const t = useT()
  // ---------------------------------------------------------------------------
  // Checked state — stable keys
  // ---------------------------------------------------------------------------

  const [checked, setChecked] = useState<ReadonlySet<string>>(() =>
    buildInitialChecked(candidates, currentFormations),
  )

  // ---------------------------------------------------------------------------
  // Per-row reassignment state
  //
  // Maps each reassigned candidate key to a discriminated ReassignTarget.
  // An absent entry means "keep separate" (no lumping for that row).
  //
  // WHY Map-not-object: Map iterates in insertion order and avoids prototype
  // collisions on arbitrary formation names.
  // ---------------------------------------------------------------------------

  // Restore previously applied reassignments from the persisted lumping
  // snapshot.  See ``buildInitialReassignments`` for why every entry is kept.
  const [reassignments, setReassignments] = useState<RowReassignments>(() =>
    buildInitialReassignments(initialReassignments, candidates),
  )

  // ---------------------------------------------------------------------------
  // Re-seed both state slices on the closed→open transition.
  //
  // WHY this exists at all (2026-08-03 data-loss incident): GeologyToolbar
  // mounts this dialog for the whole session and flips ``open`` later — Modal
  // renders nothing while closed, but this component body still runs.  Both
  // lazy ``useState`` initialisers therefore ran exactly once, at TOOLBAR
  // mount, when ``open`` was false and ``candidates`` was ``[]``: no persisted
  // grouping could be restored and no existing formation could be pre-checked,
  // and neither initialiser ever ran again once the discover results arrived.
  // The dialog opened blank every time and Apply carried that blankness to the
  // server.
  //
  // WHY during render rather than in an effect: this is React's documented
  // "adjusting state when a prop changes" pattern.  Re-seeding in an effect
  // would let one commit escape with the pre-seed values — and the parent
  // notification below would publish that empty map, which is the exact bug.
  // ---------------------------------------------------------------------------
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setReassignments(buildInitialReassignments(initialReassignments, candidates))
      setChecked(buildInitialChecked(candidates, currentFormations))
    }
  }

  // ---------------------------------------------------------------------------
  // Parent notification — GROUP D state-update purity fix.
  //
  // WHY effect-not-updater: calling notifyMapChange inside the setReassignments
  // updater is an impure updater (side effect inside a pure transform).  Under
  // React StrictMode that updater fires twice, double-firing the parent
  // callback and creating non-deterministic ordering relative to the state
  // commit.  The effect runs once, after commit, with the settled state.
  //
  // WHY the callback goes through a ref (2026-08-03): the parent declares
  // ``onManualMapChange`` as a plain function in its body, so it has a new
  // identity on EVERY parent render.  With it in the dependency array, any
  // unrelated re-render re-published the current map to the parent — which is
  // how the empty mount-time map became the map used for every later discover.
  // A re-render is not a user gesture and must not notify.
  // ---------------------------------------------------------------------------
  const onManualMapChangeRef = useRef(onManualMapChange)
  onManualMapChangeRef.current = onManualMapChange
  useEffect(() => {
    // Nothing to publish while the dialog is closed — the parent has no
    // pending borehole scope then, and a closed dialog has no user intent.
    if (!open) return
    onManualMapChangeRef.current(buildManualMap(reassignments, candidates))
    // reason: `candidates` is intentionally out of deps — it is only read to
    // resolve display names at notification time, and its identity changes on
    // every parent re-render after a discover call, which would re-fire the
    // notification and trigger a new discover, looping. `onManualMapChange` is
    // out of deps for the identity-churn reason documented above and is read
    // through a ref so it is never stale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reassignments, open])

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
    const checkedKeys = new Set(Array.from(checked).map(normaliseFormationKey))
    const toDelete = currentFormations.filter(f => !checkedKeys.has(formationStableKey(f)))
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
          {t('geology.fillFromBoreholes')}
        </h2>
        <p className="mt-1 text-xs text-text-secondary">{t('geology.selectFormationsBlurb')}</p>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto min-h-0">

        {/* ── Candidate list ──────────────────────────────────────────── */}
        <section aria-label={t('geology.formationCandidates')} className="px-5 pt-4 pb-4">
          {/* Select all/none row */}
          <div className="flex items-center gap-2 mb-2">
            <span className="flex-1 text-xs text-text-muted">
              {t(
                candidates.length === 1
                  ? 'geology.formationsFoundOne'
                  : 'geology.formationsFoundMany',
                { n: candidates.length },
              )}
            </span>
            <button
              type="button"
              className="text-xs text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded shrink-0"
              onClick={selectAll}
            >
              {t('geology.candAll')}
            </button>
            <button
              type="button"
              className="text-xs text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded shrink-0"
              onClick={selectNone}
            >
              {t('geology.candNone')}
            </button>
          </div>

          {candidates.length === 0 ? (
            <p className="py-4 text-center text-xs text-text-muted">
              {t('geology.noStratigraphyCandidates')}
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
                // DOV formal codes behind this candidate (owner dogfeed
                // 2026-09-05).  The muted line shows the code(s); the title
                // tooltip carries the per-code borehole counts + catalogue
                // names, so a formal↔informal disagreement is legible.
                const formalCodes = candidate.formalCodes ?? []
                // Inline: "GeVl (4)" per code, so the count is visible without
                // hover and a disagreement (several codes) reads at a glance;
                // the "(N)" is only a number, no word to translate.
                const dovCodesLabel =
                  formalCodes.length > 0
                    ? formalCodes.map(fc => `${fc.code} (${fc.count})`).join(', ')
                    : null
                const dovTitle = formalCodes
                  .map(fc => {
                    const line = t('geology.dovCodeTip', {
                      code: fc.code,
                      count: fc.count,
                      word: t(
                        fc.count === 1
                          ? 'geology.boreholeWordOne'
                          : 'geology.boreholeWordMany',
                      ),
                    })
                    // catalogName is DOV domain data (a raw token shown as-is),
                    // appended for provenance; null when the code is unknown.
                    return fc.catalogName ? `${line} — ${fc.catalogName}` : line
                  })
                  .join('\n')
                // One-click "accept the DOV code's own formation" target — only
                // when not already reassigned and the lexicon knows a code.
                const dovSuggestion = target === null ? suggestedDovName(candidate) : null
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
                            {t(
                              candidate.boreholeCount === 1
                                ? 'geology.foundInBoreholesOne'
                                : 'geology.foundInBoreholesMany',
                              { n: candidate.boreholeCount },
                            )}
                          </span>
                          {dovCodesLabel !== null && (
                            <span
                              className="block text-xs text-text-muted font-mono"
                              title={dovTitle}
                            >
                              {t('geology.dovCodes', { codes: dovCodesLabel })}
                            </span>
                          )}
                        </span>
                      </label>

                      {/* One-click "use the DOV code's own formation" target.
                          Sets a custom reassignment to the DOV member name, so
                          old/new codes for the same member (TtEg/HyEg = Egem)
                          converge on the same target. */}
                      {dovSuggestion !== null && (
                        <button
                          type="button"
                          className="shrink-0 self-start text-xs rounded px-1.5 py-0.5 border border-border-subtle text-text-muted hover:text-accent hover:border-accent/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent transition-colors"
                          onClick={() =>
                            setReassignment(candidate.key, { kind: 'custom', name: dovSuggestion })
                          }
                        >
                          {t('geology.useDovName', { name: dovSuggestion })}
                        </button>
                      )}

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
            aria-label={t('geology.lumpingCollisions')}
            className="px-5 pb-4 pt-2 border-t border-border-subtle"
          >
            <h3 className="text-xs font-semibold text-status-warning uppercase tracking-wide mb-2 mt-2 flex items-center gap-1">
              <span aria-hidden="true">⚠</span>
              {collisionsUpdating ? (
                <span className="text-text-muted normal-case font-normal">
                  {t('geology.updating')}
                </span>
              ) : (
                <>
                  {t('geology.collisionSummary', {
                    count: collisions.length,
                    boreholeWord: t(
                      collisions.length === 1
                        ? 'geology.boreholeWordOne'
                        : 'geology.boreholeWordMany',
                    ),
                    dropped: totalDropped,
                    boundaryWord: t(
                      totalDropped === 1
                        ? 'geology.boundaryWordOne'
                        : 'geology.boundaryWordMany',
                    ),
                  })}
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
                      {t('geology.collisionInBorehole')}{' '}
                      <span className="font-mono">{col.boreholeId.slice(0, 8)}…</span>
                      {t('geology.collisionCollidingNames')}{' '}
                      {col.collidingRawNames.map((n, j) => (
                        <span key={j}>
                          {j > 0 && ', '}
                          <span className="italic">{n}</span>
                        </span>
                      ))}
                      {t('geology.collisionKept', {
                        top: col.keptTopM,
                        dropped: col.droppedCount,
                      })}
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
          {/* No longer a promise of deletion — Apply asks first (2026-08-03).
              Kept as an at-risk heads-up so the choice on the next dialog is
              not a surprise.  Amber, not red: nothing is destroyed by getting
              here, and red is reserved for committed destructive intent
              (tailwind.config.js status-amber / status-danger split). */}
          <p className="text-xs text-status-amber font-medium">
            {t('geology.deletionWarning', {
              fCount: deletedFormationCount,
              formationWord: t(
                deletedFormationCount === 1
                  ? 'geology.formationWordOne'
                  : 'geology.formationWordMany',
              ),
              cCount: deletedContactCount,
              contactWord: t(
                deletedContactCount === 1 ? 'geology.contactWordOne' : 'geology.contactWordMany',
              ),
            })}
          </p>
        </div>
      )}

      {/* Footer */}
      <div className="flex justify-end gap-2 px-5 py-4 border-t border-border-default">
        <Button variant="secondary" size="md" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        {/* Apply is no longer the destructive step (2026-08-03): when the
            selection would remove something, Apply opens the add-vs-overwrite
            prompt, and THAT dialog default-focuses Cancel per docs/ux.md.
            Confirming here is always safe, so it keeps the focus and the
            primary variant regardless of `willDelete`. */}
        <Button
          variant="primary"
          size="md"
          onClick={handleConfirm}
          disabled={checked.size === 0 && currentFormations.length === 0}
          // reason: autoFocus on the confirm button — this step no longer
          // deletes anything, so Enter cannot cause an irreversible action.
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
        >
          {t('geology.applySelection')}
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
  const t = useT()
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
            ? t('geology.reassignedToClickChange', { label: currentTargetLabel })
            : t('geology.reassignToAnother', { name: candidateName })
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
        {currentTargetLabel !== null ? `→ ${currentTargetLabel}` : t('geology.sameAs')}
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
              placeholder={t('geology.rerankPlaceholder')}
              aria-label={t('geology.filterFormationPlaceholder')}
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
            aria-label={t('geology.targetFormationOptions')}
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
              {t('geology.keepSeparate')}
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
                  {t('geology.useCustomName', { name: query.trim() })}
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
