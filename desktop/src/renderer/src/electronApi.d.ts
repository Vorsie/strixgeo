/**
 * The ``window.electron`` bridge contract, shared by every renderer entry.
 *
 * Moved out of ``App.tsx`` so the second renderer entry (``sheet/main.tsx``)
 * sees the same ``Window`` augmentation without importing the shell. The
 * preload (``src/preload/index.ts``) is the implementation; this file is the
 * type it must satisfy.
 */
import type {
  ActivationActionResultDto,
  ActivationStatusDto,
  UpdaterEventDto,
} from './utils/launchPrototypeTypes'
import type { SheetPayload, SheetReadyMessage } from './sheet/sheetPayload'

interface RecentProject {
  path: string
  name: string
  lastOpened: string
}

// Local FileFilter shape — matches Electron's ``Electron.FileFilter`` but
// declared inline so we don't pull in the full ``electron`` ambient
// namespace just for one shape. The renderer doesn't import the
// Electron module directly (main + preload do).
interface FileFilter {
  name: string
  extensions: string[]
}

/**
 * What a recovery file advertises about itself, without its payload.
 * Mirrors ``main/recoveryStore``'s ``RecoveryDescriptor`` — the renderer
 * cannot import from main, so the shape is restated here alongside the
 * other IPC types.
 */
interface RecoveryDescriptor {
  projectId: string
  projectName: string
  filePath: string
  writtenAt: string
  appVersion: string
  sizeBytes: number
  /**
   * True when the user already answered "Open without restoring" for this
   * copy. It is still a live offer — declining preserves the copy (owner
   * decision 2026-08-03) — so the start screen lists it like any other.
   */
  declined: boolean
}

