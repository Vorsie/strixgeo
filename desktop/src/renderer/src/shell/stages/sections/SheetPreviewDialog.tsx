/**
 * Preview + controls for the cross-section PDF sheet (spec "Preview dialog").
 * The sheet itself renders in an iframe on sheet.html; every control change
 * posts a fresh payload, so the preview IS the print. The fill axis is the only
 * setting that re-runs the (async) partition build; every other control is
 * applied by re-posting the same payload.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { api } from '../../../api/client'
import type { CrossSectionResponse } from '../../../api/clients/section'
import { useT } from '../../../i18n/translate'
import { sheetGeometryOf } from '../../../sheet/SectionSheet'
import { PX_PER_MM } from '../../../sheet/sheetConstants'
import { pageFillingVex, VEX_SLIDER_MAX } from '../../../sheet/sheetGeometry'
import type { SheetPayload, SheetSettings } from '../../../sheet/sheetPayload'
import {
  defaultSheetSettings,
  readSheetSettings,
  writeSheetSettings,
} from '../../../sheet/sheetSettings'
import { log } from '../../../utils/log'
import { useShell } from '../../ShellContext'
import { useSheetPayload } from './useSheetPayload'

// One shared class for every editable control in the aside, so a control reads
// in BOTH themes (owner finding 2026-09-04: the free-text fields were
// black-on-black in dark mode). The dialog is styled with raw neutral tokens
// (its root is ``dark:bg-neutral-900``); these match rather than introduce a
// third input style.
// ``border-neutral-500`` unconditionally (NOT a lighter dark override): a
// lighter border failed the 3:1 non-text-contrast floor (WCAG 2.2 SC 1.4.11)
// against both the white and the neutral-800/900 surfaces the aside sits on, so
// the field's edge was near-invisible. neutral-500 clears 3:1 in both themes.
const CONTROL_CLASS =
  'rounded border border-neutral-500 bg-white px-1.5 py-1.5 text-neutral-900 ' +
  'focus:outline-none focus:ring-1 focus:ring-blue-500 ' +
  'dark:bg-neutral-800 dark:text-neutral-100'

export interface SheetPreviewDialogProps {
  open: boolean
  onClose: () => void
  section: CrossSectionResponse | null
  /** Which axis the panel is on — seeds the default fill. */
  isGeotech: boolean
  /** Gates the geotech fill radio (no geotech model → disabled). */
  hasGeotechModel: boolean
}

