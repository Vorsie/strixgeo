import { app, BrowserWindow, crashReporter, ipcMain, dialog, Menu, session, shell } from 'electron'
import { join } from 'path'
import { spawn, ChildProcess } from 'child_process'
import {
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
  existsSync,
  mkdirSync,
} from 'fs'

import {
  buildContentSecurityPolicy,
  decideExternalOpen,
  isInAppNavigation,
  isValidRecentProjectEntry,
  normalizePathForCompare,
} from './security'

// Authorised filesystem paths (debt #37). Populated by:
//   * Every dialog.showOpen/showSave return value (the user just
//     picked the file in a Windows / macOS file picker — that's
//     their consent for us to read or write it).
//   * The recent-projects list at startup (paths the user
//     authorised in a prior session).
// fs:read-file / project:read-file / project:write-file all
// require the requested path to be in this set, defending against
// an XSS-escalated renderer from issuing arbitrary
// readFile('C:\\...\\AppData\\...\\key.db') calls.
const authorisedPaths = new Set<string>()

function authorisePath(p: string | null | undefined): void {
  const norm = normalizePathForCompare(p)
  if (norm !== null) authorisedPaths.add(norm)
}

function pathIsAuthorised(p: string): boolean {
  const norm = normalizePathForCompare(p)
  return norm !== null && authorisedPaths.has(norm)
}

// File extension for project files. Kept here (not imported from the
// renderer) so the main process is build-self-contained — Electron's
// ``out/main`` doesn't include the renderer source tree.
//
// ``.strix`` is the canonical extension; ``.gmproj`` is the legacy
// pre-rebrand extension that the open-dialog filter also accepts so
// users with old files can keep working. New saves always emit
// ``.strix``.
const PROJECT_FILE_EXTENSION = 'strix'
const PROJECT_FILE_OPEN_EXTENSIONS = ['strix', 'gmproj']

// File-size caps for the dialog-authorised read paths (debt #12).
// The API has its own 200 MiB upload cap, but Electron's main process
// reads the full bytes into a Buffer BEFORE handing them to the
// renderer / API, so a multi-gigabyte file would OOM the main thread
// regardless of any server-side limit. The caps below match the API's
// upload limits where applicable and apply a smaller cap to project
// files (typical .strix is a few MB; tens of MB for 500-CPT DOV
// imports — 500 MiB is generous headroom for "we got carried away").
const FS_READ_CAP_BYTES = 200 * 1024 * 1024 // mirrors API's _MAX_GEF_UPLOAD_BYTES
const PROJECT_READ_CAP_BYTES = 500 * 1024 * 1024 // bundle JSON ceiling

function assertFileSizeUnder(filePath: string, capBytes: number, label: string): void {
  // Use ``statSync`` instead of letting ``readFileSync`` swallow the
  // whole file — stat returns the on-disk size in O(1) so we can bail
  // BEFORE allocating a Buffer.
  const size = statSync(filePath).size
  if (size > capBytes) {
    throw new Error(
      `${label} refused — file ${filePath} (${size} bytes) exceeds ` +
        `the ${capBytes} byte cap. Files this large almost certainly ` +
        'indicate a malformed input or a corrupt save.',
    )
  }
}

// Recent-projects list — capped so the menu doesn't explode and we don't
// accidentally accumulate decade-old paths. List is ordered most-recent
// first; reopening a path moves it back to the head.
const RECENT_PROJECTS_MAX = 10
const RECENT_PROJECTS_FILENAME = 'recent-projects.json'

// Wraps a single recent-list entry. ``name`` is a snapshot for the menu —
// the actual project name might have drifted in the DB since the file was
// last opened, but the menu shows what we recorded at last-save time.
interface RecentProject {
  path: string
  name: string
  lastOpened: string  // ISO timestamp
}

const API_PORT = 8765
const API_BASE = `http://127.0.0.1:${API_PORT}`

let apiProcess: ChildProcess | null = null

// Single-window app today; we cache the main window so menu rebuilds (after
// the recent-projects list changes) can target the right one without
// walking ``BrowserWindow.getAllWindows()``.
let mainWindow: BrowserWindow | null = null