declare global {
  interface Window {
    electron: {
      getApiBaseUrl: () => Promise<string>
      waitForApi: () => Promise<boolean>
      openFile: (filters: FileFilter[]) => Promise<string | null>
      openFiles: (filters: FileFilter[]) => Promise<string[]>
      readFile: (filePath: string) => Promise<Buffer>
      // Project file lifecycle (Phase 4 multi-project)
      showProjectOpenDialog: () => Promise<string | null>
      showProjectSaveDialog: (defaultName?: string) => Promise<string | null>
      projectFileExists: (filePath: string) => Promise<boolean>
      // Discriminated read result: a damaged / truncated / newer file comes
      // back as ``{ ok: false, reason }`` (mirrors ``ProjectReadResult`` in
      // src/main/strixCodec.ts) so the open flow can show the specific message.
      readProjectFile: (
        filePath: string,
      ) => Promise<
        | { ok: true; json: string }
        | { ok: false; reason: { code: string; message: string } }
      >
      writeProjectFile: (filePath: string, contents: string) => Promise<void>
      // Generic export save-dialog + binary write (v1.0 MVP gate #5).
      showExportSaveDialog: (
        defaultName: string,
        filters: FileFilter[],
      ) => Promise<string | null>
      writeExportFile: (filePath: string, contents: ArrayBuffer) => Promise<void>
      addRecentProject: (filePath: string, name: string) => Promise<RecentProject[]>
      getRecentProjects: () => Promise<RecentProject[]>
      // Crash-recovery files (docs/design/autosave-recovery.md §5). No path
      // in any signature: the renderer supplies a project id and main
      // resolves the location itself, so this surface can neither read nor
      // write an arbitrary file.
      writeRecovery: (
        projectId: string,
        payload: unknown,
        options?: { projectName?: string },
      ) => Promise<RecoveryDescriptor>
      listRecovery: () => Promise<RecoveryDescriptor[]>
      readRecovery: (projectId: string) => Promise<unknown>
      // Discard — the ONE call that destroys a recovery copy (both slots).
      deleteRecovery: (projectId: string) => Promise<boolean>
      // Every other decided exit + the autosave scheduler: clears this
      // session's slot only, so a declined copy keeps being re-offered.
      deletePrimaryRecovery: (projectId: string) => Promise<boolean>
      // "Open without restoring" — moves the copy out of the scheduler's
      // reach instead of leaving it to be overwritten.
      declineRecovery: (projectId: string) => Promise<boolean>
      // Ends a decline, once the restored copy has a home in the primary
      // slot again. Never called before that write lands.
      deleteDeclinedRecovery: (projectId: string) => Promise<boolean>
      // Mirror one close-flow line into the main-process console, which is
      // the only console a packaged build's dogfeed report can show.
      closeFlowNote: (note: string) => Promise<void>
      setWindowTitle: (title: string | null) => Promise<void>
      /**
       * Show or hide the window without closing it.
       *
       * The close flow hides it the moment the engineer answers the save-or-discard
       * prompt, so the work that answer causes (a full replace-restore) runs out of
       * sight instead of holding a window that has already been told to go. The
       * process stays alive to finish it and quits through the existing handshake.
       */
      setWindowVisible: (visible: boolean) => Promise<void>
      onAppBeforeQuit: (cb: () => void) => () => void
      notifyQuitDecision: (allowed: boolean) => Promise<void>
      onMenuImportCpt: (cb: () => void) => () => void
      onMenuImportBorehole: (cb: () => void) => () => void
      onMenuProjectNew: (cb: () => void) => () => void
      onMenuProjectOpen: (cb: () => void) => () => void
      onMenuProjectSave: (cb: () => void) => () => void
      onMenuProjectSaveAs: (cb: () => void) => () => void
      onMenuProjectClose: (cb: () => void) => () => void
      onMenuProjectOpenRecent: (cb: (path: string) => void) => () => void
      onMenuEditUndo: (cb: () => void) => () => void
      onMenuEditRedo: (cb: () => void) => () => void
      onMenuOpenSettings: (cb: () => void) => () => void
      onMenuOpenCheatsheet: (cb: () => void) => () => void
      // #214 — distribution robustness
      onAppBackendFailed: (cb: () => void) => () => void
      getLogsPath: () => Promise<string>
      logRendererError: (message: string, componentStack: string) => Promise<void>
      // #16 — local crash capture. The renderer states WHAT went wrong; the
      // main process decides what of that survives (field whitelist +
      // redaction) and where it is written. Optional on the type so a
      // renderer running against an older preload degrades to no capture
      // rather than to a TypeError on an error path.
      captureDiagnostic?: (diagnostic: {
        kind: string
        scope?: string
        message: string
        stack?: string
        httpStatus?: number
      }) => Promise<void>
      // Beta-expiry status for an in-app notice; ``null`` for a build that
      // carries no expiry stamp. The BLOCKING decision is the main process's
      // alone — this is for display only (docs/design/beta-expiry.md).
      getBetaStatus?: () => Promise<{
        state: string
        blocked: boolean
        daysRemaining: number | null
        expiresAtMs: number | null
      } | null>
      // Cross-section PDF sheet (docs/superpowers/specs/2026-09-02-section-pdf-sheet-design.md).
      // ``printSheetPdf`` hands the payload to the main process, which renders
      // sheet.html in a hidden window and prints it; ``onSheetPayload`` /
      // ``sheetReady`` are the hidden window's (and print/preview page's) side.
      // Launch prototypes (debt #93 / #3 / #6) — see
      // docs/design/onboarding-activation-updater-proto.md.
      // Synchronous boot flags (preload sendSync): e2e = STRIX_E2E harness run,
      // packaged = app.isPackaged.
      launchFlags: { e2e: boolean; packaged: boolean }
      onMenuOpenOnboarding: (cb: () => void) => () => void
      onMenuOpenLicensing: (cb: () => void) => () => void
      onMenuCheckUpdates: (cb: () => void) => () => void
      getActivationStatus: () => Promise<ActivationStatusDto>
      activateLicence: (key: string) => Promise<ActivationActionResultDto>
      startTrial: () => Promise<ActivationActionResultDto>
      deactivateLicence: () => Promise<ActivationActionResultDto>
      previewActivationState: (state: string) => Promise<ActivationStatusDto>
      checkForUpdates: () => Promise<void>
      downloadUpdate: () => Promise<void>
      quitAndInstallUpdate: () => Promise<void>
      onUpdaterEvent: (cb: (event: UpdaterEventDto) => void) => () => void
      printSheetPdf: (payload: SheetPayload) => Promise<ArrayBuffer>
      onSheetPayload: (cb: (payload: SheetPayload) => void) => () => void
      sheetReady: (msg: SheetReadyMessage) => void
    }
  }
}
