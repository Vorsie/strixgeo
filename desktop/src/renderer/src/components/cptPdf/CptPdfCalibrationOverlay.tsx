// The calibration overlay of the PDF CPT import dialog.
//
// The backend draws the page with every panel frame (cyan) and the digitised
// curve (orange) back through the calibration it was read with; the user checks
// the orange line against the printed one and corrects the calibration: drag a
// frame corner, type the two tick values of an axis, name the panel's quantity,
// pick the curve colour off the page (eyedropper, for scans), then "Re-extract"
// posts the calibration dict and the overlay is redrawn through it. The sheet
// header (position, ground level, date) is always editable here: a printed
// value is the grey hint and an empty field keeps it, a typed value overrides
// it (owner finding 2026-10-08: a sheet can PRINT a wrong Y), and a value the
// sheet did not print is typed in the same field.
//
// Detected vs edited (owner dogfeed 2026-10-04): the component keeps the
// digitiser's own calibration (``detected``, the backend's
// PageCalibration.to_dict() as the first read returned it) apart from the
// user's sparse ``edits``. Every field shows the detected value as its grey
// placeholder and stays empty until the user types; an empty field means "use
// the detected value". ``applyEdits`` merges the two for the drawing, for
// "Read again" and for "Use this calibration". "Pick automatically again"
// drops every edit and posts NO calibration: POST /cpt/pdf/digitise reads an
// omitted ``calibrations`` as "the digitiser's own" (DigitiseCptPdfSounding
// resolves only the pages it is given), so the reset re-reads the page exactly
// as the first open did.
//
// One component with a small canvas (the eyedropper's pixel read); the page
// drawing lives in CptPdfOverlaySurface.tsx, the pure dict edits in
// cptPdfCalibrationEdits.ts.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  cptPdfClient,
  type CptPdfDigitised,
  type CptPdfHeaderEdit,
  type CptPdfSounding,
  type PageCalibrationDict,
  type PanelKindValue,
} from '../../api/clients/cptPdf'
import { useT } from '../../i18n/translate'
import { log } from '../../utils/log'
import Button from '../ui/Button'
import { FIELD_CLASS } from '../ui/fieldClasses'
import NumericInput from '../ui/NumericInput'
import {
  applyEdits,
  axisValues,
  formatDetectedValue,
  hasEdits,
  moveFrameCorner,
  overlayScale,
  patchPanelEdit,
  type CalibrationEdits,
  type FrameCorner,
  type PanelAxis,
} from './cptPdfCalibrationEdits'
import CptPdfOverlaySurface from './CptPdfOverlaySurface'

/** What the user settled on for one sounding. */
export interface CptPdfSoundingEdit {
  /** The calibration the import posts: ``edits`` applied over ``detected``. */
  calibrations?: PageCalibrationDict[]
  header?: CptPdfHeaderEdit
  /** The digitiser's own calibration (reopening shows it as grey hints). */
  detected?: PageCalibrationDict[]
  /** The user's edits over ``detected`` (reopening keeps them). */
  edits?: CalibrationEdits
}

/** Reads one pixel of the overlay image (RGB 0..255), or null when unreadable. */
export type PixelSampler = (image: HTMLImageElement, x: number, y: number) => [number, number, number] | null

/** Default sampler: draw the image on a small canvas and read the pixel. */
export function canvasPixel(image: HTMLImageElement, x: number, y: number): [number, number, number] | null {
  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.drawImage(image, Math.round(x), Math.round(y), 1, 1, 0, 0, 1, 1)
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
  return [r, g, b]
}

const PANEL_KINDS: PanelKindValue[] = ['qc', 'fs', 'rf', 'u2', 'inclination', 'unknown']
const DEFAULT_EPSG = 31370

type HeaderNumberKey = 'x' | 'y' | 'epsg' | 'ground_level_m'

/** What one digitise call posts beyond the sounding. */
interface ReadRequest {
  /** Omitted = the digitiser detects the calibration itself. */
  calibrations?: PageCalibrationDict[]
  groundLevelM?: number | null
}

