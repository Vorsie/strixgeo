// Detecting a crash and offering the restore — ONE place, not N open paths.
//
// Crash detection has no sentinel and no heartbeat
// (docs/design/autosave-recovery.md §4): the clean exits delete the recovery
// file, so a file present when a project opens means the previous session
// never reached one. That check therefore belongs at the project level, keyed
// on the open project's id — NOT in each of the four open paths
// (``openProjectFile``, ``pickAndOpenProject``, the 404-restore branch and the
// welcome screen's recent list), which would be four places to forget.
//
// Hard rule from the design: a malformed payload must offer NOTHING. Recovery
// exists to protect an open, and may never break one — so every failure mode
// here (missing file, unparseable payload, IPC error) degrades to "no offer"
// plus a log line, never to a thrown error or a broken start.

import { useCallback, useEffect, useRef, useState } from 'react'

import { log } from '../utils/log'
import { parseRecoverySnapshot, snapshotHasDbDelta } from '../utils/recoverySnapshot'
import type { RecoverySnapshotV1 } from '../utils/recoverySnapshot'

/** A pending "restore unsaved work?" offer for the open project. */
export interface RecoveryOffer {
  /** The project the recovery file belongs to. */
  projectId: string
  /** Name for the prompt's title. */
  projectName: string
  /** The validated payload — the prompt itemises it, restore applies it. */
  snapshot: RecoverySnapshotV1
  /** When the file was written, for the age line; null when unavailable. */
  writtenAt: string | null
}

/** Inputs to {@link useRecoveryOffer}. */
export interface UseRecoveryOfferOptions {
  /** The open project's id, or null on the welcome screen. */
  projectId: string | null
  /** The open project's name, for the prompt's title. */
  projectName: string | null
  /** Called with the validated snapshot when the user chooses Restore. */
  onRestore: (snapshot: RecoverySnapshotV1) => void | Promise<void>
  /**
   * Called after Delete backup removes the file, to destroy whatever of the
   * backup's contents ALSO lives outside it — today the lumping map's staged
   * database slot. Owner ruling 2026-08-03: Delete backup means "no traces",
   * and without this the one item the prompt itemises survives through its
   * second home and the project reopens dirty with a discarded map.
   */
  onDiscardResidue?: () => Promise<void>
  /**
   * Called BEFORE Delete backup touches anything. Owner ruling 2026-08-03
   * (second half, from dogfeeding a destructive crash-session Apply):
   * "Delete backup" means the crashed session NEVER HAPPENED — the project
   * returns to its last save, database included, not merely minus the
   * renderer-only extras. The caller runs the anchored revert here and
   * returns false to ABORT the discard (revert refused or failed): the
   * backup must then survive, because it is the only remaining record of
   * the session the user just tried to erase.
   *
   * SKIPPED when the snapshot records no database delta
   * (``snapshotHasDbDelta``) — the revert would be a tens-of-seconds no-op
   * (owner defect 2026-08-12: "Delete backup holds the app busy for too
   * long").
   */
  onBeforeDiscard?: () => Promise<boolean>
  /**
   * Called after a successful discard (file gone, residue gone). The caller
   * reloads the project from disk so the reverted database state is what
   * the user is looking at, not the crashed session's leftovers in memory.
   * Skipped together with ``onBeforeDiscard`` on the no-DB-delta fast path —
   * nothing reverted, so there is nothing new to load.
   */
  onAfterDiscard?: () => Promise<void>
}

/** The offer plus the three answers the design allows. */
export interface UseRecoveryOfferResult {
  /** Non-null while the prompt should be shown. */
  offer: RecoveryOffer | null
  /**
   * "Restore unsaved work" — applies the snapshot and KEEPS a copy on disk,
   * promoted into the primary slot (the restored state is at risk again).
   */
  restoreOffer: () => Promise<void>
  /**
   * "Open without restoring" — preserves the copy in the declined slot, so a
   * restart offers the same unsaved work again.
   */
  dismissOffer: () => Promise<void>
  /** "Discard unsaved work" — deletes the file. Irreversible. */
  discardOffer: () => Promise<void>
  /** True while Discard reverts the database and deletes the file (the prompt shows busy). */
  discarding: boolean
}

