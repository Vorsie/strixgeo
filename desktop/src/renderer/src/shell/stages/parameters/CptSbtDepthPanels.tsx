// Tall, depth-synced panels for one CPT — qc | fs+Rf | Ic | both SBT strips.
//
// Owner ruling (dogfeed 2026-08-03): the old inline Ic chart under the per-test
// table was "all horizontal and squished". A depth series reads TALL (the
// CptChart convention), so this renders a fixed number of PIXELS PER METRE down
// a scrollable column instead of squeezing the whole hole into one viewport
// height. Every panel shares one depth scale, so a feature at 7.4 m lines up
// across all five.
//
// Owner ruling (4): BOTH classifiers are shown. The left strip is the full
// normalised Robertson-2015 pipeline — the one that carries Daniel Verastegui's
// extended organic/peat boundary — and the right strip is the non-normalised
// I_SBT. Where they disagree is exactly what the engineer needs to see, so
// neither is hidden behind a toggle.
//
// Plain SVG, not Recharts: five panels at ~90 px wide inside a 420 px inspector
// is a layout Recharts' responsive container fights, and the only marks needed
// are a polyline, a band rect and a run of fills.

import { memo, useMemo } from 'react'

import { useT } from '../../../i18n/translate'
import type { CptPlotResponse, CptSbtProfileResponse } from '../../../api/client'
import { IC_AXIS_MAX, sbtZoneSpec } from '../../../utils/robertsonSbt'
import {
  buildPath,
  chooseGridStep,
  depthToY,
  finite,
  gridTicks,
  zoneRuns,
  type ZoneRun,
} from './depthPanelGeometry'
import { IC_ZONES, SBT_ZONE_FILL } from './icBands'

// ── Vertical scale ───────────────────────────────────────────────────────────
// 28 px per metre puts a 30 m CPT at 840 px — roughly two inspector heights, so
// the panel scrolls rather than compressing. Deep holes stay legible; shallow
// ones are floored so a 2 m CPT is not a postage stamp.
const PX_PER_METRE = 28
const MIN_CONTENT_H = 420

// Column widths (px). The strips are narrow on purpose: they are categorical,
// so they carry no axis and need only enough width to read as a colour run.
const RULER_W = 34
const STRIP_W = 22

// Curve colours — CSS vars from index.css so dark/light both work.
const QC_CLR = 'var(--chart-clr-qc, #2563eb)'
const FS_CLR = 'var(--chart-clr-fs, #16a34a)'
const RF_CLR = 'var(--chart-clr-rf, #ea580c)'
const IC_CLR = 'var(--chart-clr-ic, #7c3aed)'
const GRID = 'var(--chart-grid, #e5e7eb)'

/** Fill for a depth point neither classifier could evaluate. */
const UNCLASSIFIED_FILL = 'transparent'

interface Props {
  /** Raw depth series from ``GET /cpt/{id}/plot``. */
  plot: CptPlotResponse
  /** Both SBT classifications; ``null`` while the profile is still loading. */
  profile: CptSbtProfileResponse | null
}

/**
 * Depth-synced panel stack for one CPT.
 *
 * Parameters
 * ----------
 * plot : CptPlotResponse
 *     Raw series (qc / fs / Rf) plus the derived Ic curve.
 * profile : CptSbtProfileResponse | null
 *     Both zone strips. ``null`` renders the curve panels alone rather than
 *     blocking them — the raw measurements are already fetched and useful.
 *
 * Returns
 * -------
 * JSX.Element
 *     The scrollable panel stack.
 */