export function SheetPreviewDialog(p: SheetPreviewDialogProps): JSX.Element | null {
  const t = useT()
  const {
    project,
    toasts: { toast },
  } = useShell()
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const paneRef = useRef<HTMLDivElement>(null)
  // Once per open: the first built payload sets the fit-mode exaggeration to
  // the value that fills the page (owner 2026-09-11: "a lot of white space on
  // the pdf report no? Can't we give a better page fit to start?"). Later
  // rebuilds (a fill-axis switch) must not undo what the engineer dragged.
  const fillSeededRef = useRef(false)
  const [settings, setSettings] = useState<SheetSettings | null>(null)
  const [payload, setPayload] = useState<SheetPayload | null>(null)
  const [busy, setBusy] = useState<'build' | 'print' | null>(null)
  const [noFill, setNoFill] = useState(false)
  const [zoom, setZoom] = useState(0.5)
  const build = useSheetPayload({ selectedSection: p.section })

  // Seed settings from the section on open.
  useEffect(() => {
    if (!p.open || !p.section || !project) {
      setSettings(null)
      setPayload(null)
      return
    }
    const spacingRaw = p.section.view_state?.column_spacing
    const fallback = defaultSheetSettings({
      fill: p.isGeotech ? 'geotech' : 'litho',
      vex: p.section.vertical_exaggeration,
      spacing: typeof spacingRaw === 'number' ? spacingRaw : 1,
      projectName: project.name,
      sectionName: p.section.name,
      today: new Date().toISOString().slice(0, 10),
      labels: {
        project: t('sheet.field.project'),
        profile: t('sheet.field.profile'),
        client: t('sheet.field.client'),
        dateAuthor: t('sheet.field.dateAuthor'),
      },
    })
    // A new section starts clean: the previous section's outcome must not show
    // (or be read by a test) while this one is still building.
    setNoFill(false)
    setPayload(null)
    fillSeededRef.current = false
    setSettings(readSheetSettings(p.section.view_state, fallback))
    // reason: ``t`` is stable per language; re-seeding on a language switch
    // mid-dialog would discard the engineer's typed fields.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.open, p.section?.id, project?.id])

  // Rebuild the payload when the fill axis changes (the only setting that changes geometry).
  const fill = settings?.fill ?? null
  useEffect(() => {
    if (!settings || fill === null) return
    let cancelled = false
    setBusy('build')
    build(settings)
      .then(pl => {
        if (!cancelled) {
          setNoFill(pl === null)
          setPayload(pl)
          // Fit mode opens filling the page. A stored exaggeration is
          // overridden here on purpose: "fit" now means the page, and the
          // slider still takes the engineer wherever he wants from there.
          if (pl && !fillSeededRef.current) {
            fillSeededRef.current = true
            setSettings(s => (s && s.scaleMode === 'fit' ? { ...s, vex: pageFillingVex(pl) } : s))
          }
        }
      })
      .catch(err => {
        if (!cancelled) {
          log.error('sheet', 'payload build failed', err)
          toast('error', err instanceof Error ? err.message : t('sheet.exportFailed'))
        }
      })
      .finally(() => {
        if (!cancelled) setBusy(null)
      })
    return () => {
      cancelled = true
    }
    // reason: only the axis changes what is drawn; every other setting is
    // applied by re-posting the same payload below, without a rebuild.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fill, build])

  // The live payload = built geometry + current settings; posted into the iframe on every change.
  const live = useMemo<SheetPayload | null>(
    () => (payload && settings ? { ...payload, settings } : null),
    [payload, settings],
  )
  const post = useCallback((): void => {
    const w = iframeRef.current?.contentWindow
    if (w && live) w.postMessage({ type: 'sheet:payload', payload: live }, '*')
  }, [live])
  useEffect(post, [post])
  const geometry = live ? sheetGeometryOf(live) : null

  // Fit the sheet into the left pane.
  useEffect(() => {
    const pane = paneRef.current
    if (!pane || !geometry) return
    const fit = (): void => {
      const w = geometry.paperWidthMm * PX_PER_MM
      const h = geometry.paperHeightMm * PX_PER_MM
      setZoom(Math.min((pane.clientWidth - 32) / w, (pane.clientHeight - 32) / h, 1))
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(pane)
    return () => ro.disconnect()
  }, [geometry?.paperWidthMm, geometry?.paperHeightMm])

  const persist = useCallback(async (): Promise<void> => {
    if (!settings || !p.section || !project) return
    await api.section.update(project.id, p.section.id, {
      view_state: writeSheetSettings(p.section.view_state, settings),
    })
  }, [settings, p.section, project])

  const close = useCallback((): void => {
    void persist()
    p.onClose()
  }, [persist, p])

  const exportPdf = useCallback(async (): Promise<void> => {
    if (!live || !p.section || busy) return
    setBusy('print')
    try {
      await persist()
      const safe = p.section.name.replace(/[^A-Za-z0-9\- _]/g, '_').trim() || 'section'
      const path = await window.electron.showExportSaveDialog(
        `${safe} – ${t('sheet.fileSuffix')}.pdf`,
        [{ name: 'PDF', extensions: ['pdf'] }],
      )
      if (path === null) return
      const bytes = await window.electron.printSheetPdf(live)
      await window.electron.writeExportFile(path, bytes)
      log.success('sheet', `pdf ok section=${p.section.id} bytes=${bytes.byteLength} path=${path}`)
      toast('success', t('sheet.exported'))
    } catch (err) {
      log.error('sheet', 'pdf export failed', err)
      toast('error', err instanceof Error ? err.message : t('sheet.exportFailed'))
    } finally {
      setBusy(null)
    }
  }, [live, p.section, busy, persist, t, toast])

  useEffect(() => {
    if (!p.open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      // Escape is ALSO the Sections stage's deselect key; swallow it here so
      // closing the preview never drops the engineer back to the map.
      e.stopImmediatePropagation()
      e.preventDefault()
      close()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [p.open, close])

  if (!p.open || !settings) return null
  const set = (patch: Partial<SheetSettings>): void => setSettings(s => (s ? { ...s, ...patch } : s))
  const setField = (i: number, patch: Partial<{ label: string; value: string }>): void =>
    setSettings(s => {
      if (!s) return s
      const fields = [...s.fields] as SheetSettings['fields']
      fields[i] = { ...fields[i], ...patch }
      return { ...s, fields }
    })
  const overCap = geometry?.overCap ?? false
  const exportDisabled = busy !== null || noFill || overCap || !live
  const sheetSrc = new URL('sheet.html', window.location.href).toString()

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('sheet.title')}
      data-testid="sheet-preview-dialog"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
    >
      <div className="flex h-[92vh] w-[95vw] overflow-hidden rounded-md bg-white shadow-xl dark:bg-neutral-900">
        <div className="flex min-w-0 flex-1 flex-col bg-neutral-200 dark:bg-neutral-800">
          <div ref={paneRef} className="relative min-h-0 flex-1 overflow-hidden">
            <iframe
              ref={iframeRef}
              title={t('sheet.title')}
              src={sheetSrc}
              onLoad={post}
              data-testid="sheet-preview-frame"
              style={{
                position: 'absolute',
                left: '50%',
                top: '50%',
                width: geometry ? `${geometry.paperWidthMm}mm` : '420mm',
                height: geometry ? `${geometry.paperHeightMm}mm` : '297mm',
                border: 0,
                background: '#fff',
                boxShadow: '0 2px 12px rgba(0,0,0,.3)',
                transform: `translate(-50%, -50%) scale(${zoom})`,
                transformOrigin: 'center',
              }}
            />
          </div>
          <div
            data-testid="sheet-paper-size"
            data-busy={busy !== null || !settings}
            className={`px-4 py-2 text-sm ${overCap ? 'text-amber-700 dark:text-amber-400' : 'text-neutral-600 dark:text-neutral-300'}`}
          >
            {geometry ? t('sheet.paperSize', { w: geometry.paperWidthMm, h: geometry.paperHeightMm }) : ''}
            {overCap && geometry ? ` — ${t('sheet.tooWide', { w: geometry.paperWidthMm })}` : ''}
            {noFill ? ` — ${t('sheet.noFill')}` : ''}
          </div>
        </div>
        <aside className="flex w-80 flex-none flex-col gap-4 overflow-y-auto border-l border-neutral-200 p-4 text-sm text-neutral-800 dark:border-neutral-700 dark:text-neutral-100">
          <h2 className="text-base font-semibold">{t('sheet.title')}</h2>
          <fieldset className="flex flex-col gap-1">
            <legend className="font-medium">{t('sheet.fill')}</legend>
            <label>
              <input
                type="radio"
                name="sheet-fill"
                checked={settings.fill === 'litho'}
                onChange={() => set({ fill: 'litho' })}
                className="accent-blue-500 dark:accent-blue-400"
              />{' '}
              {t('sheet.fill.litho')}
            </label>
            <label>
              <input
                type="radio"
                name="sheet-fill"
                checked={settings.fill === 'geotech'}
                disabled={!p.hasGeotechModel}
                onChange={() => set({ fill: 'geotech' })}
                className="accent-blue-500 dark:accent-blue-400"
              />{' '}
              {t('sheet.fill.geotech')}
            </label>
          </fieldset>
          <fieldset className="flex flex-col gap-1">
            <legend className="font-medium">{t('sheet.scaleMode')}</legend>
            <label>
              <input
                type="radio"
                name="sheet-scale"
                checked={settings.scaleMode === 'fit'}
                onChange={() => set({ scaleMode: 'fit' })}
                className="accent-blue-500 dark:accent-blue-400"
              />{' '}
              {t('sheet.scaleMode.fit')}
            </label>
            <label>
              <input
                type="radio"
                name="sheet-scale"
                checked={settings.scaleMode === 'explicit'}
                onChange={() =>
                  set({
                    scaleMode: 'explicit',
                    hScale: settings.hScale ?? geometry?.printedH ?? 1000,
                    vScale: settings.vScale ?? geometry?.printedV ?? 200,
                  })
                }
                className="accent-blue-500 dark:accent-blue-400"
              />{' '}
              {t('sheet.scaleMode.explicit')}
            </label>
            {settings.scaleMode === 'explicit' && (
              <div className="mt-1 grid grid-cols-2 gap-2">
                <label>
                  {t('sheet.hScale')}{' '}
                  <input
                    type="number"
                    min={1}
                    value={settings.hScale ?? ''}
                    onChange={e => set({ hScale: Number(e.target.value) || null })}
                    className={`w-full ${CONTROL_CLASS}`}
                    data-testid="sheet-h-scale"
                  />
                </label>
                <label>
                  {t('sheet.vScale')}{' '}
                  <input
                    type="number"
                    min={1}
                    value={settings.vScale ?? ''}
                    onChange={e => set({ vScale: Number(e.target.value) || null })}
                    className={`w-full ${CONTROL_CLASS}`}
                    data-testid="sheet-v-scale"
                  />
                </label>
              </div>
            )}
            {/* Live page size + printed scales, so fit mode's growth in width and
                the explicit scales are both visible before export (owner finding
                2026-09-04: explicit mode was undiscoverable, the width surprise
                invisible). */}
            {geometry && (
              <div
                data-testid="sheet-scale-readout"
                aria-live="polite"
                className="mt-1 text-xs text-neutral-600 dark:text-neutral-300"
              >
                {t('sheet.paperSize', { w: geometry.paperWidthMm, h: geometry.paperHeightMm })}
                {' · '}
                {t('sheet.scaleReadout', { hs: geometry.printedH, vs: geometry.printedV })}
              </div>
            )}
          </fieldset>
          <label className="flex flex-col gap-1">
            <span>
              {t('sheet.vex')}{' '}
              <b>
                {settings.scaleMode === 'explicit' && geometry
                  ? Math.round(geometry.vexEffective * 10) / 10
                  : settings.vex}
                ×
              </b>
            </span>
            <input
              type="range"
              min={1}
              max={VEX_SLIDER_MAX}
              step={0.1}
              value={settings.vex}
              disabled={settings.scaleMode === 'explicit'}
              onChange={e => set({ vex: Number(e.target.value) })}
              className="accent-blue-500 dark:accent-blue-400"
              data-testid="sheet-vex"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span>{t('sheet.spacing')}</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={settings.spacing}
              onChange={e => set({ spacing: Number(e.target.value) })}
              className="accent-blue-500 dark:accent-blue-400"
              data-testid="sheet-spacing"
            />
          </label>
          <fieldset className="flex flex-col gap-2">
            <legend className="font-medium">{t('sheet.fields')}</legend>
            {settings.fields.map((f, i) => (
              <div key={i} className="grid grid-cols-[6rem_1fr] gap-1">
                <input
                  value={f.label}
                  onChange={e => setField(i, { label: e.target.value })}
                  className={`min-w-0 text-xs uppercase tracking-wide ${CONTROL_CLASS}`}
                  aria-label={t('sheet.fieldLabelAria', { n: i + 1 })}
                />
                <input
                  value={f.value}
                  onChange={e => setField(i, { value: e.target.value })}
                  className={`min-w-0 ${CONTROL_CLASS}`}
                  aria-label={f.label}
                  data-testid={`sheet-field-${i}`}
                />
              </div>
            ))}
          </fieldset>
          <div className="mt-auto flex justify-end gap-2">
            <button
              type="button"
              onClick={close}
              className="rounded border px-3 py-1.5"
              data-testid="sheet-close"
            >
              {t('sheet.close')}
            </button>
            <button
              type="button"
              onClick={() => void exportPdf()}
              disabled={exportDisabled}
              data-testid="sheet-export"
              className="rounded bg-blue-600 px-3 py-1.5 text-white disabled:opacity-50"
            >
              {busy === 'print' ? t('sheet.exporting') : t('sheet.export')}
            </button>
          </div>
        </aside>
      </div>
    </div>
  )
}
