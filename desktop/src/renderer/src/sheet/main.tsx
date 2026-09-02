/**
 * The sheet page. Waits for a ``SheetPayloadMessage`` — from the preview
 * dialog's ``postMessage`` (iframe) or from the main process relay (print
 * window) — renders the sheet, and reports ``sheet:ready`` back the same way
 * once fonts and tiles are settled (or the tile wait expired).
 */
import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { translate } from '../i18n/translate'
import { SectionSheet, sheetGeometryOf } from './SectionSheet'
import { SheetMap } from './SheetMap'
import type { SheetPayload, SheetPayloadMessage, SheetReadyMessage } from './sheetPayload'

function isPayloadMessage(data: unknown): data is SheetPayloadMessage {
  return !!data && typeof data === 'object' && (data as SheetPayloadMessage).type === 'sheet:payload'
}

function report(msg: SheetReadyMessage): void {
  if (window.parent !== window) window.parent.postMessage(msg, '*')
  window.electron?.sheetReady?.(msg)
}

function SheetApp(): JSX.Element | null {
  const [payload, setPayload] = useState<SheetPayload | null>(null)
  useEffect(() => {
    const onMessage = (e: MessageEvent): void => { if (isPayloadMessage(e.data)) setPayload(e.data.payload) }
    window.addEventListener('message', onMessage)
    const off = window.electron?.onSheetPayload?.(p => setPayload(p))
    return () => { window.removeEventListener('message', onMessage); off?.() }
  }, [])
  if (!payload) return null
  const g = sheetGeometryOf(payload)
  const onReady = (offline: boolean): void => {
    void document.fonts.ready.then(() => report({ type: 'sheet:ready', paperWidthMm: g.paperWidthMm, paperHeightMm: g.paperHeightMm, offline }))
  }
  return (
    <SectionSheet
      payload={payload}
      map={<SheetMap payload={payload} offlineLabel={translate(payload.language, 'sheet.map.offline')} onReady={onReady} />}
    />
  )
}

createRoot(document.getElementById('sheet-root')!).render(<StrictMode><SheetApp /></StrictMode>)