function CptSbtDepthPanels({ plot, profile }: Props): JSX.Element {
  const t = useT()
  const depths = plot.depths_m
  const maxDepth = depths.length > 0 ? (depths[depths.length - 1] ?? 0) : 0
  const contentH = Math.max(MIN_CONTENT_H, Math.ceil(maxDepth) * PX_PER_METRE)

  // Per-curve axis maxima from the data. Floors keep a flat/near-zero series
  // from collapsing onto the axis (a 0-wide domain divides by zero).
  const qcMax = Math.max(1, ...finite(plot.qc_mpa))
  const fsMax = Math.max(0.05, ...finite(plot.fs_mpa ?? []))
  const rfMax = Math.max(1, ...finite(plot.rf_pct ?? []))

  const gridStep = chooseGridStep(maxDepth)

  // Collapse each strip to its RUNS before drawing. A DOV CPT at 2 cm sampling
  // over 30 m is ~1500 points per strip; adjacent samples almost always share a
  // zone, so one <rect> per sample is ~3000 nodes of which the great majority
  // are redundant. Memoised on the profile identity so typing in the
  // water-table draft above does not rebuild them (the panel is also
  // React.memo'd, so it does not even re-render for that).
  const normalisedRuns = useMemo(
    () => zoneRuns(depths, profile?.zone_normalised ?? null),
    [depths, profile],
  )
  const nonNormalisedRuns = useMemo(
    () => zoneRuns(depths, profile?.zone_non_normalised ?? null),
    [depths, profile],
  )

  return (
    <div className="flex flex-col min-h-0 flex-1" data-testid="cpt-sbt-depth-panels">
      {/* Column headers — same widths as the body row so they stay aligned. */}
      <div className="flex gap-1 px-2 pt-1 pb-0.5 text-[9px] text-text-muted shrink-0">
        <div style={{ width: RULER_W }} className="shrink-0">
          m
        </div>
        {/* i18n-exempt: qc / fs / Rf / Ic are measurement symbols — domain canon */}
        <ColumnHeader label="qc" hint={`0–${qcMax.toFixed(0)} MPa`} />
        {/* i18n-exempt: measurement symbols — domain canon */}
        <ColumnHeader label="fs / Rf" hint={`0–${fsMax.toFixed(2)} MPa · 0–${rfMax.toFixed(1)} %`} />
        {/* i18n-exempt: measurement symbol — domain canon */}
        <ColumnHeader label="Ic" hint={`0–${IC_AXIS_MAX}`} />
        <div style={{ width: STRIP_W }} className="shrink-0 text-center" title={t('params.sbtNormalised')}>
          {/* i18n-exempt: SBTn is a domain abbreviation (normalised SBT zone) */}
          SBTn
        </div>
        <div style={{ width: STRIP_W }} className="shrink-0 text-center" title={t('params.sbtNonNormalised')}>
          {/* i18n-exempt: SBT is a domain abbreviation (soil behaviour type) */}
          SBT
        </div>
      </div>

      {/* Scrollable body — the panels are TALL; the container scrolls. */}
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
        <div className="flex gap-1 px-2 pb-4" style={{ height: contentH }}>
          <DepthRuler maxDepth={maxDepth} contentH={contentH} gridStep={gridStep} />

          <CurvePanel
            testid="cpt-panel-qc"
            depths={depths}
            maxDepth={maxDepth}
            contentH={contentH}
            gridStep={gridStep}
            curves={[{ values: plot.qc_mpa, max: qcMax, color: QC_CLR }]}
          />

          <CurvePanel
            testid="cpt-panel-fs-rf"
            depths={depths}
            maxDepth={maxDepth}
            contentH={contentH}
            gridStep={gridStep}
            curves={[
              { values: plot.fs_mpa ?? [], max: fsMax, color: FS_CLR },
              { values: plot.rf_pct ?? [], max: rfMax, color: RF_CLR },
            ]}
          />

          <CurvePanel
            testid="cpt-panel-ic"
            depths={depths}
            maxDepth={maxDepth}
            contentH={contentH}
            gridStep={gridStep}
            // The corrected Ic band background travels with the curve — it is
            // the same shared table the classifier uses (icBands.ts).
            bands={IC_ZONES.map(z => ({ x1: z.x1 / IC_AXIS_MAX, x2: z.x2 / IC_AXIS_MAX, fill: z.fill }))}
            curves={[{ values: plot.ic ?? [], max: IC_AXIS_MAX, color: IC_CLR }]}
          />

          <ZoneStrip
            testid="cpt-strip-normalised"
            maxDepth={maxDepth}
            contentH={contentH}
            runs={normalisedRuns}
          />
          <ZoneStrip
            testid="cpt-strip-non-normalised"
            maxDepth={maxDepth}
            contentH={contentH}
            runs={nonNormalisedRuns}
          />
        </div>
      </div>

      {/* Legend — only the zones this CPT actually contains, so a 3-zone hole
          does not carry a nine-row key. */}
      <ZoneLegend runs={[normalisedRuns, nonNormalisedRuns]} />

      {/* Provenance, attached to the derived thing itself (Data Integrity Rule
          1). The water-table line at the top of the pane is the editable
          surface; this says WHICH of the two strips that number even feeds. */}
      {profile !== null && (
        <div
          className="px-2 pb-1 text-[9px] text-text-muted"
          data-testid="cpt-sbt-derivation-note"
        >
          {t('params.sbtDerivationNote', {
            gwt: profile.gwt_m.toFixed(2),
            // The raw gwt-source enum, translated to the same short label the
            // engine writes ("recorded" / "engineer" / "assumed").
            source: t(
              profile.gwt_source === 'engineer'
                ? 'params.gwtEngineerShort'
                : profile.gwt_source === 'recorded'
                  ? 'params.gwtRecorded'
                  : 'params.gwtAssumed',
            ),
          })}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ColumnHeader({ label, hint }: { label: string; hint: string }): JSX.Element {
  return (
    <div className="flex-1 min-w-0 truncate" title={hint}>
      {label}
    </div>
  )
}

/**
 * Depth ruler shared by every panel — labels every ``gridStep`` metres.
 */
function DepthRuler({
  maxDepth,
  contentH,
  gridStep,
}: {
  maxDepth: number
  contentH: number
  gridStep: number
}): JSX.Element {
  const ticks = gridTicks(maxDepth, gridStep)
  return (
    <div className="shrink-0 relative" style={{ width: RULER_W }} data-testid="cpt-depth-ruler">
      {ticks.map(d => (
        <span
          key={d}
          className="absolute right-1 text-[9px] text-text-muted tabular-nums"
          // -0.5em lifts the label onto its own gridline instead of below it.
          style={{ top: depthToY(d, maxDepth, contentH), transform: 'translateY(-0.5em)' }}
        >
          {d.toFixed(0)}
        </span>
      ))}
    </div>
  )
}

interface CurveSpec {
  values: (number | null)[]
  max: number
  color: string
}

/**
 * One vertical curve panel: optional band background + 1–2 depth series.
 *
 * ``preserveAspectRatio="none"`` lets the 0–100 user-space X map onto whatever
 * pixel width flexbox gives the column; ``vectorEffect="non-scaling-stroke"``
 * keeps the resulting non-uniform scale from distorting the line weight.
 */
function CurvePanel({
  depths,
  maxDepth,
  contentH,
  gridStep,
  curves,
  bands,
  testid,
}: {
  depths: number[]
  maxDepth: number
  contentH: number
  gridStep: number
  curves: CurveSpec[]
  bands?: { x1: number; x2: number; fill: string }[]
  testid: string
}): JSX.Element {
  return (
    <div className="flex-1 min-w-0 border border-border-subtle rounded-sm bg-surface-app">
      <svg
        width="100%"
        height={contentH}
        viewBox={`0 0 100 ${contentH}`}
        preserveAspectRatio="none"
        data-testid={testid}
      >
        {bands?.map(b => (
          <rect
            key={`${b.x1}-${b.x2}`}
            x={b.x1 * 100}
            y={0}
            width={(b.x2 - b.x1) * 100}
            height={contentH}
            fill={b.fill}
          />
        ))}
        {gridTicks(maxDepth, gridStep).map(d => (
          <line
            key={d}
            x1={0}
            x2={100}
            y1={depthToY(d, maxDepth, contentH)}
            y2={depthToY(d, maxDepth, contentH)}
            stroke={GRID}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {curves.map((c, i) => (
          <path
            key={i}
            d={buildPath(depths, c.values, c.max, maxDepth, contentH)}
            fill="none"
            stroke={c.color}
            strokeWidth={1.2}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
    </div>
  )
}

/**
 * Categorical zone strip — one fill run per depth interval.
 *
 * A ``null`` zone is left TRANSPARENT rather than given a colour: an
 * unclassifiable point (no sleeve friction) is an absence, and painting it
 * would read as a soil.
 */
function ZoneStrip({
  maxDepth,
  contentH,
  runs,
  testid,
}: {
  maxDepth: number
  contentH: number
  runs: readonly ZoneRun[]
  testid: string
}): JSX.Element {
  const t = useT()
  return (
    <div
      className="shrink-0 border border-border-subtle rounded-sm bg-surface-app"
      style={{ width: STRIP_W }}
    >
      <svg
        width="100%"
        height={contentH}
        viewBox={`0 0 10 ${contentH}`}
        preserveAspectRatio="none"
        data-testid={testid}
      >
        {runs.map(run => {
          const yTop = depthToY(run.topM, maxDepth, contentH)
          const yBot = depthToY(run.baseM, maxDepth, contentH)
          const spec = sbtZoneSpec(run.zone)
          return (
            <rect
              key={run.topM}
              x={0}
              y={yTop}
              width={10}
              height={Math.max(0.5, yBot - yTop)}
              fill={SBT_ZONE_FILL[run.zone] ?? UNCLASSIFIED_FILL}
            >
              <title>
                {`${run.topM.toFixed(2)}–${run.baseM.toFixed(2)} m — ${
                  spec ? spec.label : t('params.zoneN', { n: run.zone })
                }`}
              </title>
            </rect>
          )
        })}
      </svg>
    </div>
  )
}

/** Colour key for the zones present in this CPT (both strips pooled). */
function ZoneLegend({
  runs,
}: {
  runs: readonly (readonly ZoneRun[])[]
}): JSX.Element | null {
  const t = useT()
  const present = new Set<number>()
  for (const strip of runs) for (const run of strip) present.add(run.zone)
  if (present.size === 0) return null
  return (
    <div
      className="flex flex-wrap gap-x-2 gap-y-0.5 px-2 py-1 border-t border-border-subtle shrink-0"
      data-testid="cpt-sbt-zone-legend"
    >
      {[...present]
        .sort((a, b) => a - b)
        .map(zone => {
          const spec = sbtZoneSpec(zone)
          return (
            <span
              key={zone}
              className="flex items-center gap-1 text-[9px] text-text-secondary"
              title={spec?.label ?? t('params.zoneN', { n: zone })}
            >
              <span
                className="w-2.5 h-2.5 rounded-sm border border-border-subtle shrink-0"
                style={{ background: SBT_ZONE_FILL[zone] ?? UNCLASSIFIED_FILL }}
              />
              {spec?.short ?? zone}
            </span>
          )
        })}
    </div>
  )
}

// React.memo: the panel stack is a plain child of ParametersInspector, so
// without it EVERY keystroke in the water-table draft above rebuilt the whole
// SVG tree. Its two props are the fetched plot and profile objects, whose
// identities change only when a real fetch lands — exactly the shape memo
// wants.
export default memo(CptSbtDepthPanels)