// True once the user has confirmed they want to exit. Without this flag,
// programmatic ``app.quit()`` would re-trigger the close handler in a
// loop because the BrowserWindow's close emits before the app's quit.
let confirmedQuit = false

// ---------------------------------------------------------------------------
// Backend lifecycle
// ---------------------------------------------------------------------------

function startApi(): void {
  // In dev: __dirname = desktop/out/main/ → 3 levels up = repo root (Strix/).
  // In packaged build: adjust this path to point at the bundled venv.
  const repoRoot = join(__dirname, '..', '..', '..')
  const uvExe = join(repoRoot, '.venv', 'Scripts', 'uvicorn.exe')

  apiProcess = spawn(uvExe, [
    'groundmodel.api.main:app',
    '--host', '127.0.0.1',
    '--port', String(API_PORT),
    '--no-access-log',
  ], {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env }
  })

  apiProcess.stdout?.on('data', (d) => console.log('[api]', d.toString().trim()))
  apiProcess.stderr?.on('data', (d) => console.error('[api]', d.toString().trim()))

  apiProcess.on('exit', (code) => {
    console.log(`[api] process exited with code ${code}`)
    apiProcess = null
  })
}

function stopApi(): void {
  if (apiProcess) {
    apiProcess.kill()
    apiProcess = null
  }
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

function createWindow(): void {
  const isDev = !!process.env.ELECTRON_RENDERER_URL
  const rendererBase = process.env.ELECTRON_RENDERER_URL ?? null

  // Inject Content-Security-Policy at the response-header layer so
  // it's enforced BEFORE page parse (a CSP meta tag in index.html
  // can only stop loads after the parser hits it). Production CSP is
  // strict (``script-src 'self'``); dev CSP allows Vite's HMR
  // ``unsafe-eval``. Debt #36.
  const csp = buildContentSecurityPolicy(isDev)
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp],
      },
    })
  })

  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'Strix',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Deny renderer access to obscure / dangerous webContents APIs
      // (clipboard, full-screen on file:// pages, etc.). Hardens
      // against the same XSS-as-RCE escalation #36 / #37 protect.
      sandbox: true,
    },
  })
  mainWindow = win
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })

  // Deny-by-default ``window.open`` — the renderer should never spawn
  // a same-privileges Electron window. Trusted external URLs hand
  // off to the OS browser via shell.openExternal. Debt #36.
  win.webContents.setWindowOpenHandler(({ url }) => {
    const decision = decideExternalOpen(url)
    if (decision.external) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  // Block navigation to anywhere outside the renderer base URL.
  // Without this, a malicious link in user-supplied content (a future
  // formation ``description`` field, etc.) could redirect the
  // top-level window to an attacker-controlled page that then has
  // access to the same preload + IPC surface. Debt #36.
  win.webContents.on('will-navigate', (event, url) => {
    if (!isInAppNavigation(url, rendererBase)) {
      event.preventDefault()
      // If the navigation looks like an external link the user
      // clicked, hand it off to the OS browser instead — same UX
      // as window.open above.
      const decision = decideExternalOpen(url)
      if (decision.external) void shell.openExternal(url)
    }
  })

  win.setMenuBarVisibility(true)
  buildMenu(win)

  // Window-close handler — runs on Windows X, Alt+F4, and any other
  // OS-level close. We preventDefault, hand control to the renderer
  // (which knows about the project's dirty state and runs the same
  // save-or-discard prompt the in-app close paths use), and wait for
  // the renderer to either approve or veto via ``app:quit-decision``.
  win.on('close', (event) => {
    if (confirmedQuit) return
    event.preventDefault()
    win.webContents.send('app:before-quit')
  })

  // Log renderer-process death to the main-process stdout (the same
  // PowerShell window where ``npm run dev`` runs). Without this, a
  // renderer that crashes before DevTools attaches dies silently —
  // F12 / Ctrl+R just trigger another crash cycle. Reason codes:
  // ``crashed`` / ``oom`` / ``killed`` / ``launch-failed`` etc.
  // Dogfeed 2026-05-23: Robin hit a boot-time crash loop with no
  // visible diagnostics; this surfaces the why in his terminal.
  win.webContents.on('render-process-gone', (_event, details) => {
    // eslint-disable-next-line no-console
    console.error(
      `[main] renderer process gone — reason=${details.reason} ` +
        `exitCode=${details.exitCode}`,
    )
  })
  win.webContents.on('unresponsive', () => {
    // eslint-disable-next-line no-console
    console.error('[main] renderer unresponsive (likely infinite loop or stuck await)')
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
    // ``mode: 'detach'`` opens DevTools in its own window — it survives
    // a renderer-process crash, so the post-mortem console stays
    // available when the page itself goes white. Dogfeed 2026-05-23:
    // F12 brought up DevTools in-frame, but the renderer died before
    // it could render the panel and tore it down too. A detached
    // window is owned by the main process and persists.
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// ---------------------------------------------------------------------------
// Native menu
// ---------------------------------------------------------------------------

function buildMenu(win: BrowserWindow): void {
  // Recent submenu is rebuilt every time the menu is constructed. After a
  // file is opened or saved the renderer asks main to refresh the menu so
  // the new entry appears without an app restart.
  const recent = readRecentProjects()
  const recentSubmenu: Electron.MenuItemConstructorOptions[] = recent.length
    ? recent.map(r => ({
        label: r.name,
        // Path is the source of truth — name might have drifted in the DB.
        // The renderer receives the path and re-fetches metadata before
        // rendering anything to the user.
        sublabel: r.path,
        click: () => win.webContents.send('menu:project-open-recent', r.path),
      }))
    : [{ label: '(no recent projects)', enabled: false }]

  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        {
          label: 'New Project…',
          accelerator: 'CmdOrCtrl+N',
          click: () => win.webContents.send('menu:project-new'),
        },
        {
          label: 'Open Project…',
          accelerator: 'CmdOrCtrl+O',
          click: () => win.webContents.send('menu:project-open'),
        },
        {
          label: 'Open Recent',
          submenu: recentSubmenu,
        },
        { type: 'separator' },
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: () => win.webContents.send('menu:project-save'),
        },
        {
          label: 'Save As…',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => win.webContents.send('menu:project-save-as'),
        },
        {
          label: 'Close Project',
          accelerator: 'CmdOrCtrl+W',
          click: () => win.webContents.send('menu:project-close'),
        },
        { type: 'separator' },
        {
          label: 'Import CPT…',
          accelerator: 'CmdOrCtrl+Shift+C',
          click: () => win.webContents.send('menu:import-cpt'),
        },
        {
          label: 'Import Borehole…',
          accelerator: 'CmdOrCtrl+Shift+B',
          click: () => win.webContents.send('menu:import-borehole'),
          enabled: false  // Phase 3
        },
        {
          label: 'Import DMT…',
          click: () => win.webContents.send('menu:import-dmt'),
          enabled: false  // Phase 3
        },
        { type: 'separator' },
        {
          label: 'Settings…',
          // Apple-standard ``Cmd+,`` for Preferences; Ctrl+, on Windows /
          // Linux matches VS Code + JetBrains for the same intent. Opens
          // the renderer-side SettingsDialog via IPC; same pattern as
          // every other menu signal (one-way main→renderer fire).
          accelerator: 'CmdOrCtrl+,',
          click: () => win.webContents.send('menu:open-settings'),
        },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        {
          label: 'Undo',
          // ``registerAccelerator: false`` shows the shortcut in the
          // menu label but lets the renderer's document keydown handler
          // own the actual keystroke — that handler already gates on
          // ``isTypingTarget`` so text inputs keep their native undo.
          accelerator: 'CmdOrCtrl+Z',
          registerAccelerator: false,
          click: () => win.webContents.send('menu:edit-undo'),
        },
        {
          label: 'Redo',
          accelerator: 'CmdOrCtrl+Shift+Z',
          registerAccelerator: false,
          click: () => win.webContents.send('menu:edit-redo'),
        },
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Help',
      submenu: [
        { label: 'About Strix', click: () => {
          dialog.showMessageBox(win, {
            type: 'info',
            title: 'Strix',
            message: 'Strix — Ground Model Platform',
            detail: 'Version 0.1.0 — Phase 2\nGeotechnical data management for EC7 Gen2.'
          })
        }}
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// ---------------------------------------------------------------------------
// Recent-projects helpers — JSON file in the OS-standard userData dir.
// ---------------------------------------------------------------------------

function recentProjectsFile(): string {
  return join(app.getPath('userData'), RECENT_PROJECTS_FILENAME)
}

function readRecentProjects(): RecentProject[] {
  const path = recentProjectsFile()
  if (!existsSync(path)) return []
  try {
    const raw = readFileSync(path, 'utf-8')
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    // ``isValidRecentProjectEntry`` enforces length caps so a
    // corrupted file with a 100-MB ``name`` can't freeze the menu
    // rebuild (debt #41).
    return parsed.filter(isValidRecentProjectEntry) as RecentProject[]
  } catch {
    // Corrupt / unreadable file shouldn't block startup — start fresh.
    return []
  }
}

function writeRecentProjects(entries: RecentProject[]): void {
  const dir = app.getPath('userData')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  // Atomic write so a kill mid-write (or a second writer racing) can't
  // leave the file half-overwritten. Reader handles corruption by
  // falling back to an empty list, but recovery is friendlier than
  // silent data loss of the user's recent-projects list.
  writeFileAtomic(recentProjectsFile(), JSON.stringify(entries, null, 2))
}

function addRecentProject(path: string, name: string): RecentProject[] {
  // Move-to-front: drop existing entry for the same path so we don't
  // accumulate duplicates when a user opens the same project repeatedly.
  const existing = readRecentProjects().filter(r => r.path !== path)
  const updated: RecentProject[] = [
    { path, name, lastOpened: new Date().toISOString() },
    ...existing,
  ].slice(0, RECENT_PROJECTS_MAX)
  writeRecentProjects(updated)
  // Authorise both the freshly-added path and every other recent
  // entry — the renderer's File → Open Recent path skips the
  // dialog, so without this the read would be denied.
  for (const r of updated) authorisePath(r.path)
  return updated
}

/**
 * Bootstrap the authorised-paths set at app startup with every
 * path in the recent-projects list. Without this, the user's first
 * "Open Recent" click after launching the app would fail the
 * authorisation check (the renderer skips the dialog → no fresh
 * authorisation event).
 */
function bootstrapAuthorisedPaths(): void {
  for (const r of readRecentProjects()) authorisePath(r.path)
}


// ---------------------------------------------------------------------------
// IPC handlers
// ---------------------------------------------------------------------------

ipcMain.handle('api:base-url', () => API_BASE)

ipcMain.handle('dialog:open-file', async (_event, filters: Electron.FileFilter[]) => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters
  })
  if (result.canceled) return null
  // Path returned by the OS dialog → the user just authorised it.
  // fs:read-file / project:read-file will check against this set.
  authorisePath(result.filePaths[0])
  return result.filePaths[0]
})

ipcMain.handle('dialog:open-files', async (_event, filters: Electron.FileFilter[]) => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections'],
    filters
  })
  if (result.canceled) return []
  for (const p of result.filePaths) authorisePath(p)
  return result.filePaths
})