/** Drop ``key`` from the header edit (an emptied field = no edit). */
function withoutHeaderKey(h: CptPdfHeaderEdit, key: keyof CptPdfHeaderEdit): CptPdfHeaderEdit {
  const next = { ...h }
  delete next[key]
  return next
}

interface Props {
  projectId: string
  fileSha: string
  sounding: CptPdfSounding
  /** The edit made earlier for this sounding (reopening keeps it). */
  initial: CptPdfSoundingEdit
  onDone: (edit: CptPdfSoundingEdit) => void
  onBack: () => void
  /** Injectable for tests (jsdom has no canvas). */
  samplePixel?: PixelSampler
}

interface Drag {
  page: number
  panel: number
  corner: FrameCorner
  startX: number
  startY: number
  origX: number
  origY: number
}

/**
 * Calibrate one sounding against its overlay.
 *
 * @returns The overlay panel.
 */
export default function CptPdfCalibrationOverlay({
  projectId,
  fileSha,
  sounding,
  initial,
  onDone,
  onBack,
  samplePixel = canvasPixel,
}: Props): JSX.Element {
  const t = useT()
  const [data, setData] = useState<CptPdfDigitised | null>(null)
  const [detected, setDetected] = useState<PageCalibrationDict[]>(initial.detected ?? [])
  const [edits, setEdits] = useState<CalibrationEdits>(initial.edits ?? {})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [pageIdx, setPageIdx] = useState(0)
  const [panelIdx, setPanelIdx] = useState(0)
  const [eyedropper, setEyedropper] = useState(false)
  const [header, setHeader] = useState<CptPdfHeaderEdit>(initial.header ?? {})
  const dragRef = useRef<Drag | null>(null)
  const imageRef = useRef<HTMLImageElement | null>(null)

  const cals = useMemo(() => applyEdits(detected, edits), [detected, edits])
  const edited = hasEdits(edits) || Object.keys(header).length > 0

  // ``adoptAsDetected``: the answer's calibration is the digitiser's own (a
  // read that posted none, or a reopen that kept no ``detected``).
  const read = useCallback(
    async ({ calibrations, groundLevelM }: ReadRequest, adoptAsDetected = !calibrations) => {
      setBusy(true)
      setError(null)
      try {
        const answer = await cptPdfClient.digitise({
          project_id: projectId,
          file_sha: fileSha,
          sounding_id: sounding.key,
          ...(calibrations ? { calibrations } : {}),
          ...(groundLevelM !== undefined && groundLevelM !== null ? { ground_level_m: groundLevelM } : {}),
        })
        setData(answer)
        if (adoptAsDetected) setDetected(answer.calibrations)
        log.info(
          'cpt-pdf',
          `sounding ${sounding.key} read (${calibrations ? 'edited' : 'detected'} calibration): ` +
            `${answer.series.depth_m?.length ?? 0} rows`,
        )
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        log.error('cpt-pdf', `sounding ${sounding.key} not read: ${msg}`)
        setError(msg)
      } finally {
        setBusy(false)
      }
    },
    [projectId, fileSha, sounding.key],
  )

  // Read once on open, through the earlier edit if there is one.
  useEffect(() => {
    const groundLevelM = initial.header?.ground_level_m
    if (initial.detected) {
      const kept = initial.edits ?? {}
      void read({ calibrations: hasEdits(kept) ? applyEdits(initial.detected, kept) : undefined, groundLevelM }, false)
    } else {
      // No detected calibration kept: whatever comes back is the baseline.
      void read({ calibrations: initial.calibrations, groundLevelM }, true)
    }
    // reason: the first read must run once per opened sounding; ``initial`` is
    // a fresh object on every parent render and must not re-extract.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sounding.key])

  // Corner drags follow the mouse over the whole window, not just the handle.
  useEffect(() => {
    function onMove(e: MouseEvent): void {
      const drag = dragRef.current
      if (!drag || !data || !cals[drag.page]) return
      const scale = overlayScale(cals[drag.page], data.overlays[drag.page]?.dpi ?? 72)
      const x = drag.origX + (e.clientX - drag.startX) / scale
      const y = drag.origY + (e.clientY - drag.startY) / scale
      const frame = moveFrameCorner(cals[drag.page], drag.panel, drag.corner, x, y).panels[drag.panel].frame
      setEdits(prev => patchPanelEdit(prev, drag.page, drag.panel, { frame }))
    }
    function onUp(): void {
      dragRef.current = null
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [data, cals])

  const cal = cals[pageIdx]
  const overlay = data?.overlays[pageIdx]
  const scale = cal && overlay ? overlayScale(cal, overlay.dpi) : 1
  const panel = cal?.panels[panelIdx]
  const detectedPanel = detected[pageIdx]?.panels[panelIdx]
  const panelEdit = edits[pageIdx]?.[panelIdx]

  const onSurfaceClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    if (!eyedropper || !imageRef.current) return
    const rect = e.currentTarget.getBoundingClientRect()
    const rgb = samplePixel(imageRef.current, e.clientX - rect.left, e.clientY - rect.top)
    setEyedropper(false)
    if (!rgb) return
    const next = patchPanelEdit(edits, pageIdx, panelIdx, { colourRgb: rgb })
    setEdits(next)
    void read({ calibrations: applyEdits(detected, next), groundLevelM: header.ground_level_m })
  }

  // ``undefined`` drops the typed tick: the field falls back to the read one.
  const setTick = (axis: PanelAxis, which: 'a' | 'b', v: number | undefined): void =>
    setEdits(prev => {
      const ticks = prev[pageIdx]?.[panelIdx]?.ticks ?? {}
      return patchPanelEdit(prev, pageIdx, panelIdx, {
        ticks: { ...ticks, [axis]: { ...(ticks[axis] ?? {}), [which]: v } },
      })
    })

  const axisInputs = (axis: PanelAxis): JSX.Element | null => {
    if (!panel) return null
    const [readA, readB] = detectedPanel ? axisValues(detectedPanel, axis) : [null, null]
    const typed = panelEdit?.ticks?.[axis]
    const label =
      axis === 'value'
        ? t('cptPdf.overlay.valueAxis', { unit: panel.unit || '-' })
        : cal.depth_reference === 'elevation'
          ? t('cptPdf.overlay.elevationAxis')
          : t('cptPdf.overlay.depthAxis')
    const tickInput = (which: 'a' | 'b', readValue: number | null): JSX.Element => (
      <NumericInput
        data-testid={`cpt-pdf-${axis}-tick-${which}`}
        aria-label={`${label} ${t(which === 'a' ? 'cptPdf.overlay.tickA' : 'cptPdf.overlay.tickB')}`}
        className={`w-16 px-1 ${FIELD_CLASS}`}
        allowNegative
        placeholder={formatDetectedValue(readValue)}
        value={typed?.[which] ?? Number.NaN}
        onChange={v => setTick(axis, which, v)}
        onBlur={e => {
          if (e.currentTarget.value.trim() === '') setTick(axis, which, undefined)
        }}
      />
    )
    return (
      <fieldset className="flex items-center gap-1 text-xs">
        <legend className="text-text-secondary">{label}</legend>
        {tickInput('a', readA)}
        {tickInput('b', readB)}
      </fieldset>
    )
  }

  const printed = data?.header

  const headerInput = (key: HeaderNumberKey, label: string, fallback?: number): JSX.Element => (
    <label className="flex flex-col text-xs">
      <span className="text-text-secondary">{label}</span>
      <NumericInput
        data-testid={`cpt-pdf-header-${key}`}
        className={`w-28 px-1 ${FIELD_CLASS}`}
        allowNegative={key === 'ground_level_m'}
        placeholder={formatDetectedValue(printed?.[key] ?? fallback)}
        value={header[key] ?? Number.NaN}
        onChange={v => setHeader(h => ({ ...h, [key]: v }))}
        onBlur={e => {
          if (e.currentTarget.value.trim() === '') setHeader(h => withoutHeaderKey(h, key))
        }}
      />
    </label>
  )

  const done = (): void => {
    const typed: CptPdfHeaderEdit = { ...header }
    // The default system stands in only when the sheet printed none; a printed
    // one is kept by the backend for a typed X or Y (per-field override).
    if ((typed.x !== undefined || typed.y !== undefined) && typed.epsg === undefined && (printed?.epsg ?? null) === null) {
      typed.epsg = DEFAULT_EPSG
    }
    onDone({ calibrations: cals, header: typed, detected, edits })
  }

  // Drop every edit and let the digitiser pick the calibration again: no
  // calibration and no typed ground level go out (see the file comment).
  const pickAutomatically = (): void => {
    log.info('cpt-pdf', `sounding ${sounding.key}: user edits dropped, reading the detected calibration again`)
    setEdits({})
    setHeader({})
    setEyedropper(false)
    void read({})
  }

  // Which header fields the sheet printed: the overwrite line shows when it
  // printed any, the "type it" line when it left any out.
  const printedFlags = printed
    ? [printed.x, printed.y, printed.epsg, printed.ground_level_m, printed.test_date].map(v => v !== null)
    : []
  const anyPrinted = printedFlags.some(Boolean)
  const anyMissing = printedFlags.some(flag => !flag)

  return (
    <div className="flex flex-col gap-2 text-xs" data-testid="cpt-pdf-overlay">
      <h3 className="text-sm font-semibold">
        {t('cptPdf.overlay.title', { id: sounding.sounding_id ?? sounding.key })}
      </h3>
      <p data-testid="cpt-pdf-overlay-intro" className="text-text-secondary">
        {t('cptPdf.overlay.intro')}
      </p>
      {!data && !error && <p>{t('cptPdf.overlay.loading')}</p>}
      {error && <p className="text-red-600">{t('cptPdf.overlay.readFailed', { message: error })}</p>}
      {data && cal && overlay && (
        <div className="flex gap-3">
          <div className="max-h-[60vh] flex-1 overflow-auto border border-border-subtle">
            <CptPdfOverlaySurface
              overlay={overlay}
              cal={cal}
              scale={scale}
              panelIdx={panelIdx}
              eyedropper={eyedropper}
              imageRef={imageRef}
              onSurfaceClick={onSurfaceClick}
              onCornerDown={(i, corner, e, cx, cy) => {
                e.preventDefault()
                setPanelIdx(i)
                dragRef.current = {
                  page: pageIdx,
                  panel: i,
                  corner,
                  startX: e.clientX,
                  startY: e.clientY,
                  origX: cx / scale,
                  origY: cy / scale,
                }
              }}
            />
          </div>
          <div className="flex w-64 flex-none flex-col gap-2">
            {data.page_numbers.length > 1 && (
              <div className="flex gap-1">
                {data.page_numbers.map((page, i) => (
                  <Button key={page} size="sm" variant={i === pageIdx ? 'primary' : 'secondary'} onClick={() => setPageIdx(i)}>
                    {t('cptPdf.overlay.page', { page })}
                  </Button>
                ))}
              </div>
            )}
            <div className="flex flex-wrap gap-1" role="group" aria-label={t('cptPdf.overlay.panel')}>
              {cal.panels.map((p, i) => (
                <Button
                  key={`${p.kind}-${i}`}
                  size="sm"
                  variant={i === panelIdx ? 'primary' : 'secondary'}
                  onClick={() => setPanelIdx(i)}
                >
                  {p.kind}
                </Button>
              ))}
            </div>
            {panel && (
              <>
                <label className="flex items-center gap-1">
                  <span className="text-text-secondary">{t('cptPdf.overlay.kind')}</span>
                  <select
                    data-testid="cpt-pdf-panel-kind"
                    className={`px-1 ${FIELD_CLASS}`}
                    value={panel.kind}
                    onChange={e => {
                      const kind = e.target.value as PanelKindValue
                      // Choosing the read kind again is no edit.
                      setEdits(prev =>
                        patchPanelEdit(prev, pageIdx, panelIdx, {
                          kind: kind === detectedPanel?.kind ? undefined : kind,
                        }),
                      )
                    }}
                  >
                    {PANEL_KINDS.map(k => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ))}
                  </select>
                  {panelEdit?.kind !== undefined && detectedPanel && (
                    <span data-testid="cpt-pdf-panel-kind-read" className="text-text-muted">
                      {t('cptPdf.overlay.kindRead', { kind: detectedPanel.kind })}
                    </span>
                  )}
                </label>
                {axisInputs('value')}
                {axisInputs('depth')}
                <Button
                  size="sm"
                  data-testid="cpt-pdf-eyedropper"
                  variant={eyedropper ? 'primary' : 'secondary'}
                  aria-pressed={eyedropper}
                  onClick={() => setEyedropper(v => !v)}
                >
                  {eyedropper ? t('cptPdf.overlay.eyedropperHint') : t('cptPdf.overlay.eyedropper')}
                </Button>
              </>
            )}
            <p>
              {data.series.depth_m?.length
                ? t('cptPdf.overlay.rows', { n: data.series.depth_m.length })
                : t('cptPdf.overlay.noRows')}
            </p>
            {data.clipped_count > 0 && (
              <p data-testid="cpt-pdf-clipped" className="text-amber-700 dark:text-amber-400">
                {t('cptPdf.overlay.clipped', { n: data.clipped_count })}
              </p>
            )}
            <details data-testid="cpt-pdf-assumptions">
              <summary className="cursor-pointer text-text-secondary">{t('cptPdf.overlay.assumptions')}</summary>
              <ul className="list-disc pl-4">
                {data.assumptions.map(a => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </details>
            <fieldset className="flex flex-col gap-1" data-testid="cpt-pdf-header">
              <legend className="font-semibold">{t('cptPdf.overlay.header')}</legend>
              {anyPrinted && (
                <p data-testid="cpt-pdf-header-printed-hint" className="text-text-secondary">
                  {t('cptPdf.overlay.printedEditable')}
                </p>
              )}
              {anyMissing && (
                <p data-testid="cpt-pdf-header-not-printed-hint" className="text-text-secondary">
                  {t('cptPdf.overlay.notPrinted')}
                </p>
              )}
              {headerInput('x', t('cptPdf.overlay.x'))}
              {headerInput('y', t('cptPdf.overlay.y'))}
              {headerInput('epsg', t('cptPdf.overlay.epsg'), DEFAULT_EPSG)}
              {headerInput('ground_level_m', t('cptPdf.overlay.groundLevel'))}
              <label className="flex flex-col">
                <span className="text-text-secondary">{t('cptPdf.overlay.date')}</span>
                <input
                  data-testid="cpt-pdf-header-date"
                  className={`w-28 px-1 ${FIELD_CLASS}`}
                  placeholder={printed?.test_date ?? ''}
                  value={header.test_date ?? ''}
                  onChange={e => {
                    const v = e.target.value
                    setHeader(h => (v === '' ? withoutHeaderKey(h, 'test_date') : { ...h, test_date: v }))
                  }}
                />
              </label>
            </fieldset>
          </div>
        </div>
      )}
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="secondary" onClick={onBack}>
          {t('cptPdf.overlay.back')}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          data-testid="cpt-pdf-reset"
          disabled={busy || !data || !edited}
          onClick={pickAutomatically}
        >
          {t('cptPdf.overlay.reset')}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          data-testid="cpt-pdf-reextract"
          disabled={busy || !data}
          onClick={() => void read({ calibrations: cals, groundLevelM: header.ground_level_m })}
        >
          {t('cptPdf.overlay.reextract')}
        </Button>
        <Button size="sm" variant="primary" data-testid="cpt-pdf-use" disabled={busy || !data} onClick={done}>
          {t('cptPdf.overlay.use')}
        </Button>
      </div>
    </div>
  )
}
