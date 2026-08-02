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
import { parseRecoverySnapshot } from '../utils/recoverySnapshot'
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
}

/** The offer plus the three answers the design allows. */
export interface UseRecoveryOfferResult {
  /** Non-null while the prompt should be shown. */
  offer: RecoveryOffer | null
  /** "Restore unsaved work" — applies the snapshot, KEEPS the file. */
  restoreOffer: () => void
  /** "Open without restoring" — keeps the file; a restart offers it again. */
  dismissOffer: () => void
  /** "Discard unsaved work" — deletes the file. Irreversible. */
  discardOffer: () => Promise<void>
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
}: UseRecoveryOfferOptions): UseRecoveryOfferResult {
  const [offer, setOffer] = useState<RecoveryOffer | null>(null)

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

  /** Mark this project answered and close the prompt. */
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
  const restoreOffer = useCallback((): void => {
    if (offer === null || answered.current.has(offer.projectId)) return
    answered.current.add(offer.projectId)
    // The file is deliberately KEPT: the restored state is at risk all over
    // again, and the autosave scheduler takes over keeping it fresh.
    void onRestoreRef.current(offer.snapshot)
    setOffer(null)
  }, [offer])

  // ⚠ OWNER DECISION PENDING — how long a DECLINED file should live.
  //
  // This hook deletes nothing here, which is all the design specifies. But
  // the file does not in fact survive the session: the autosave scheduler
  // overwrites it the moment this session has anything at risk, and every
  // decided exit (save, discard, close, clean quit) calls ``clearRecoveryNow``
  // unconditionally — so declining and then closing the project destroys
  // unrestored work with no confirmation.
  //
  // Making "decline now, restore after a restart" actually work means gating
  // the decided-exit clear on "this session owns the file", which is a change
  // to the clearing contract (useRecoveryAutosave + useProjectLifecycle), not
  // to this hook. Flagged rather than decided here; the prompt's copy is
  // worded to promise only what today's behaviour delivers.
  const dismissOffer = useCallback((): void => {
    if (offer === null || answered.current.has(offer.projectId)) return
    answered.current.add(offer.projectId)
    log.info(
      'recovery',
      `opened ${offer.projectId} without restoring; this prompt deleted nothing`,
    )
    setOffer(null)
  }, [offer])

  const discardOffer = useCallback(async (): Promise<void> => {
    const current = offer
    if (current === null || answered.current.has(current.projectId)) return
    closeOffer(current.projectId)
    try {
      await window.electron.deleteRecovery(current.projectId)
      log.info('recovery', `discarded the recovery file for ${current.projectId}`)
    } catch (err) {
      // The prompt is already closed — a failed delete would otherwise strand
      // the user in a dialog they explicitly answered. It reappears next
      // launch, which is the safe direction to fail in.
      log.warn('recovery', `could not delete the recovery file for ${current.projectId}`, err)
    }
  }, [offer, closeOffer])

  return { offer, restoreOffer, dismissOffer, discardOffer }
}