ipcMain.handle('fs:read-file', (_event, filePath: string): Buffer => {
  if (!pathIsAuthorised(filePath)) {
    // Refuse rather than silently reading. The renderer that issued
    // this call either has a bug (didn't go through the dialog) or
    // is compromised (XSS trying to read AppData). Same error shape
    // either way so the renderer surfaces "couldn't read file".
    throw new Error(`fs:read-file refused — path not authorised: ${filePath}`)
  }
  assertFileSizeUnder(filePath, FS_READ_CAP_BYTES, 'fs:read-file')
  return readFileSync(filePath)
})

// Project file IPC. The renderer drives the file lifecycle:
//   1. New: dialog → write JSON → addRecent
//   2. Open: dialog → read JSON → addRecent
//   3. Save: write JSON to current path
// Recent-projects list is stored in userData/recent-projects.json.

ipcMain.handle('project:open-dialog', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [
      // Accept both the canonical ``.strix`` and the legacy
      // ``.gmproj`` extension so users with pre-rebrand files can
      // still open them.
      { name: 'Strix Project', extensions: PROJECT_FILE_OPEN_EXTENSIONS },
      { name: 'All Files', extensions: ['*'] },
    ],
  })
  if (result.canceled) return null
  authorisePath(result.filePaths[0])
  return result.filePaths[0]
})

