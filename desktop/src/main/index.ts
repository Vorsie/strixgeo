import { app, BrowserWindow, ipcMain, dialog, Menu } from 'electron'
import { join } from 'path'
import { spawn, ChildProcess } from 'child_process'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'

// File extension for project files. Kept here (not imported from the
// renderer) so the main process is build-self-contained — Electron's
// ``out/main`` doesn't include the renderer source tree.
const PROJECT_FILE_EXTENSION = 'gmproj'

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
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'Ground Model',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    }
  })
  mainWindow = win
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
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

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
    win.webContents.openDevTools()
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
        { role: 'quit' }
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
        { label: 'About Ground Model', click: () => {
          dialog.showMessageBox(win, {
            type: 'info',
            title: 'Ground Model',
            message: 'Ground Model Platform',
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
    return Array.isArray(parsed) ? parsed.filter(isRecentProject) : []
  } catch {
    // Corrupt / unreadable file shouldn't block startup — start fresh.
    return []
  }
}

function isRecentProject(value: unknown): value is RecentProject {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.path === 'string' &&
    typeof v.name === 'string' &&
    typeof v.lastOpened === 'string'
  )
}

function writeRecentProjects(entries: RecentProject[]): void {
  const dir = app.getPath('userData')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(recentProjectsFile(), JSON.stringify(entries, null, 2), 'utf-8')
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
  return updated
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
  return result.canceled ? null : result.filePaths[0]
})

ipcMain.handle('dialog:open-files', async (_event, filters: Electron.FileFilter[]) => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections'],
    filters
  })
  return result.canceled ? [] : result.filePaths
})

ipcMain.handle('fs:read-file', (_event, filePath: string): Buffer => {
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
      { name: 'Ground Model Project', extensions: [PROJECT_FILE_EXTENSION] },
      { name: 'All Files', extensions: ['*'] },
    ],
  })
  return result.canceled ? null : result.filePaths[0]
})

ipcMain.handle(
  'project:save-dialog',
  async (_event, defaultName: string | undefined) => {
    const result = await dialog.showSaveDialog({
      filters: [{ name: 'Ground Model Project', extensions: [PROJECT_FILE_EXTENSION] }],
      defaultPath: defaultName,
    })
    return result.canceled ? null : result.filePath ?? null
  },
)

ipcMain.handle('project:read-file', (_event, filePath: string): string => {
  return readFileSync(filePath, 'utf-8')
})

ipcMain.handle(
  'project:write-file',
  (_event, filePath: string, contents: string): void => {
    writeFileSync(filePath, contents, 'utf-8')
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
ipcMain.handle('window:set-title', (_event, title: string | null) => {
  if (mainWindow === null) return
  mainWindow.setTitle(title && title !== '' ? title : 'Ground Model')
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

app.whenReady().then(() => {
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