/**
 * Offer a crash-recovery restore for the freshly-opened project.
 *
 * @param options - See {@link UseRecoveryOfferOptions}.
 * @returns The pending offer and the three answers.
 */
export function useRecoveryOffer({
  projectId,
  projectName,
  onRestore,
  onDiscardResidue,
  onBeforeDiscard,
  onAfterDiscard,
}: UseRecoveryOfferOptions): UseRecoveryOfferResult {
  const [offer, setOffer] = useState<RecoveryOffer | null>(null)
  // True while Discard is reverting the database and deleting the file, so the
  // prompt can show it is busy instead of sitting there unchanged for the
  // seconds a forced replace-restore takes (owner 2026-09-11: "the dialog
  // window stays too long on screen").
  const [discarding, setDiscarding] = useState(false)

  // Which project ids have already been answered this session. Without it,
  // any App re-render that re-runs the effect would resurrect a prompt the
  // user just dismissed — and the effect legitimately re-runs on every
  // project switch, so a single boolean would not do.
  const answered = useRef<Set<string>>(new Set())

  // ``onRestore`` closes over App's setters and changes identity every
  // render; reading it through a ref keeps ``restoreOffer`` stable and stops
  // the detection effect from re-firing for a reason that has nothing to do
  // with which project is open.
  const onRestoreRef = useRef(onRestore)
  useEffect(() => {
    onRestoreRef.current = onRestore
  })

  const projectNameRef = useRef(projectName)
  useEffect(() => {
    projectNameRef.current = projectName
  })

  useEffect(() => {
    if (projectId === null) return
    if (answered.current.has(projectId)) return
    // Guards against a late resolve landing after the user switched projects
    // (or already answered) — the offer would otherwise name the wrong one.
    let cancelled = false

    void (async () => {
      let raw: unknown
      try {
        raw = await window.electron.readRecovery(projectId)
      } catch (err) {
        // A failed read is not a failed open. Log and offer nothing.
        log.warn('recovery', `could not read the recovery file for ${projectId}`, err)
        return
      }
      if (cancelled) return
      if (raw === null || raw === undefined) {
        log.debug('recovery', `no recovery file for ${projectId} — previous exit was clean`)
        return
      }

      const snapshot = parseRecoverySnapshot(raw)
      if (snapshot === null) {
        // ``parseRecoverySnapshot`` already logged the specific reason.
        log.warn('recovery', `recovery file for ${projectId} is unusable; offering nothing`)
        return
      }

      // The write time lives on the descriptor, not in the payload, so the
      // age line costs one extra (payload-free) call. Best-effort: an
      // unavailable list costs the age line, not the offer.
      let writtenAt: string | null = null
      try {
        const descriptors = await window.electron.listRecovery()
        writtenAt = descriptors.find(d => d.projectId === projectId)?.writtenAt ?? null
      } catch (err) {
        log.warn('recovery', 'could not list recovery files for the age line', err)
      }
      if (cancelled) return

      log.info('recovery', `offering to restore unsaved work for ${projectId}`)
      setOffer({
        projectId,
        projectName: projectNameRef.current ?? '',
        snapshot,
        writtenAt,
      })
    })()

    return () => {
      cancelled = true
    }
  }, [projectId])

  // The three answers share one shape, and the ORDER inside it is load-bearing
  // twice over:
  //
  //   1. ``answered.current.add`` runs first and synchronously. It is the
  //      double-click guard, and a guard set after the first ``await`` is no
  //      guard at all — a second click would run the whole sequence again.
  //   2. ``setOffer(null)`` runs LAST, after the disk work. App suspends the
  //      autosave scheduler while an offer is pending
  //      (``suspended={recoveryOffer !== null}``), so clearing the offer first
  //      would un-suspend the scheduler mid-sequence and let a debounced write
  //      land between two IPC calls that are rearranging the very same files.
  //
  // The dialog therefore stays up for the duration of a couple of IPC round
  // trips. That is the point: the answer is not finished until the files are.

  /** Claim the answer for this project — the synchronous double-click guard. */
  const claimAnswer = useCallback((id: string): boolean => {
    if (answered.current.has(id)) return false
    answered.current.add(id)
    return true
  }, [])

  /** Close the prompt, which also un-suspends the autosave scheduler. */
  const closeOffer = useCallback((id: string): void => {
    answered.current.add(id)
    setOffer(null)
  }, [])

  // WHY the side effects sit OUTSIDE the state updater: React.StrictMode
  // double-invokes updater functions to surface impure ones, so a
  // ``setOffer(current => { ...apply the restore...; return null })`` applies
  // the restore TWICE — two ``stageLumping`` PUTs today, and worse the day
  // restore grows a step that is not idempotent. The updaters below are pure
  // (``setOffer(null)``); everything with a consequence runs here, guarded by
  // the ``answered`` set so a double click cannot get through either.
  //
  // A copy is deliberately KEPT: the restored state is at risk all over again,
  // and the autosave scheduler takes over keeping it fresh. But it has to be
  // kept in the PRIMARY slot. A copy that came out of the DECLINED slot and is
  // left there would be re-offered at every launch forever — the scheduler
  // writes and clears only the primary slot, so nothing else would ever end
  // the decline, and a user who restores could never make the prompt stop.
  //
  // WHY write-then-delete and never the reverse: the app can die between the
  // two calls. Deleting first would leave an instant in which the only copy of
  // the restored, at-risk work is the one in memory — precisely the loss this
  // whole feature exists to prevent. Writing first is idempotent when the
  // snapshot already came from the primary slot (it rewrites the same content)
  // and is the durable replacement when it did not.
  const restoreOffer = useCallback(async (): Promise<void> => {
    const current = offer
    if (current === null || !claimAnswer(current.projectId)) return
    try {
      await onRestoreRef.current(current.snapshot)
      let promoted = false
      try {
        await window.electron.writeRecovery(current.projectId, current.snapshot, {
          projectName: current.projectName,
        })
        promoted = true
      } catch (err) {
        // No durable replacement exists, so the declined copy — if that is
        // where this came from — must stay exactly where it is.
        log.warn('recovery', `could not promote the restored copy for ${current.projectId}`, err)
      }
      if (promoted) {
        try {
          const endedDecline = await window.electron.deleteDeclinedRecovery(current.projectId)
          log.info(
            'recovery',
            `restored unsaved work for ${current.projectId}; declined copy ${
              endedDecline ? 'cleared' : 'was not there'
            }`,
          )
        } catch (err) {
          // Cosmetic-ish: the work is safe in the primary slot. The cost is
          // one more re-offer at the next launch, which is the safe direction.
          log.warn('recovery', `could not clear the declined copy for ${current.projectId}`, err)
        }
      }
    } finally {
      setOffer(null)
    }
  }, [offer, claimAnswer])

  // "Open without restoring" PRESERVES the copy (owner decision 2026-08-03,
  // Word-style): a restart offers the same unsaved work again, and only the
  // prompt's Discard destroys it.
  //
  // Deleting nothing — all the original design specified — did NOT deliver
  // that. The file stayed in the slot the autosave scheduler writes, so this
  // session overwrote it as soon as it had anything at risk and the next
  // decided exit cleared it; declining and then closing destroyed unrestored
  // work silently. Two changes fix it: this call moves the copy to a slot the
  // scheduler never touches, and every clear outside the prompt now clears
  // only the scheduler's own slot.
  //
  // WHY the snapshot is written back BEFORE the move: the same overwrite race
  // reaches into the seconds this dialog is up. A crash-reopened project is
  // at risk from the moment it mounts (the session-import sets survive in
  // localStorage), so the scheduler can have replaced the crashed session's
  // file with this session's — much thinner — delta before the user answers.
  // Moving THAT would keep a promise in name only. The offered snapshot is
  // the copy the prompt itemised, so it is what gets preserved. The cost is
  // the write timestamp: the next launch dates the copy from the decline
  // rather than from the crash. Payload fidelity is worth more than age
  // fidelity — the age line informs a judgement, the payload IS the work.
  const dismissOffer = useCallback(async (): Promise<void> => {
    const current = offer
    if (current === null || !claimAnswer(current.projectId)) return
    try {
      try {
        await window.electron.writeRecovery(current.projectId, current.snapshot, {
          projectName: current.projectName,
        })
      } catch (err) {
        // Keep going: moving whatever is on disk into the declined slot still
        // beats leaving it where the scheduler will overwrite it.
        log.warn('recovery', `could not pin the offered snapshot for ${current.projectId}`, err)
      }
      try {
        const preserved = await window.electron.declineRecovery(current.projectId)
        log.info(
          'recovery',
          `opened ${current.projectId} without restoring; copy ${
            preserved ? 'preserved for the next launch' : 'was already gone'
          }`,
        )
      } catch (err) {
        // A failed decline costs the copy at the next clean exit — bad, but
        // not a reason to strand the user in a dialog they answered, hence
        // the ``finally`` that closes the prompt either way.
        log.warn('recovery', `could not preserve the recovery copy for ${current.projectId}`, err)
      }
    } finally {
      closeOffer(current.projectId)
    }
  }, [offer, claimAnswer, closeOffer])

  const discardOffer = useCallback(async (): Promise<void> => {
    const current = offer
    if (current === null || !claimAnswer(current.projectId)) return
    setDiscarding(true)
    try {
      // Owner ruling 2026-08-03: Delete backup = the crashed session never
      // happened. The caller reverts the DATABASE to the last save first;
      // an aborted revert keeps the backup — it is the only remaining
      // record of the session the user asked to erase.
      //
      // Fast path (owner defect 2026-08-12: "Delete backup holds the app
      // busy for too long"): when the snapshot proves the session never
      // touched the database, the revert — a full replace-restore of the
      // project tree — and the post-discard reload are semantic no-ops
      // costing tens of seconds of blocked dialog, so BOTH are skipped and
      // Discard is instant. A snapshot that cannot prove cleanliness takes
      // the slow path; see ``snapshotHasDbDelta`` for what counts as proof.
      const dbDelta = snapshotHasDbDelta(current.snapshot)
      if (!dbDelta) {
        log.info(
          'recovery',
          `no DB delta recorded for ${current.projectId} — revert skipped`,
        )
      }
      if (dbDelta && onBeforeDiscard !== undefined) {
        const proceed = await onBeforeDiscard()
        if (!proceed) {
          log.warn(
            'recovery',
            `discard aborted for ${current.projectId}: the pre-discard revert did not ` +
              `complete — the backup file is kept`,
          )
          return
        }
      }
      await window.electron.deleteRecovery(current.projectId)
      log.info('recovery', `discarded the recovery file for ${current.projectId}`)
      // "No traces" (owner ruling 2026-08-03) extends past the file: whatever
      // of the backup's contents lives in a second home dies with it too.
      // AFTER the delete, not before — a residue failure must not leave the
      // file alive when the user was told it is gone.
      if (onDiscardResidue !== undefined) {
        try {
          await onDiscardResidue()
        } catch (err) {
          log.warn(
            'recovery',
            `discard residue cleanup failed for ${current.projectId} — the backup file ` +
              `is gone but its database-homed contents may linger until the next save`,
            err,
          )
        }
      }
      if (dbDelta && onAfterDiscard !== undefined) {
        // Reload so the reverted database is what the user is looking at.
        // Failure is logged, not fatal: the data is already correct on disk
        // and in the DB; a manual close-and-reopen shows the same thing.
        // Skipped with the revert on the fast path — nothing reverted, so
        // there is nothing new to look at.
        try {
          await onAfterDiscard()
        } catch (err) {
          log.warn(
            'recovery',
            `post-discard reload failed for ${current.projectId} — close and reopen ` +
              `the project to see the reverted state`,
            err,
          )
        }
      }
    } catch (err) {
      // A failed delete must not strand the user in a dialog they explicitly
      // answered (hence the ``finally``). The offer reappears next launch,
      // which is the safe direction to fail in.
      log.warn('recovery', `could not delete the recovery file for ${current.projectId}`, err)
    } finally {
      setDiscarding(false)
      closeOffer(current.projectId)
    }
  }, [offer, claimAnswer, closeOffer, onDiscardResidue, onBeforeDiscard, onAfterDiscard])

  return { offer, restoreOffer, dismissOffer, discardOffer, discarding }
}