ipcMain.handle(
  'project:save-dialog',
  async (_event, defaultName: string | undefined) => {
    const result = await dialog.showSaveDialog({
      filters: [{ name: 'Strix Project', extensions: [PROJECT_FILE_EXTENSION] }],
      defaultPath: defaultName,
    })
    if (result.canceled) return null
    const path = result.filePath ?? null
    authorisePath(path)
    return path
  },
)

ipcMain.handle('project:read-file', (_event, filePath: string): string => {
  if (!pathIsAuthorised(filePath)) {
    throw new Error(`project:read-file refused — path not authorised: ${filePath}`)
  }
  assertFileSizeUnder(filePath, PROJECT_READ_CAP_BYTES, 'project:read-file')
  return readFileSync(filePath, 'utf-8')
})

/**
 * Atomic file write — writes to a sibling temp file, then renames into
 * place. Rationale: a project save that gets interrupted (process kill,
 * power loss between two saves, second save racing the first) MUST NOT
 * leave the user's `.strix` file half-overwritten. The dogfeed bug on
 * 2026-05-20 was exactly this — a `\x08` (backspace) byte mid-array
 * with a partially-duplicated value, traced to two writes overlapping.
 *
 * `renameSync` on the same filesystem is atomic at the directory
 * metadata level on both NTFS (Windows) and ext4/APFS — either the old
 * file or the new file is visible to readers, never a half-written
 * blend. The temp lives in the same directory as the target so no
 * cross-filesystem rename fall-back to copy+delete occurs.
 *
 * Crash mid-write leaves a `.<basename>.tmp.<pid>` orphan that the
 * user can safely delete (no automatic cleanup — that path would risk
 * deleting a tmp from a concurrent save that hasn't renamed yet).
 */
