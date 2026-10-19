/**
 * Native OS surfaces under the e2e harness: dialogs answer themselves and
 * external links open nothing.
 *
 * Playwright drives the renderer through CDP and cannot see, let alone
 * dismiss, an OS-level Save / Open / message dialog. The naive-engineer
 * walker clicks every verb it finds — Export Plaxis, Save project, Install
 * sample — so on a real run those dialogs either block the app until the
 * test timeout (walker run 14, 2026-09-10: twenty minutes of silence) or
 * land on the owner's screen ("i don't want to have to click away save
 * windows"). Under ``STRIX_E2E`` (unpackaged only, see ``launchFlags``)
 * the four dialog methods the app uses are replaced:
 *
 * * Save / Open dialogs resolve ``canceled`` at once — exactly what an
 *   engineer pressing Escape produces, so every caller's cancel path runs.
 * * Message boxes answer with their ``cancelId`` button, else ``defaultId``,
 *   else the first — never a destructive choice that was not the default.
 * * Every suppressed dialog is logged with its kind and title, so a run can
 *   still tell that the app asked for one.
 *
 * Pure module: the dialog object and the logger are injected, so the rule is
 * unit-tested without Electron.
 *
 * @module main/e2eDialogs
 */

/**
 * The slice of Electron's ``dialog`` the app calls. Structural, so a fake fits;
 * method signatures (not arrow properties) so Electron's typed parameters are
 * accepted under ``strictFunctionTypes``. ``filePath`` is an empty string on
 * cancel, as Electron 42 documents it.
 */
export interface StubbableDialog {
  showSaveDialog(...args: unknown[]): Promise<{ canceled: boolean; filePath: string }>
  showOpenDialog(...args: unknown[]): Promise<{ canceled: boolean; filePaths: string[] }>
  showMessageBox(...args: unknown[]): Promise<{ response: number; checkboxChecked: boolean }>
  showMessageBoxSync(...args: unknown[]): number
}

export interface E2eDialogStubOptions {
  /** ``e2eLaunchFlag(process.env, app.isPackaged)`` — install only when true. */
  e2e: boolean
  /** Main-process log sink (``writeMainLog``). */
  log: (line: string) => void
}

interface MessageBoxLike {
  buttons?: readonly string[]
  defaultId?: number
  cancelId?: number
  title?: string
}

/** The options object of a dialog call: the last argument, or the only one. */
function optionsOf(args: readonly unknown[]): Record<string, unknown> {
  const last = args[args.length - 1]
  return last !== null && typeof last === 'object' ? (last as Record<string, unknown>) : {}
}

function titleOf(args: readonly unknown[]): string {
  const opts = optionsOf(args)
  const title = opts.title ?? opts.defaultPath ?? opts.message
  return typeof title === 'string' ? title : '(untitled)'
}

/** The button a message box answers with: cancel, else default, else the first. */
export function messageBoxAnswer(opts: MessageBoxLike): number {
  if (typeof opts.cancelId === 'number') return opts.cancelId
  if (typeof opts.defaultId === 'number') return opts.defaultId
  return 0
}

/**
 * Replace the native dialogs with self-answering stubs when ``e2e`` is set.
 *
 * @param dialog Electron's ``dialog`` (or a fake in tests); mutated in place.
 * @param options The e2e flag and the log sink.
 */
export function installE2eDialogStubs(dialog: StubbableDialog, options: E2eDialogStubOptions): void {
  if (!options.e2e) return
  const { log } = options
  dialog.showSaveDialog = async (...args: unknown[]) => {
    log(`[e2e] native save dialog suppressed (cancelled): ${titleOf(args)}`)
    return { canceled: true, filePath: '' }
  }
  dialog.showOpenDialog = async (...args: unknown[]) => {
    log(`[e2e] native open dialog suppressed (cancelled): ${titleOf(args)}`)
    return { canceled: true, filePaths: [] }
  }
  dialog.showMessageBox = async (...args: unknown[]) => {
    const opts = optionsOf(args) as MessageBoxLike
    const response = messageBoxAnswer(opts)
    log(`[e2e] native message box suppressed (button ${response}): ${titleOf(args)}`)
    return { response, checkboxChecked: false }
  }
  dialog.showMessageBoxSync = (...args: unknown[]) => {
    const opts = optionsOf(args) as MessageBoxLike
    const response = messageBoxAnswer(opts)
    log(`[e2e] native message box suppressed (button ${response}): ${titleOf(args)}`)
    return response
  }
  log('[e2e] native dialogs stubbed: save/open answer cancelled, message boxes answer cancel/default')
}

/** The slice of Electron's ``shell`` the external-link handlers call. */
export interface StubbableShell {
  openExternal(url: string, ...rest: unknown[]): Promise<void>
}

/**
 * Swallow external links under the harness: log the URL, open nothing.
 *
 * The walker clicks the map's attribution links (Leaflet, OpenStreetMap,
 * Digitaal Vlaanderen) like any control, and the external-link handler hands
 * them to the OS browser — Chrome windows piling up on the owner's screen
 * during a gate run (2026-09-10: "also stop opening leaflet windows in
 * chrome"). The handler's decision (allow / deny / external) is unchanged; only
 * the final ``shell.openExternal`` call is replaced.
 *
 * @param shell Electron's ``shell`` (or a fake in tests); mutated in place.
 * @param options The e2e flag and the log sink.
 */
export function installE2eShellStubs(shell: StubbableShell, options: E2eDialogStubOptions): void {
  if (!options.e2e) return
  const { log } = options
  shell.openExternal = async (url: string) => {
    log(`[e2e] external link suppressed (not opened): ${url}`)
  }
}
