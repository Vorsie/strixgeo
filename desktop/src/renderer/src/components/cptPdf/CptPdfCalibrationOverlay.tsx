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
// A printed-table sounding (owner ruling 2026-10-12, report Z2255777: "i see
// the thumbnail, i should be able to set the axes, that is a cpt"): the
// overlay shows its GRAPH sheet with the axes the backend detected and is
// edited exactly as a raster sheet. The printed table stays the default
// source of the stored series; the "Source" switch lets the user store the
// curve read off the graph instead, once one is read. A report that prints no
// graph sheet for it shows the sheet header to correct instead of an empty
// panel.
//
// Only the GRAPH sheets of a printed-table sounding are offered in the sheet
// strip (owner dogfeed 2026-10-14: "the table pages are also selectable but
// that is useless"); its table pages are named in a note. Its graph sheet is
// read in the background after the triage: opened before that reading is
// ready, the overlay says "Reading the graph sheet…" with a spinner.
//
// One component with a small canvas (the eyedropper's pixel read); the page
// drawing lives in CptPdfOverlaySurface.tsx, the pure dict edits in
// cptPdfCalibrationEdits.ts.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  cptPdfClient,
  isPrintedTableSounding,
  type CptPdfDigitised,
  type CptPdfHeaderEdit,
  type CptPdfSeriesSource,
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
import { pageSpan, tableSheetPages } from './cptPdfPages'
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
  /** A printed-table sounding stored from its graph sheet instead of its
   *  printed table; absent = the printed table (the default). */
  seriesSource?: Extract<CptPdfSeriesSource, 'graph'>
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
  /** A printed-table sounding: whether the background read of its graph
   *  sheet is done (false = still being read); undefined = not known. */
  graphSheetReady?: boolean
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
  graphSheetReady,
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
  const [seriesSource, setSeriesSource] = useState<CptPdfSeriesSource>(initial.seriesSource ?? 'table')
  const dragRef = useRef<Drag | null>(null)
  const imageRef = useRef<HTMLImageElement | null>(null)

  const cals = useMemo(() => applyEdits(detected, edits), [detected, edits])
  const edited = hasEdits(edits) || Object.keys(header).length > 0 || seriesSource === 'graph'
  // A printed-table sounding: the series is the printed table, the overlay
  // calibrates its graph sheet (an older backend sends no default source).
  const printedTable = isPrintedTableSounding(sounding) || data?.series_source_default === 'table'
  const graphRows = data?.graph_series?.depth_m?.length ?? 0
  // "Read graph" holds only while the picture has a qc reading.
  const source: CptPdfSeriesSource = graphRows > 0 ? seriesSource : 'table'
  const noGraphSheet = printedTable && data !== null && data.overlays.length === 0
  // The sheets that can be calibrated: one per overlay (for a printed-table
  // sounding its graph sheets only, never a table page).
  const sheetPages = useMemo(() => (data ? data.overlays.map(o => o.page_number) : []), [data])
  const tablePages = printedTable && data ? tableSheetPages(data.page_numbers, sheetPages) : []
  const waitingForGraph = printedTable && graphSheetReady === false

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
    if (!printedTable) {
      onDone({ calibrations: cals, header: typed, detected, edits })
      return
    }
    // A printed-table sounding posts its graph calibration only once it reads
    // a qc curve: a detected draft without tick values would fail the import.
    log.info('cpt-pdf', `sounding ${sounding.key}: stored from the ${source === 'graph' ? 'graph sheet' : 'printed table'}`)
    onDone({
      ...(graphRows > 0 ? { calibrations: cals } : {}),
      header: typed,
      detected,
      edits,
      ...(source === 'graph' ? { seriesSource: 'graph' as const } : {}),
    })
  }

  // Drop every edit and let the digitiser pick the calibration again: no
  // calibration and no typed ground level go out (see the file comment).
  const pickAutomatically = (): void => {
    log.info('cpt-pdf', `sounding ${sounding.key}: user edits dropped, reading the detected calibration again`)
    setEdits({})
    setHeader({})
    setSeriesSource('table')
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

  // The sheet header (always editable, see the file comment); shared by the
  // calibration side panel and the no-graph-sheet view of a printed table.
  const headerFieldset = (
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
  )

  // A printed-table sounding: the rows of the table, of the graph reading,
  // how far apart they are, and which one the import stores.
  const comparison = data?.graph_comparison
  const sourceGroup = `cpt-pdf-series-source-${sounding.key}`
  const tableSummary = data && printedTable && (
    <>
      <p data-testid="cpt-pdf-table-rows">{t('cptPdf.overlay.tableRows', { n: data.series.depth_m?.length ?? 0 })}</p>
      {graphRows > 0 ? (
        <p data-testid="cpt-pdf-graph-rows">{t('cptPdf.overlay.graphRows', { n: graphRows })}</p>
      ) : (
        <p data-testid="cpt-pdf-graph-not-read">{t('cptPdf.overlay.graphNotRead')}</p>
      )}
      {comparison && (
        <p data-testid="cpt-pdf-graph-comparison">
          {t('cptPdf.overlay.graphComparison', {
            n: comparison.n,
            median: comparison.median_abs_qc_mpa.toFixed(2),
            rms: comparison.rms_qc_mpa.toFixed(2),
          })}
        </p>
      )}
      <fieldset className="flex flex-col gap-0.5" data-testid="cpt-pdf-series-source">
        <legend className="font-semibold">{t('cptPdf.overlay.source')}</legend>
        <label className="flex items-center gap-1">
          <input type="radio" name={sourceGroup} checked={source === 'table'} onChange={() => setSeriesSource('table')} />
          {t('cptPdf.overlay.sourceTable')}
        </label>
        <label className="flex items-center gap-1" title={graphRows > 0 ? undefined : t('cptPdf.overlay.sourceGraphHint')}>
          <input
            type="radio"
            name={sourceGroup}
            checked={source === 'graph'}
            disabled={graphRows === 0}
            onChange={() => setSeriesSource('graph')}
          />
          {t('cptPdf.overlay.sourceGraph')}
        </label>
      </fieldset>
    </>
  )

  return (
    <div className="flex flex-col gap-2 text-xs" data-testid="cpt-pdf-overlay">
      <h3 className="text-sm font-semibold">
        {t('cptPdf.overlay.title', { id: sounding.sounding_id ?? sounding.key })}
      </h3>
      <p data-testid="cpt-pdf-overlay-intro" className="text-text-secondary">
        {t('cptPdf.overlay.intro')}
      </p>
      {!data && !error && waitingForGraph && (
        <p data-testid="cpt-pdf-graph-loading" className="flex items-center gap-2" role="status">
          <span
            aria-hidden="true"
            className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-blue-400 border-t-transparent"
          />
          {t('cptPdf.overlay.graphLoading')}
        </p>
      )}
      {!data && !error && !waitingForGraph && <p>{t('cptPdf.overlay.loading')}</p>}
      {error && <p className="text-red-600">{t('cptPdf.overlay.readFailed', { message: error })}</p>}
      {data && noGraphSheet && (
        <div className="flex flex-col gap-2">
          <p data-testid="cpt-pdf-no-graph-sheet">{t('cptPdf.overlay.noGraphSheet')}</p>
          <p data-testid="cpt-pdf-table-rows">{t('cptPdf.overlay.tableRows', { n: data.series.depth_m?.length ?? 0 })}</p>
          {headerFieldset}
        </div>
      )}
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
            {sheetPages.length > 1 && (
              <div className="flex gap-1">
                {sheetPages.map((page, i) => (
                  <Button key={page} size="sm" variant={i === pageIdx ? 'primary' : 'secondary'} onClick={() => setPageIdx(i)}>
                    {t('cptPdf.overlay.page', { page })}
                  </Button>
                ))}
              </div>
            )}
            {tablePages.length > 0 && (
              <p data-testid="cpt-pdf-table-sheets" className="text-text-secondary">
                {t('cptPdf.overlay.tableSheets', { pages: pageSpan(tablePages) })}
              </p>
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
            {printedTable ? (
              tableSummary
            ) : (
              <p>
                {data.series.depth_m?.length
                  ? t('cptPdf.overlay.rows', { n: data.series.depth_m.length })
                  : t('cptPdf.overlay.noRows')}
              </p>
            )}
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
            {headerFieldset}
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
          disabled={busy || !data || !edited || noGraphSheet}
          onClick={pickAutomatically}
        >
          {t('cptPdf.overlay.reset')}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          data-testid="cpt-pdf-reextract"
          disabled={busy || !data || noGraphSheet}
          onClick={() => void read({ calibrations: cals, groundLevelM: header.ground_level_m })}
        >
          {t('cptPdf.overlay.reextract')}
        </Button>
        <Button size="sm" variant="primary" data-testid="cpt-pdf-use" disabled={busy || !data} onClick={done}>
          {noGraphSheet ? t('cptPdf.overlay.saveHeader') : t('cptPdf.overlay.use')}
        </Button>
      </div>
    </div>
  )
}