function writeFileAtomic(filePath: string, contents: string): void {
  const tmpPath = `${filePath}.tmp.${process.pid}`
  writeFileSync(tmpPath, contents, 'utf-8')
  try {
    renameSync(tmpPath, filePath)
  } catch (renameErr) {
    // Rename failed — best-effort tmp cleanup so we don't leak. Swallow
    // unlink errors (the tmp may already be gone, or perms changed)
    // and re-throw the original rename failure as the user-visible one.
    try {
      unlinkSync(tmpPath)
    } catch {
      /* swallow */
    }
    throw renameErr
  }
}

ipcMain.handle(
  'project:write-file',
  (_event, filePath: string, contents: string): void => {
    if (!pathIsAuthorised(filePath)) {
      throw new Error(`project:write-file refused — path not authorised: ${filePath}`)
    }
    writeFileAtomic(filePath, contents)
  },
)

// Generic export-file save flow — used by the DXF section export
// today; future Plaxis / D-Sheet exporters will share the same
// dialog + write IPC pair. Caller supplies the dialog's filter +
// suggested filename; the main process returns the chosen path and
// writes the binary payload. Path authorisation flows through the
// same set as the project-file IPC.
ipcMain.handle(
  'export:save-dialog',
  async (
    _event,
    defaultName: string,
    filters: Electron.FileFilter[],
  ): Promise<string | null> => {
    const result = await dialog.showSaveDialog({
      filters,
      defaultPath: defaultName,
    })
    if (result.canceled) return null
    const path = result.filePath ?? null
    authorisePath(path)
    return path
  },
)

ipcMain.handle(
  'export:write-file',
  (_event, filePath: string, contents: ArrayBuffer): void => {
    if (!pathIsAuthorised(filePath)) {
      throw new Error(
        `export:write-file refused — path not authorised: ${filePath}`,
      )
    }
    writeFileSync(filePath, Buffer.from(contents))
  },
)

