// Crash-recovery autosave — WHEN the session delta is written to disk.
//
// The companion of ``utils/recoverySnapshot`` (which owns WHAT is written).
// The rules come from docs/design/autosave-recovery.md §4:
//
//   * Debounce AND cap. A pure timer was rejected because it rewrites an
//     unchanged file forever and blunts the existence signal a recovery
//     offer depends on; a pure debounce was rejected because sustained ghost
//     triage starves it. The cap bounds worst-case loss at 15 s.
//   * The clean paths DELETE the file. Crash detection has no sentinel and
//     no heartbeat — a file present at launch means the previous session
//     never reached a clean exit, which only holds if every clean exit
//     removes it.
//   * Ordering trap: the clear path cancels the pending timers FIRST. A late
//     timer firing after a clean save resurrects the file and produces a
//     false recovery offer on the next launch.
//   * Every clear here is a PRIMARY-SLOT clear
//     (``deletePrimaryRecovery``), never the both-slots ``deleteRecovery``.
//     "Open without restoring" preserves the declined copy until the user
//     discards it (owner decision 2026-08-03), and this scheduler must not be
//     able to reach that slot: it would otherwise delete a declined copy the
//     moment this session saved, which is exactly the silent loss the second
//     slot was added to end. The both-slots delete belongs to the prompt's
//     Discard button alone.
//   * The whole scheduler is SUSPENDED while a recovery prompt is up and
//     unanswered (``suspended``). For that window the files on disk belong to
//     the crashed session, not this one — see the option's docstring for the
//     two races that opens.
//   * The clear is gated on the FILE WRITE, not on a save's return value —
//     hence ``canClearOnClean``. A save that never reached the ``.strix``
//     still resets the session sets and the mutations flag, so the watched
//     values go clean while the delta is still homeless.
//
// Everything here is fire-and-forget from React's perspective: a write must
// never block a gesture, and a failed write is logged and dropped — the next
// change reschedules, so a retry loop would only pile writes onto a disk
// that is already refusing them.

import { useCallback, useEffect, useRef } from 'react'

import { log } from '../utils/log'
import { buildRecoverySnapshot } from '../utils/recoverySnapshot'
import type { RecoverySnapshotInputs } from '../utils/recoverySnapshot'
import { projectMetadataEqual } from '../utils/projectMetadataFields'
import type { StratigraphyLumping } from '../utils/projectFile'
import { lumpingsEqual } from '../utils/stratigraphyLumping'

/** Quiet period after the last change before the delta is written. */
export const RECOVERY_DEBOUNCE_MS = 2_000

/** Hard ceiling on staleness while the user never pauses. */
export const RECOVERY_MAX_LATENCY_MS = 15_000

/**
 * Everything the scheduler watches.
 *
 * It is the snapshot codec's input set plus ``savedLumping`` — the only
 * extra value needed to tell whether the lumping map is dirty. The project
 * id and name are read off ``project`` rather than passed separately, so
 * they cannot disagree with the project the snapshot describes.
 */
export interface UseRecoveryAutosaveOptions extends RecoverySnapshotInputs {
  /** Last-saved lumping map — the other half of the lumping dirty check. */
  savedLumping: StratigraphyLumping | null
  /**
   * May a dirty→clean transition delete the recovery file?
   *
   * §4 gates the post-save clear on THE FILE WRITE, not on the save's return
   * value — but the save path resets the session-import sets and the
   * mutations flag whether or not the ``.strix`` write landed, so a save
   * whose file write failed still drives the watched values clean and would
   * otherwise make this scheduler delete the very file the lifecycle
   * deliberately kept. The caller supplies the same file-write signal the
   * lifecycle gates on; a session that has not saved yet must answer
   * ``true``, since it has no failed write to distrust.
   *
   * Defaults to "always allowed", which is the correct behaviour for any
   * caller with no save model behind it (tests, future embedders).
   */
  canClearOnClean?: () => boolean
  /**
   * Hold every write AND every clear — set while a recovery prompt is up and
   * unanswered.
   *
   * For that window only, the recovery files on disk are NOT this session's:
   * they hold the crashed session's work, and the user's answer is about to
   * move them between slots. Two races follow from letting the scheduler run
   * into it:
   *
   *   * a debounced write lands between the answer handler's two IPC calls and
   *     replaces the crashed copy with this session's much thinner delta —
   *     which the decline then dutifully preserves, keeping the promise in
   *     name only;
   *   * a decided exit (quit, close, save) taken while the prompt is still
   *     up runs the ordinary clear and DELETES a crash copy the user never
   *     answered for. Quitting mid-question must lose nothing; the offer comes
   *     back next launch.
   *
   * Nothing is scheduled at all while this is true — a gate inside the timer
   * callback would still leave the timers armed across the answer sequence,
   * and the effect re-evaluates on the flip back to false, which re-arms.
   */
  suspended?: boolean
}

