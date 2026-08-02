// Applying a recovery snapshot — the restore half of crash recovery.
//
// The companion of ``utils/recoverySnapshot`` (what is written) and
// ``hooks/useRecoveryAutosave`` (when it is written). This module owns what
// happens when the user answers "Restore unsaved work".
//
// Five of the six at-risk items (docs/design/autosave-recovery.md §2) have no
// database home at all, so restoring them is a straight assignment — but two
// of those assignments have a non-obvious shape, and both come from the
// design rather than from convenience:
//
//   * The four MANIFEST sets are UNIONED, not replaced. They are
//     "unreconstructed, not lost": the file-seeded manifest is a valid floor,
//     while the localStorage mirror is lossy (DOV dedupe-hit ids and
//     Fill-matched pre-existing formations enter the manifest without
//     entering the session set), so the snapshot's copy is the complete one
//     and has to be added on top.
//   * The five SESSION-IMPORT sets are REPLACED, not merged. They were
//     snapshotted at the same instant as the manifests and "must stay
//     consistent" with them; merging would let a stale localStorage entry
//     from a later, discarded attempt survive the restore.
//
// The sixth item — the lumping map — is the only DOUBLE-written one, so it is
// the only one that reconciles. That rule lives in ``utils/recoveryReconcile``
// and is applied here.
//
// DELIBERATELY OUT OF SCOPE: ``focusedSuggestAnchorId``. The litho segmenter's
// focus mode is one string of UI MODE, not data — the focused anchor's whole
// workspace rides along in item 2 (§2), so a restore loses no triage, it just
// comes back as bulk ghosts with no column focused. Restoring it would mean
// re-entering a UI mode on the user's behalf during an already unusual open,
// which is worse than one click. Snapshot only what a crash actually
// destroys.

import { useCallback, useEffect, useRef } from 'react'
import type { Dispatch, SetStateAction } from 'react'

import type { ProjectUpdatePayload } from '../api/client'
import { log } from '../utils/log'
import type { StratigraphyLumping } from '../utils/projectFile'
import { reconcileLumping } from '../utils/recoveryReconcile'
import { ghostsFromSnapshot } from '../utils/recoverySnapshot'
import type { RecoverySnapshotV1 } from '../utils/recoverySnapshot'
import type { BulkAnchorGhost } from './useGeologicalModel'
import type { ManifestKind } from './useProject'

/** Everything the restore writes into. */
export interface RecoveryRestoreDeps {
  /** Replace the litho ghost workspace wholesale (item 2). */
  setGhostsByAnchor: (ghosts: ReadonlyMap<string, BulkAnchorGhost>) => void
  /** Apply the uncommitted metadata delta in memory (item 3). */
  applyMetadataDraft: (patch: ProjectUpdatePayload) => void
  /** UNION primitive for the four manifest sets (item 4). */
  addToManifest: (kind: ManifestKind, ids: Iterable<string>) => void
  setSessionImportCptIds: Dispatch<SetStateAction<Set<string>>>
  setSessionImportBoreholeIds: Dispatch<SetStateAction<Set<string>>>
  setSessionImportFormationIds: Dispatch<SetStateAction<Set<string>>>
  setSessionImportSectionIds: Dispatch<SetStateAction<Set<string>>>
  setSessionImportContactIds: Dispatch<SetStateAction<Set<string>>>
  /** Item 6 — one bit, and the nastiest of the six to lose. */
  setHasUnsavedMutations: (value: boolean) => void
  /** The lumping map the app holds after the open resolved DB vs file. */
  currentLumping: StratigraphyLumping | null
  /** The revision that came with it — what the file's is compared against. */
  lumpingRevision: number | null
  /** Stage a map; the explicit revision is the replay case (§3). */
  stageLumping: (
    lumping: StratigraphyLumping | null,
    revision?: number,
  ) => Promise<void>
}

/** What the recovery prompt calls when the user chooses Restore. */
export interface UseRecoveryRestoreResult {
  /**
   * Apply a validated snapshot to the open project.
   *
   * Resolves once the lumping reconciliation (the only step that can touch
   * the network) has settled; the in-memory writes all land synchronously
   * before that.
   */
  restoreFromSnapshot: (snapshot: RecoverySnapshotV1) => Promise<void>
}

