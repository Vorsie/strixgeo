/**
 * Renderer-side DTO shapes for the launch prototypes (updater #6).
 *
 * These MIRROR the main-process types (``src/main/updaterService.ts``) but are
 * declared here on purpose: the renderer cannot import from the main process, so
 * the IPC contract is duplicated at the boundary — the same pattern the preload
 * uses for ``RecentProject`` / ``RecoveryDescriptor``. When a main-process shape
 * changes, this file changes in lockstep.
 */

/** Updater lifecycle phases — mirrors ``UpdaterPhase`` in src/main/updaterService.ts. */
export type UpdaterPhaseDto =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  // The feed has nothing published yet (the closed beta's normal state) — calm,
  // not a failure. See the updater error handler (finding (g)).
  | 'no-release'
  | 'downloading'
  | 'downloaded'
  | 'error'
  | 'disabled'

/** Why an updater check FAILED — mirrors ``UpdaterErrorReason`` in updaterPolicy.ts. */
export type UpdaterErrorReasonDto = 'offline' | 'blocked' | 'unexpected'

/** A renderer-safe update summary — mirrors ``UpdateAvailableNotice``. */
export interface UpdateNoticeDto {
  version: string
  releaseName: string | null
  releaseNotes: string | null
}

/** One updater state change pushed from main — mirrors ``UpdaterEvent``. */
export interface UpdaterEventDto {
  phase: UpdaterPhaseDto
  notice?: UpdateNoticeDto
  progressPercent?: number
  message?: string
  /** Present on ``error`` — which cause the renderer names (offline / blocked / unexpected). */
  errorReason?: UpdaterErrorReasonDto
}