/** What the lifecycle needs from the scheduler. */
export interface UseRecoveryAutosaveResult {
  /**
   * Cancel every pending write and delete this session's recovery file.
   *
   * Called on each DECIDED exit — save, discard, clean close — because the
   * file's existence is the crash signal. Clears the primary slot only: a
   * copy the user declined in an earlier session is not this session's to
   * throw away.
   */
  clearRecoveryNow: () => Promise<void>
}

/**
 * Is any of the six at-risk items carrying state a crash would destroy?
 *
 * Mirrors the app's own dirty sources rather than reusing ``projectDirty``:
 * the ghost workspace is at risk without being "dirty" in the save sense
 * (it never reaches the API until Accept), and the lumping comparison must
 * use the same semantics the dirty flag does — hence the shared
 * ``lumpingsEqual`` / ``projectMetadataEqual`` rather than a local copy.
 *
 * @param opts - The watched values for this render.
 * @returns ``true`` when a crash right now would lose something.
 */
function hasStateAtRisk(opts: UseRecoveryAutosaveOptions): boolean {
  const metadataDirty =
    opts.project !== null && (opts.saved === null || !projectMetadataEqual(opts.project, opts.saved))
  return (
    metadataDirty ||
    !lumpingsEqual(opts.currentLumping, opts.savedLumping) ||
    opts.hasUnsavedMutations ||
    opts.ghostsByAnchor.size > 0 ||
    opts.sessionImportCptIds.size > 0 ||
    opts.sessionImportBoreholeIds.size > 0 ||
    opts.sessionImportFormationIds.size > 0 ||
    opts.sessionImportSectionIds.size > 0 ||
    opts.sessionImportContactIds.size > 0
  )
}

/**
 * Schedule crash-recovery writes for the open project.
 *
 * Mount this once, at the top of the app shell. It watches the six at-risk
 * items and writes them to the main-process recovery store on the design's
 * debounce + cap schedule, deleting the file the moment the session becomes
 * clean again.
 *
 * @param opts - The live values for the six at-risk items, plus the
 *   last-saved lumping snapshot.
 * @returns ``clearRecoveryNow`` for the lifecycle's decided-exit paths.
 */
