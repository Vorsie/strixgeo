import { contextBridge, ipcRenderer } from 'electron'

// Snapshot of a recent-project entry returned from the main process. Kept
// inline (not imported from a shared module) so the preload stays
// self-contained — preload bundles run before the renderer module graph
// is loaded.
interface RecentProject {
  path: string
  name: string
  lastOpened: string
}

// Descriptor of one crash-recovery file, as returned by ``recovery:list``.
// Mirrors ``RecoveryDescriptor`` in src/main/recoveryStore.ts — duplicated
// rather than imported for the same reason as RecentProject above (the
// preload bundle must stay self-contained). Deliberately carries no payload:
// the start screen only renders a banner from this.
interface RecoveryDescriptor {
  projectId: string
  projectName: string
  filePath: string
  writtenAt: string
  appVersion: string
  sizeBytes: number
  // True when this copy was already declined once ("Open without restoring")
  // — the start screen words a re-offer differently from fresh crash debris.
  declined: boolean
}

// Helper: subscribe to a main→renderer event and return an unsubscribe fn.
// The pattern is identical for every menu signal, so factoring it removes
// ~5 boilerplate lines per handler.
function onMenuEvent(channel: string, cb: (...args: unknown[]) => void): () => void {
  const handler = (_event: unknown, ...args: unknown[]) => cb(...args)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

// Boot flags, fetched ONCE and SYNCHRONOUSLY so the renderer can gate boot-time
// UI (the onboarding auto-open, the packaged activation start screen) with no
// async round-trip. The main-process handler (index.ts, ``launch:flags``) is
// registered at module load, before this preload runs. Degrades to "not e2e, not
// packaged" if the channel is ever missing, so an older main can never crash the
// renderer's boot path.
const launchFlags: { e2e: boolean; packaged: boolean } = (() => {
  try {
    const flags = ipcRenderer.sendSync('launch:flags') as { e2e?: unknown; packaged?: unknown }
    return { e2e: flags?.e2e === true, packaged: flags?.packaged === true }
  } catch {
    return { e2e: false, packaged: false }
  }
})()

contextBridge.exposeInMainWorld('electron', {
  // Synchronous boot flags — see the comment above. A plain object, not a
  // function, so the renderer reads ``window.electron.launchFlags.e2e`` directly.
  launchFlags,

  getApiBaseUrl: (): Promise<string> =>
    ipcRenderer.invoke('api:base-url'),

  waitForApi: (): Promise<boolean> =>
    ipcRenderer.invoke('api:ready'),

  openFile: (filters: Electron.FileFilter[]): Promise<string | null> =>
    ipcRenderer.invoke('dialog:open-file', filters),

  openFiles: (filters: Electron.FileFilter[]): Promise<string[]> =>
    ipcRenderer.invoke('dialog:open-files', filters),

  readFile: (filePath: string): Promise<Buffer> =>
    ipcRenderer.invoke('fs:read-file', filePath),

  // Project file lifecycle — see desktop/src/main/index.ts for the
  // server-side handlers and CLAUDE.md "Project files" for the format spec.
  showProjectOpenDialog: (): Promise<string | null> =>
    ipcRenderer.invoke('project:open-dialog'),

  showProjectSaveDialog: (defaultName?: string): Promise<string | null> =>
    ipcRenderer.invoke('project:save-dialog', defaultName),

  // Existence probe for the recents flow — lets a moved file get its own
  // message instead of the generic open-failed banner.
  projectFileExists: (filePath: string): Promise<boolean> =>
    ipcRenderer.invoke('project:file-exists', filePath),

  // Returns a discriminated result, not a bare string: a damaged / truncated /
  // newer file comes back as ``{ ok: false, reason }`` so the renderer can show
  // the specific message instead of a wrapped IPC Error. Shape duplicated inline
  // (like RecentProject above) so the preload bundle stays self-contained — it
  // must not import from main or renderer. Mirrors ``ProjectReadResult`` in
  // src/main/strixCodec.ts.
  readProjectFile: (
    filePath: string,
  ): Promise<
    | { ok: true; json: string }
    | { ok: false; reason: { code: string; message: string } }
  > => ipcRenderer.invoke('project:read-file', filePath),

  writeProjectFile: (filePath: string, contents: string): Promise<void> =>
    ipcRenderer.invoke('project:write-file', filePath, contents),

  // Generic export save-dialog + binary write — used by the
  // section DXF export (v1.0 MVP gate #5). Same path-authorisation
  // pattern as the project file IPC.
  showExportSaveDialog: (
    defaultName: string,
    filters: Electron.FileFilter[],
  ): Promise<string | null> =>
    ipcRenderer.invoke('export:save-dialog', defaultName, filters),

  writeExportFile: (filePath: string, contents: ArrayBuffer): Promise<void> =>
    ipcRenderer.invoke('export:write-file', filePath, contents),

  addRecentProject: (filePath: string, name: string): Promise<RecentProject[]> =>
    ipcRenderer.invoke('project:add-recent', filePath, name),

  getRecentProjects: (): Promise<RecentProject[]> =>
    ipcRenderer.invoke('project:get-recent'),

  // Crash-recovery files — app-managed session state under userData.
  // Note there is no path in any of these signatures: the main process owns
  // the location and validates the project id, so the renderer can neither
  // read nor write an arbitrary file through this surface.
  writeRecovery: (
    projectId: string,
    payload: unknown,
    options?: { projectName?: string },
  ): Promise<RecoveryDescriptor> =>
    ipcRenderer.invoke('recovery:write', projectId, payload, options),

  listRecovery: (): Promise<RecoveryDescriptor[]> =>
    ipcRenderer.invoke('recovery:list'),

  readRecovery: (projectId: string): Promise<unknown> =>
    ipcRenderer.invoke('recovery:read', projectId),

  // Discard — the ONE call that destroys a recovery copy (both slots).
  deleteRecovery: (projectId: string): Promise<boolean> =>
    ipcRenderer.invoke('recovery:delete', projectId),

  // The clear for every OTHER decided exit (save, discard-and-close, close,
  // quit) and for the autosave scheduler's dirty→clean transition. Clears
  // this session's own slot only, so a copy declined in an earlier session
  // keeps being re-offered until the user discards it. Resolves true only
  // when a primary file actually went.
  deletePrimaryRecovery: (projectId: string): Promise<boolean> =>
    ipcRenderer.invoke('recovery:delete-primary', projectId),

  // "Open without restoring" — keep the copy, out of the autosave
  // scheduler's reach, so a restart re-offers the same unsaved work
  // (owner decision 2026-08-03). Resolves false when this session never
  // had anything at risk, i.e. there was no file to preserve.
  declineRecovery: (projectId: string): Promise<boolean> =>
    ipcRenderer.invoke('recovery:decline', projectId),

  // Restoring a copy that came out of the declined slot ends the decline.
  // Called only AFTER the restored content has been written to the primary
  // slot, so no window exists in which the work has no durable copy at all.
  deleteDeclinedRecovery: (projectId: string): Promise<boolean> =>
    ipcRenderer.invoke('recovery:delete-declined', projectId),

  // Mirror one close-flow line into the MAIN process console. A packaged
  // build has DevTools disabled and forwards the renderer console nowhere,
  // and dogfeed reports arrive as pasted terminal output — which shows main
  // only. Close-flow lines exclusively; this is not a general log bridge.
  closeFlowNote: (note: string): Promise<void> =>
    ipcRenderer.invoke('app:close-flow-note', note),

  // Set the OS window title. Used by the App to mirror the project
  // state (name + dirty asterisk) into the title bar.
  setWindowTitle: (title: string | null): Promise<void> =>
    ipcRenderer.invoke('window:set-title', title),

  // App-quit handshake. Main fires ``app:before-quit`` when the user
  // closes the OS window (X / Alt+F4); renderer responds with
  // ``app:quit-decision`` after consulting its dirty state and the
  // user's choice on the unsaved-changes prompt.
  onAppBeforeQuit: (cb: () => void) => onMenuEvent('app:before-quit', cb),
  /**
   * Show or hide the main window without closing it.
   *
   * Used by the close flow to take the window away as soon as the engineer answers
   * the save-or-discard prompt, so the work that answer causes runs out of sight.
   * The process stays alive to finish it.
   */
  setWindowVisible: (visible: boolean): Promise<void> =>
    ipcRenderer.invoke('app:set-window-visible', visible),

  notifyQuitDecision: (allowed: boolean): Promise<void> =>
    ipcRenderer.invoke('app:quit-decision', allowed),

  // Menu signals — same shape as the existing onMenuImport* helpers but
  // routed through the shared ``onMenuEvent`` factory above.
  onMenuImportCpt: (cb: () => void) => onMenuEvent('menu:import-cpt', cb),
  onMenuImportBorehole: (cb: () => void) => onMenuEvent('menu:import-borehole', cb),

  onMenuProjectNew: (cb: () => void) => onMenuEvent('menu:project-new', cb),
  onMenuProjectOpen: (cb: () => void) => onMenuEvent('menu:project-open', cb),
  onMenuProjectSave: (cb: () => void) => onMenuEvent('menu:project-save', cb),
  onMenuProjectSaveAs: (cb: () => void) => onMenuEvent('menu:project-save-as', cb),
  onMenuProjectClose: (cb: () => void) => onMenuEvent('menu:project-close', cb),
  onMenuProjectOpenRecent: (cb: (path: string) => void) =>
    onMenuEvent('menu:project-open-recent', cb as (...a: unknown[]) => void),

  // Edit-menu signals. The renderer-side document keydown handler
  // is the authoritative source for the actual Ctrl+Z / Ctrl+Shift+Z
  // keystrokes (it gates on ``isTypingTarget`` so text inputs keep
  // their native undo). The menu items declare the accelerator for
  // the visible label only (``registerAccelerator: false`` on main's
  // side) and route through these IPC handlers when the user clicks
  // the menu item itself.
  onMenuEditUndo: (cb: () => void) => onMenuEvent('menu:edit-undo', cb),
  onMenuEditRedo: (cb: () => void) => onMenuEvent('menu:edit-redo', cb),

  // App-level Settings dialog (File → Settings…). Same one-way fire as
  // every other menu signal — the renderer owns the dialog state.
  onMenuOpenSettings: (cb: () => void) => onMenuEvent('menu:open-settings', cb),

  // Help → Gesture cheatsheet… (F1). Same one-way fire — the renderer
  // owns the CheatsheetDialog open state.
  onMenuOpenCheatsheet: (cb: () => void) => onMenuEvent('menu:open-cheatsheet', cb),

  // Backend-failed signal — fires when the Python backend process exits
  // before the API becomes ready (startup crash). The renderer subscribes
  // once and shows BackendFailedModal when it arrives.
  onAppBackendFailed: (cb: () => void): (() => void) =>
    onMenuEvent('app:backend-failed', cb),

  // Logs directory path — used by ErrorBoundary and BackendFailedModal
  // to show the user where to find backend.log.
  getLogsPath: (): Promise<string> =>
    ipcRenderer.invoke('app:logs-path'),

  // Forward a renderer render error to the main-process log so it appears
  // in backend.log alongside backend stack traces. Best-effort — the main
  // process logs the line and continues.
  logRendererError: (message: string, componentStack: string): Promise<void> =>
    ipcRenderer.invoke('app:log-renderer-error', message, componentStack),

  // #16 — local crash capture. The renderer reports WHAT went wrong; the main
  // process owns the field whitelist, the redaction pass and the file. Used by
  // the API client for backend 5xx, which is the one failure the renderer is
  // the only witness to (the other renderer error paths already travel through
  // logRendererError above).
  captureDiagnostic: (diagnostic: {
    kind: string
    scope?: string
    message: string
    stack?: string
    httpStatus?: number
  }): Promise<void> => ipcRenderer.invoke('diagnostics:capture', diagnostic),

  // Beta-expiry status, for an in-app "expires in N days" notice. Display
  // only — the main process blocks a run on its own, before the window is
  // ever created, so a renderer that ignores this cannot extend a beta.
  getBetaStatus: (): Promise<unknown> => ipcRenderer.invoke('app:beta-status'),

  // --- Onboarding prototype (#93) -----------------------------------------
  // Help → Getting started…. One-way fire; the renderer owns the overlay's
  // open state and its persisted "seen" flag.
  onMenuOpenOnboarding: (cb: () => void) => onMenuEvent('menu:open-onboarding', cb),

  // --- Licensing / activation prototype (#3) ------------------------------
  // Help → Licence & activation…. One-way fire; the renderer owns the dialog.
  onMenuOpenLicensing: (cb: () => void) => onMenuEvent('menu:open-licensing', cb),
  // All activation calls go through the main-process ActivationService, which
  // runs the mock issuer behind the ActivationRepository seam (no network).
  getActivationStatus: (): Promise<unknown> => ipcRenderer.invoke('activation:status'),
  activateLicence: (key: string): Promise<unknown> => ipcRenderer.invoke('activation:activate', key),
  startTrial: (): Promise<unknown> => ipcRenderer.invoke('activation:start-trial'),
  deactivateLicence: (): Promise<unknown> => ipcRenderer.invoke('activation:deactivate'),
  // Prototype-only — force a state so each licensing screen can be seen.
  previewActivationState: (state: string): Promise<unknown> =>
    ipcRenderer.invoke('activation:preview-state', state),

  // --- Updater prototype (#6) ---------------------------------------------
  // Help → Check for updates…. One-way fire; results arrive on the event
  // channel below, not as this call's return value.
  onMenuCheckUpdates: (cb: () => void) => onMenuEvent('menu:check-updates', cb),
  checkForUpdates: (): Promise<void> => ipcRenderer.invoke('updater:check'),
  downloadUpdate: (): Promise<void> => ipcRenderer.invoke('updater:download'),
  quitAndInstallUpdate: (): Promise<void> => ipcRenderer.invoke('updater:quit-and-install'),
  // Every updater state change (checking / available / downloading / …). The
  // callback receives one plain object; see UPDATER_EVENT_CHANNEL in main.
  onUpdaterEvent: (cb: (event: unknown) => void) =>
    onMenuEvent('updater:event', cb as (...a: unknown[]) => void),
})
