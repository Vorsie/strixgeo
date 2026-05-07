import { app, BrowserWindow, ipcMain, dialog, Menu } from 'electron'
import { join } from 'path'
import { spawn, ChildProcess } from 'child_process'

const API_PORT = 8765
const API_BASE = `http://127.0.0.1:${API_PORT}`

let apiProcess: ChildProcess | null = null

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

  win.setMenuBarVisibility(true)
  buildMenu(win)

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
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Import CPT…',
          accelerator: 'CmdOrCtrl+Shift+C',
          click: () => win.webContents.send('menu:import-cpt')
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

ipcMain.handle('api:ready', async () => {
  // Poll until the API responds, up to 10s.
  for (let i = 0; i < 20; i++) {
    try {
      const res = await fetch(`${API_BASE}/cpt/`)
      if (res.ok || res.status === 404) return true
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
