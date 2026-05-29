// Minimal Electron renderer-load smoke test.
//
// Usage from PowerShell, inside ``desktop\``:
//   .\node_modules\.bin\electron scripts\electron-smoke.cjs
//
// Loads a tiny data: URL — no dev server, no React bundle, no Cesium,
// no preload bridge. If even this crashes with exit -1073741819, the
// problem is in Electron / system / driver, NOT in our app code.
// If this works, we have proof the problem is in our renderer bundle.
//
// Dogfeed 2026-05-23: added during the boot-crash investigation that
// followed reverting the dogfeed batch. Pure diagnostic. Safe to
// delete once the crash is understood.

const { app, BrowserWindow } = require('electron')

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      sandbox: true,
    },
  })

  win.webContents.on('render-process-gone', (_event, details) => {
    // eslint-disable-next-line no-console
    console.error(
      `[smoke] renderer gone — reason=${details.reason} exitCode=${details.exitCode}`,
    )
  })

  win.webContents.on('did-finish-load', () => {
    // eslint-disable-next-line no-console
    console.log('[smoke] renderer loaded successfully — Electron renderer works')
  })

  win.loadURL(
    'data:text/html,<h1 style="font-family:sans-serif;padding:2rem">If you can read this, Electron renderer works.</h1>',
  )
})

app.on('window-all-closed', () => {
  app.quit()
})
