// The calibration overlay of the PDF CPT import dialog.
//
// The backend draws the page with every panel frame (cyan) and the digitised
// curve (orange) back through the calibration it was read with; the user checks
// the orange line against the printed one and corrects the calibration: drag a
// frame corner, type the two tick values of an axis, name the panel's quantity,
// pick the curve colour off the page (eyedropper, for scans), then "Re-extract"
// posts the calibration dict and the overlay is redrawn through it. What the
// sheet did not print (position, ground level, date) is typed here too.
//
// One component with a small canvas (the eyedropper's pixel read); the pure
// dict edits live in cptPdfCalibrationEdits.ts.

import { useCallback, useEffect, useRef, useState } from 'react'

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
import NumericInput from '../ui/NumericInput'
import {
  axisValues,
  moveFrameCorner,
  overlayScale,
  setAxisValues,
  setCurveColour,
  setPanelKind,
  type FrameCorner,
  type PanelAxis,
} from './cptPdfCalibrationEdits'

/** What the user settled on for one sounding. */
export interface CptPdfSoundingEdit {
  calibrations?: PageCalibrationDict[]
  header?: CptPdfHeaderEdit
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
const CORNERS: FrameCorner[] = ['top-left', 'bottom-right']

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
  const [cals, setCals] = useState<PageCalibrationDict[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [pageIdx, setPageIdx] = useState(0)
  const [panelIdx, setPanelIdx] = useState(0)
  const [eyedropper, setEyedropper] = useState(false)
  const [header, setHeader] = useState<CptPdfHeaderEdit>(initial.header ?? {})
  const dragRef = useRef<Drag | null>(null)
  const imageRef = useRef<HTMLImageElement | null>(null)

  const read = useCallback(
    async (calibrations?: PageCalibrationDict[]) => {
      setBusy(true)
      setError(null)
      try {
        const ground = header.ground_level_m
        const answer = await cptPdfClient.digitise({
          project_id: projectId,
          file_sha: fileSha,
          sounding_id: sounding.key,
          ...(calibrations ? { calibrations } : {}),
          ...(ground !== undefined && ground !== null ? { ground_level_m: ground } : {}),
        })
        setData(answer)
        setCals(answer.calibrations)
        log.info('cpt-pdf', `sounding ${sounding.key} read: ${answer.series.depth_m?.length ?? 0} rows`)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        log.error('cpt-pdf', `sounding ${sounding.key} not read: ${msg}`)
        setError(msg)
      } finally {
        setBusy(false)
      }
    },
    [projectId, fileSha, sounding.key, header.ground_level_m],
  )

  // Read once on open, through the earlier edit if there is one.
  useEffect(() => {
    void read(initial.calibrations)
    // reason: the first read must run once per opened sounding; re-running on
    // every header keystroke (read's identity) would re-extract while typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sounding.key])

  // Corner drags follow the mouse over the whole window, not just the handle.
  useEffect(() => {
    function onMove(e: MouseEvent): void {
      const drag = dragRef.current
      if (!drag || !data) return
      const scale = overlayScale(cals[drag.page], data.overlays[drag.page]?.dpi ?? 72)
      const x = drag.origX + (e.clientX - drag.startX) / scale
      const y = drag.origY + (e.clientY - drag.startY) / scale
      setCals(prev => prev.map((c, i) => (i === drag.page ? moveFrameCorner(c, drag.panel, drag.corner, x, y) : c)))
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

  const editPage = (edit: (c: PageCalibrationDict) => PageCalibrationDict): void =>
    setCals(prev => prev.map((c, i) => (i === pageIdx ? edit(c) : c)))

  const onSurfaceClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    if (!eyedropper || !imageRef.current) return
    const rect = e.currentTarget.getBoundingClientRect()
    const rgb = samplePixel(imageRef.current, e.clientX - rect.left, e.clientY - rect.top)
    setEyedropper(false)
    if (!rgb) return
    const next = cals.map((c, i) => (i === pageIdx ? setCurveColour(c, panelIdx, rgb) : c))
    setCals(next)
    void read(next)
  }

  const axisInputs = (axis: PanelAxis): JSX.Element | null => {
    if (!panel) return null
    const [a, b] = axisValues(panel, axis)
    const label =
      axis === 'value'
        ? t('cptPdf.overlay.valueAxis', { unit: panel.unit || '-' })
        : cal.depth_reference === 'elevation'
          ? t('cptPdf.overlay.elevationAxis')
          : t('cptPdf.overlay.depthAxis')
    const set = (na: number | null, nb: number | null): void =>
      editPage(c => setAxisValues(c, panelIdx, axis, na, nb))
    return (
      <fieldset className="flex items-center gap-1 text-xs">
        <legend className="text-text-secondary">{label}</legend>
        <NumericInput
          data-testid={`cpt-pdf-${axis}-tick-a`}
          aria-label={`${label} ${t('cptPdf.overlay.tickA')}`}
          className="w-16 rounded border border-border-subtle px-1"
          allowNegative
          value={a ?? Number.NaN}
          onChange={v => set(v, b)}
        />
        <NumericInput
          data-testid={`cpt-pdf-${axis}-tick-b`}
          aria-label={`${label} ${t('cptPdf.overlay.tickB')}`}
          className="w-16 rounded border border-border-subtle px-1"
          allowNegative
          value={b ?? Number.NaN}
          onChange={v => set(a, v)}
        />
      </fieldset>
    )
  }

  const headerInput = (
    key: 'x' | 'y' | 'epsg' | 'ground_level_m',
    label: string,
    fallback?: number,
  ): JSX.Element => (
    <label className="flex flex-col text-xs">
      <span className="text-text-secondary">{label}</span>
      <NumericInput
        data-testid={`cpt-pdf-header-${key}`}
        className="w-28 rounded border border-border-subtle px-1"
        allowNegative={key === 'ground_level_m'}
        value={header[key] ?? fallback ?? Number.NaN}
        onChange={v => setHeader(h => ({ ...h, [key]: v }))}
      />
    </label>
  )

  const done = (): void => {
    const typed: CptPdfHeaderEdit = { ...header }
    if ((typed.x !== undefined || typed.y !== undefined) && typed.epsg === undefined) {
      typed.epsg = DEFAULT_EPSG
    }
    onDone({ calibrations: cals, header: typed })
  }

  const printed = data?.header
  const needsPosition = printed ? printed.x === null || printed.y === null : false
  const needsGround = printed ? printed.ground_level_m === null : false
  const needsDate = printed ? printed.test_date === null : false

  return (
    <div className="flex flex-col gap-2 text-xs" data-testid="cpt-pdf-overlay">
      <h3 className="text-sm font-semibold">
        {t('cptPdf.overlay.title', { id: sounding.sounding_id ?? sounding.key })}
      </h3>
      {!data && !error && <p>{t('cptPdf.overlay.loading')}</p>}
      {error && <p className="text-red-600">{t('cptPdf.overlay.readFailed', { message: error })}</p>}
      {data && cal && overlay && (
        <div className="flex gap-3">
          <div className="max-h-[60vh] flex-1 overflow-auto border border-border-subtle">
            <div
              data-testid="cpt-pdf-overlay-surface"
              className={['relative', eyedropper ? 'cursor-crosshair' : ''].join(' ')}
              style={{ width: overlay.width, height: overlay.height }}
              onClick={onSurfaceClick}
            >
              <img
                ref={imageRef}
                data-testid="cpt-pdf-overlay-image"
                src={`data:image/png;base64,${overlay.png_base64}`}
                width={overlay.width}
                height={overlay.height}
                alt={t('cptPdf.overlay.page', { page: overlay.page_number })}
                draggable={false}
              />
              <svg className="absolute inset-0" width={overlay.width} height={overlay.height}>
                {cal.panels.map((p, i) => (
                  <g key={`${p.kind}-${i}`}>
                    <rect
                      x={p.frame.x0 * scale}
                      y={p.frame.y0 * scale}
                      width={(p.frame.x1 - p.frame.x0) * scale}
                      height={(p.frame.y1 - p.frame.y0) * scale}
                      fill="none"
                      stroke={i === panelIdx ? '#0ea5e9' : '#94a3b8'}
                      strokeDasharray="4 3"
                    />
                    {!eyedropper &&
                      CORNERS.map(corner => {
                        const cx = (corner === 'top-left' ? p.frame.x0 : p.frame.x1) * scale
                        const cy = (corner === 'top-left' ? p.frame.y0 : p.frame.y1) * scale
                        return (
                          <circle
                            key={corner}
                            data-testid={`cpt-pdf-corner-${i}-${corner}`}
                            aria-label={t('cptPdf.overlay.cornerHandle', {
                              corner: t(
                                corner === 'top-left'
                                  ? 'cptPdf.overlay.cornerTopLeft'
                                  : 'cptPdf.overlay.cornerBottomRight',
                              ),
                              kind: p.kind,
                            })}
                            cx={cx}
                            cy={cy}
                            r={6}
                            className="cursor-move fill-sky-500/70 stroke-white"
                            onMouseDown={e => {
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
                        )
                      })}
                  </g>
                ))}
              </svg>
            </div>
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
                    className="rounded border border-border-subtle bg-surface-panel px-1"
                    value={panel.kind}
                    onChange={e => editPage(c => setPanelKind(c, panelIdx, e.target.value as PanelKindValue))}
                  >
                    {PANEL_KINDS.map(k => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ))}
                  </select>
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
            {(needsPosition || needsGround || needsDate) && (
              <fieldset className="flex flex-col gap-1">
                <legend className="font-semibold">{t('cptPdf.overlay.header')}</legend>
                <p className="text-text-secondary">{t('cptPdf.overlay.notPrinted')}</p>
                {needsPosition && headerInput('x', t('cptPdf.overlay.x'))}
                {needsPosition && headerInput('y', t('cptPdf.overlay.y'))}
                {needsPosition && headerInput('epsg', t('cptPdf.overlay.epsg'), DEFAULT_EPSG)}
                {needsGround && headerInput('ground_level_m', t('cptPdf.overlay.groundLevel'))}
                {needsDate && (
                  <label className="flex flex-col">
                    <span className="text-text-secondary">{t('cptPdf.overlay.date')}</span>
                    <input
                      data-testid="cpt-pdf-header-date"
                      className="w-28 rounded border border-border-subtle px-1"
                      value={header.test_date ?? ''}
                      onChange={e => setHeader(h => ({ ...h, test_date: e.target.value }))}
                    />
                  </label>
                )}
              </fieldset>
            )}
          </div>
        </div>
      )}
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="secondary" onClick={onBack}>
          {t('cptPdf.overlay.back')}
        </Button>
        <Button size="sm" variant="secondary" data-testid="cpt-pdf-reextract" disabled={busy || !data} onClick={() => void read(cals)}>
          {t('cptPdf.overlay.reextract')}
        </Button>
        <Button size="sm" variant="primary" data-testid="cpt-pdf-use" disabled={busy || !data} onClick={done}>
          {t('cptPdf.overlay.use')}
        </Button>
      </div>
    </div>
  )
}
