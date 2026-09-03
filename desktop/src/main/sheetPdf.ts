/**
 * ``sheet:print-pdf``: render sheet.html in a hidden window with the given
 * payload and print it through Chromium (spec "Print pipeline"). The renderer
 * keeps the save dialog + atomic write; this only returns bytes.
 *
 * The main process logs to the console (dev) / backend.log (packaged) via plain
 * ``console.*`` like the rest of ``index.ts``, so ``registerSheetPdfIpc`` needs
 * no injected logger.
 */
import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'

import { applyWindowGuards } from './windowGuards'

const PRINT_TIMEOUT_MS = 30_000
const MM_PER_INCH = 25.4

type Log = (level: 'info' | 'warn' | 'error', msg: string) => void

interface ReadyMessage {
  type: 'sheet:ready'
  paperWidthMm: number
  paperHeightMm: number
  offline: boolean
}

function consoleLog(level: 'info' | 'warn' | 'error', msg: string): void {
  const line = `[main] ${msg}`
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.info(line)
}

function sheetTarget(): { kind: 'url'; url: string } | { kind: 'file'; path: string } {
  const dev = process.env.ELECTRON_RENDERER_URL
  return dev
    ? { kind: 'url', url: `${dev.replace(/\/$/, '')}/sheet.html` }
    : { kind: 'file', path: join(__dirname, '../renderer/sheet.html') }
}

/**
 * Render + print the sheet, returning the PDF bytes.
 *
 * Parameters
 * ----------
 * payload : the ``SheetPayload`` (opaque here — relayed to the page verbatim).
 * log : structured log sink; defaults to the main-process console.
 */
export async function printSheetToPdf(payload: unknown, log: Log = consoleLog): Promise<Buffer> {
  const win = new BrowserWindow({
    show: false,
    width: 1600,
    height: 1200,
    webPreferences: {
      // The preload IS required: the hidden page reports ``sheet:ready`` and
      // receives ``sheet:payload`` through ``window.electron`` (contextBridge).
      // It is the SAME preload the main window uses under ``sandbox: true``, so
      // sandboxing the print window too costs nothing and hardens it (audit M6).
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      // DevTools off in a packaged build, matching the main window (backend
      // stdout carries the DB credentials; the reload discards session state).
      devTools: !app.isPackaged,
    },
  })
  const wc = win.webContents
  // The print window renders ``.strix`` content, so it gets the SAME deny-by-
  // default window.open + pinned-navigation guards as the main window (audit M6).
  // The sheet lives under the renderer dir, so its in-app base is that dir.
  const rendererBase = process.env.ELECTRON_RENDERER_URL ?? null
  const rendererFileBase = rendererBase ? null : pathToFileURL(join(__dirname, '../renderer/')).href
  applyWindowGuards(wc, {
    rendererBase,
    rendererFileBase,
    openExternal: url => void shell.openExternal(url),
  })
  try {
    const ready = new Promise<ReadyMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        ipcMain.removeListener('sheet:ready', onReady)
        reject(new Error(`sheet did not become ready within ${PRINT_TIMEOUT_MS} ms`))
      }, PRINT_TIMEOUT_MS)
      const onReady = (event: Electron.IpcMainEvent, msg: ReadyMessage): void => {
        if (event.sender.id !== wc.id) return
        clearTimeout(timer)
        ipcMain.removeListener('sheet:ready', onReady)
        resolve(msg)
      }
      ipcMain.on('sheet:ready', onReady)
    })
    wc.once('did-finish-load', () => {
      wc.send('sheet:payload', payload)
    })
    const target = sheetTarget()
    if (target.kind === 'url') await win.loadURL(target.url)
    else await win.loadFile(target.path)
    const msg = await ready
    log('info', `sheet ready ${msg.paperWidthMm}×${msg.paperHeightMm} mm offline=${msg.offline}`)
    const pdf = await wc.printToPDF({
      pageSize: { width: msg.paperWidthMm / MM_PER_INCH, height: msg.paperHeightMm / MM_PER_INCH },
      printBackground: true,
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      preferCSSPageSize: false,
    })
    log('info', `sheet pdf ${pdf.byteLength} bytes`)
    return pdf
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }
}

/** Register the ``sheet:print-pdf`` handler; returns an ``ArrayBuffer`` to the renderer. */
export function registerSheetPdfIpc(): void {
  ipcMain.handle('sheet:print-pdf', async (_event, payload: unknown): Promise<ArrayBuffer> => {
    const buf = await printSheetToPdf(payload)
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
  })
}