/**
 * Restore the six at-risk items from a recovery snapshot.
 *
 * @param deps - The setters and the current lumping state. Read through a
 *   per-render ref so the returned callback keeps a stable identity — the
 *   recovery prompt holds it across the whole offer, and re-creating it on
 *   every unrelated App render would churn the dialog's props for nothing.
 * @returns {@link UseRecoveryRestoreResult}.
 */
export function useRecoveryRestore(deps: RecoveryRestoreDeps): UseRecoveryRestoreResult {
  const depsRef = useRef(deps)
  useEffect(() => {
    depsRef.current = deps
  })

  const restoreFromSnapshot = useCallback(
    async (snapshot: RecoverySnapshotV1): Promise<void> => {
      const d = depsRef.current

      // Item 2 — the litho ghost workspace. ``ghostsFromSnapshot`` is the
      // codec's own decoder: it puts the Sets and Maps back that the plain-
      // JSON contract forced into arrays.
      d.setGhostsByAnchor(ghostsFromSnapshot(snapshot))

      // Item 3 — the metadata draft. Skipped when empty: ``applyMetadataDraft``
      // is a ``setProject``, and firing it with an empty patch would rerender
      // the whole tree to change nothing.
      if (Object.keys(snapshot.metadataDraftPatch).length > 0) {
        d.applyMetadataDraft(snapshot.metadataDraftPatch as ProjectUpdatePayload)
      }

      // Item 4 — the manifests, UNIONED onto the file-seeded floor.
      if (snapshot.manifests.cpt.length > 0) d.addToManifest('cpt', snapshot.manifests.cpt)
      if (snapshot.manifests.borehole.length > 0) {
        d.addToManifest('borehole', snapshot.manifests.borehole)
      }
      if (snapshot.manifests.formation.length > 0) {
        d.addToManifest('formation', snapshot.manifests.formation)
      }
      if (snapshot.manifests.section.length > 0) {
        d.addToManifest('section', snapshot.manifests.section)
      }

      // Item 5 — the session-import sets, REPLACED so they stay consistent
      // with the manifest snapshot taken at the same instant.
      d.setSessionImportCptIds(new Set(snapshot.sessionImports.cpt))
      d.setSessionImportBoreholeIds(new Set(snapshot.sessionImports.borehole))
      d.setSessionImportFormationIds(new Set(snapshot.sessionImports.formation))
      d.setSessionImportSectionIds(new Set(snapshot.sessionImports.section))
      d.setSessionImportContactIds(new Set(snapshot.sessionImports.contact))

      // Item 6 — the dirty bit. Written unconditionally, including ``false``:
      // a snapshot taken while clean says so, and inferring it would be a
      // second source of truth for the one bit that stops a later Discard
      // from wiping pre-crash work.
      d.setHasUnsavedMutations(snapshot.hasUnsavedMutations)

      // Item 1 — the only double-written item, so the only one that
      // reconciles. Revision wins; never the clock.
      const outcome = reconcileLumping(
        { lumping: snapshot.lumping.current, revision: snapshot.lumping.revision },
        { lumping: d.currentLumping, revision: d.lumpingRevision },
      )
      if (outcome.action === 'replay-file') {
        log.info('recovery', `lumping restored from the recovery file (${outcome.reason})`)
        await d.stageLumping(outcome.lumping, outcome.revision)
      } else if (outcome.action === 'prefer-database' && outcome.conflict) {
        // The design calls this row a bug, not a conflict — the two writers
        // agreed on a revision and disagreed on its content, which no
        // ordinary sequence of events produces.
        log.error(
          'recovery',
          `recovery reconciliation: equal revision, different content — preferring the DB (${outcome.reason})`,
        )
      } else {
        log.debug('recovery', `lumping needs no reconciliation (${outcome.reason})`)
      }

      log.success(
        'recovery',
        `restored unsaved work: ${snapshot.ghosts.length} ghost columns, ` +
          `${snapshot.sessionImports.cpt.length + snapshot.sessionImports.borehole.length} imported investigations`,
      )
    },
    [],
  )

  return { restoreFromSnapshot }
}