export function useRecoveryAutosave(
  opts: UseRecoveryAutosaveOptions,
): UseRecoveryAutosaveResult {
  const projectId = opts.project?.id ?? null
  const atRisk = projectId !== null && hasStateAtRisk(opts)
  const suspended = opts.suspended === true

  // The timer callbacks must see the CURRENT values, not the ones captured
  // when the timer was armed — otherwise a debounced write would persist the
  // state from two seconds ago. A ref refreshed after every render gives the
  // callbacks a stable read without re-arming the timers on every keystroke.
  const optsRef = useRef(opts)
  useEffect(() => {
    optsRef.current = opts
  })

  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const capTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Only a true→false transition IN THIS SESSION means "the user reached a
  // clean state, so the file may go". Mounting clean must delete nothing: a
  // file kept via "Open without restoring" has to survive a session that
  // never touches anything.
  const wasAtRisk = useRef(false)

  const cancelTimers = useCallback((): void => {
    if (debounceTimer.current !== null) {
      clearTimeout(debounceTimer.current)
      debounceTimer.current = null
    }
    if (capTimer.current !== null) {
      clearTimeout(capTimer.current)
      capTimer.current = null
    }
  }, [])

  const writeNow = useCallback((): void => {
    cancelTimers()
    const current = optsRef.current
    const id = current.project?.id ?? null
    if (id === null) return
    const name = current.project?.name
    void (async () => {
      try {
        await window.electron.writeRecovery(id, buildRecoverySnapshot(current), {
          projectName: name,
        })
        log.debug('recovery', `wrote recovery snapshot for ${id}`)
      } catch (err) {
        // No retry loop: the next change reschedules, and hammering a disk
        // that just refused a write helps nobody.
        log.warn('recovery', `recovery write failed for ${id}`, err)
      }
    })()
  }, [cancelTimers])

  // Cancel on project switch / close and on unmount. Declared BEFORE the
  // scheduling effect so its cleanup runs first when the id changes — a
  // pending write for the project that just closed must not fire, and the
  // at-risk state it would have captured is gone from memory anyway.
  useEffect(() => {
    return () => {
      cancelTimers()
      wasAtRisk.current = false
    }
  }, [projectId, cancelTimers])

  useEffect(() => {
    if (projectId === null) return
    if (suspended) {
      // Nothing scheduled and nothing cleared while the prompt is unanswered.
      // Cancelling here matters as much as not arming: a timer armed just
      // before the prompt appeared would otherwise fire straight into the
      // answer sequence. ``wasAtRisk`` is deliberately left alone, so a clean
      // transition that happened under the prompt still clears once the user
      // has answered.
      cancelTimers()
      return
    }
    if (!atRisk) {
      if (wasAtRisk.current) {
        // Ordering trap (§4): kill the timers BEFORE deleting, or a late
        // one resurrects the file after a clean save. This happens either
        // way — a cancelled timer is right whether or not the file goes.
        cancelTimers()
        wasAtRisk.current = false
        // Read off this render's props rather than the ref: the effect body
        // runs on exactly the render where the session went clean, which is
        // the moment the answer applies.
        if (opts.canClearOnClean !== undefined && !opts.canClearOnClean()) {
          log.warn(
            'recovery',
            'recovery: skipping clean-transition clear — last save did not reach the file',
          )
          return
        }
        void window.electron
          .deletePrimaryRecovery(projectId)
          .then(() => log.debug('recovery', `cleared recovery file for ${projectId}`))
          .catch(err => log.warn('recovery', `recovery delete failed for ${projectId}`, err))
      }
      return
    }
    wasAtRisk.current = true
    if (debounceTimer.current !== null) clearTimeout(debounceTimer.current)
    debounceTimer.current = setTimeout(writeNow, RECOVERY_DEBOUNCE_MS)
    // The cap is armed once per editing burst and deliberately NOT reset by
    // subsequent changes — resetting it would turn it back into a debounce.
    if (capTimer.current === null) {
      capTimer.current = setTimeout(writeNow, RECOVERY_MAX_LATENCY_MS)
    }
    // reason: the watched values are read through ``optsRef`` inside the
    // timer callbacks, so listing them here would re-arm the debounce on
    // every unrelated render. ``atRisk`` is recomputed from all of them each
    // render and is the signal that actually needs to (re)schedule; the
    // identity of the collections is folded in via the explicit deps below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    projectId,
    atRisk,
    suspended,
    cancelTimers,
    writeNow,
    // The watched values, by identity — each of these changes reference when
    // the user edits the thing it stands for, which is exactly when the
    // debounce should restart.
    opts.project,
    opts.saved,
    opts.currentLumping,
    opts.savedLumping,
    opts.lumpingRevision,
    opts.ghostsByAnchor,
    opts.filePath,
    opts.hasUnsavedMutations,
    opts.manifestCptIds,
    opts.manifestBoreholeIds,
    opts.manifestFormationIds,
    opts.manifestSectionIds,
    opts.sessionImportCptIds,
    opts.sessionImportBoreholeIds,
    opts.sessionImportFormationIds,
    opts.sessionImportSectionIds,
    opts.sessionImportContactIds,
  ])

  const clearRecoveryNow = useCallback(async (): Promise<void> => {
    // Timers die whatever else happens: a late write after a decided exit
    // resurrects the file and fakes a crash at the next launch.
    cancelTimers()
    if (suspended) {
      // A decided exit taken while a recovery prompt is still unanswered. The
      // file on disk is the crashed session's, not this one's, so deleting it
      // would destroy work the user was in the middle of being asked about —
      // and never be offered again. INFO, not DEBUG: this is the line that
      // explains "I quit and it kept asking me", which is the intended
      // behaviour rather than a bug.
      log.info(
        'recovery',
        `exit while the recovery prompt for ${projectId} is unanswered — keeping the copy`,
      )
      return
    }
    wasAtRisk.current = false
    if (projectId === null) return
    try {
      await window.electron.deletePrimaryRecovery(projectId)
      log.debug('recovery', `cleared recovery file for ${projectId}`)
    } catch (err) {
      log.warn('recovery', `recovery delete failed for ${projectId}`, err)
    }
  }, [projectId, suspended, cancelTimers])

  return { clearRecoveryNow }
}