ipcMain.handle(
  'project:add-recent',
  (_event, filePath: string, name: string): RecentProject[] => {
    const updated = addRecentProject(filePath, name)
    // Rebuild the native menu so the new entry appears under "Open Recent"
    // without an app restart. Single-window today; if the user closed the
    // window we just skip the rebuild (no menu to refresh).
    if (mainWindow !== null) buildMenu(mainWindow)
    return updated
  },
)

ipcMain.handle('project:get-recent', (): RecentProject[] => readRecentProjects())

// Window title — driven by the renderer so the title stays in sync with
// the live project state (name + dirty marker). Empty / undefined falls
// back to the default app title.
// Debt #113: cap the title string so a renderer bug or a crafted IPC call
// can't inject an unbounded string into the OS title bar / log lines.
// 256 chars covers any real project name + dirty asterisk comfortably.
const _WINDOW_TITLE_MAX_LEN = 256
ipcMain.handle('window:set-title', (_event, title: string | null) => {
  if (mainWindow === null) return
  const safe = title && title !== '' ? title.slice(0, _WINDOW_TITLE_MAX_LEN) : 'Strix'
  mainWindow.setTitle(safe)
})

// Renderer's response to ``app:before-quit``. ``allowed=true`` means the
// renderer has either saved or discarded any unsaved state and we can
// finish the close; ``allowed=false`` means the user hit Cancel and we
// abort the quit. ``confirmedQuit`` short-circuits the next ``close``
// event so the renderer doesn't get re-asked.
ipcMain.handle('app:quit-decision', (_event, allowed: boolean) => {
  if (!allowed || mainWindow === null) return
  confirmedQuit = true
  mainWindow.close()
})

ipcMain.handle('api:ready', async () => {
  // Poll /openapi.json — FastAPI serves it without a DB connection, so it
  // passes as soon as uvicorn is listening regardless of PostgreSQL state.
  // 60 × 500 ms = 30 s; Python cold-start on Windows needs the extra headroom.
  // After the first tick, if the process has already exited we bail immediately
  // rather than waiting out the full 30 s.
  for (let i = 0; i < 60; i++) {
    if (i > 0 && apiProcess === null) return false  // process crashed
    try {
      const res = await fetch(`${API_BASE}/openapi.json`)
      if (res.ok) return true
    } catch {
      // not ready yet
    }
    await new Promise(r => setTimeout(r, 500))
  }
  return false
})

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

// Opt-out for hardware acceleration. Must be called BEFORE app.whenReady().
//
// Dogfeed 2026-05-23: Robin hit a boot-time renderer crash with exit code
// 0xC0000005 (Windows access violation) — a NATIVE crash before any of
// our React code runs. The most common cause on Windows Electron is the
// GPU process / driver going down (Cesium + WebGL on an older or
// recently-updated driver is a known offender). Setting
// ``STRIX_DISABLE_GPU=1`` in the env disables hardware acceleration
// entirely; the app still renders fine via software (slower 3D, but
// boots). Off by default so production isn't slowed for everyone.
if (process.env.STRIX_DISABLE_GPU === '1') {
  app.disableHardwareAcceleration()
  // eslint-disable-next-line no-console
  console.warn('[main] STRIX_DISABLE_GPU=1 — hardware acceleration disabled')
}

// Initialise Crashpad BEFORE app.whenReady() so the crashpad_handler
// process is connected when renderer/utility processes spawn. Without
// this, Electron's renderer prints the cosmetic
// ``crashpad_client_win.cc:867] not connected`` error on every dev-build
// boot. We collect crashes locally (no upload) — telemetry is a Tier B
// debt item (#16) gated on the commercial release window.
crashReporter.start({
  productName: 'Strix',
  companyName: 'Strix',
  submitURL: '',
  uploadToServer: false,
})

app.whenReady().then(() => {
  // Pre-authorise every path in the recent-projects list — without
  // this the first "Open Recent" click after launch would hit the
  // path-validation in project:read-file and get refused (debt #37).
  bootstrapAuthorisedPaths()
  startApi()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  stopApi()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', stopApi)
