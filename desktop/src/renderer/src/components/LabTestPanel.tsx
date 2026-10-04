import { useEffect } from 'react'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import {
  CartesianGrid,
  Label,
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import type {
  GrainSizeResponse,
  LabSeriesTestSummary,
  SampleResponse,
  ScalarLabTestResponse,
} from '../api/client'
import { isTypingTarget } from '../utils/keyboard'
import {
  astmDescription,
  isAstmClassification,
  labelForParameter,
  labelForParameterGroup,
} from '../utils/labTestLabels'
import { useT } from '../i18n/translate'
import LabSeriesSection from './labSeries/LabSeriesSection'

// PR 4d — slide-in lab-test detail panel.
//
// Opens when the user clicks a sample marker in the borelog's samples track.
// Shows the sample header + one sub-section per lab-test family the sample
// has data for. Empty families render nothing so the panel stays compact.
//
// Layout: HTML / Tailwind only. The grain-size cumulative curve uses
// Recharts (already a dependency for CptChart); other tests render as plain
// HTML tables.
//
// Owner ruling 2026-10-04 (option a): "one place for all lab data of a
// sample". Below the DOV results sits the "Raw tests" block: the sample's raw
// oedometer / triaxial tests, each expanding to the readings viewer, each
// with the delete verb. The borehole log fetches those tests once per
// borehole and hands this panel the sample's share.

interface Props {
  sample: SampleResponse
  // Full sample list from the parent borehole — needed for the
  // prev / next nav and the "all samples" picker. Sorted by depth in
  // BoreholeLog before being passed in.
  allSamples: SampleResponse[]
  onSelectSample: (id: string) => void
  onClose: () => void
  /** Active project: needed to open or delete a raw test. Without it the raw block is not shown. */
  projectId?: string
  /** This sample's raw lab tests (oedometer / triaxial), grouped by the borehole log. */
  labSeries?: readonly LabSeriesTestSummary[]
  /** Fired after a raw test of this sample was deleted. */
  onLabTestDeleted?: (deleted: LabSeriesTestSummary) => void
}

export default function LabTestPanel({
  sample,
  allSamples,
  onSelectSample,
  onClose,
  projectId,
  labSeries = [],
  onLabTestDeleted,
}: Props): React.ReactElement {
  const t = useT()
  const hasGrain = sample.grain_sizes.length > 0
  const hasAtterberg = sample.atterberg_limits_tests.length > 0
  const hasCaCO3 = sample.caco3_content_tests.length > 0
  const hasOrganic = sample.organic_content_tests.length > 0
  const hasWater = sample.water_content_tests.length > 0
  const hasScalar = sample.scalar_lab_tests.length > 0
  const hasRaw = projectId !== undefined && labSeries.length > 0
  const hasAny = hasGrain || hasAtterberg || hasCaCO3 || hasOrganic || hasWater || hasScalar || hasRaw

  // Prev / next navigation through the sibling samples.
  const currentIndex = allSamples.findIndex(s => s.id === sample.id)
  const prevSample = currentIndex > 0 ? allSamples[currentIndex - 1] : null
  const nextSample =
    currentIndex >= 0 && currentIndex < allSamples.length - 1
      ? allSamples[currentIndex + 1]
      : null

  // Global keyboard shortcuts active while the lab pane is mounted:
  //   Esc      → close panel        (HIG: Esc dismisses transient UI)
  //   ← / →    → prev / next sample (Apple-style spatial navigation)
  // Skipped when an input / textarea / contentEditable owns focus so
  // typing in a text field doesn't inadvertently nav. Listener is
  // attached to ``document`` because the panel doesn't own focus.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if (isTypingTarget(e.target)) return
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      } else if (e.key === 'ArrowLeft' && prevSample) {
        e.preventDefault()
        onSelectSample(prevSample.id)
      } else if (e.key === 'ArrowRight' && nextSample) {
        e.preventDefault()
        onSelectSample(nextSample.id)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose, onSelectSample, prevSample?.id, nextSample?.id])

  return (
    <aside
      className="w-[420px] shrink-0 h-full bg-white border-l border-gray-200 shadow-lg flex flex-col"
      data-testid={`sample-inspector-${sample.id}`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2 px-4 py-3 border-b border-gray-200 bg-gray-50">
        <div className="flex-1 min-w-0">
          <div className="text-[10px] uppercase tracking-wide text-gray-400 flex items-center gap-1">
            <span>{t('lab.sample')}</span>
            {allSamples.length > 1 && (
              <span className="text-gray-400 normal-case">
                ({currentIndex + 1} / {allSamples.length})
              </span>
            )}
          </div>
          <div className="text-sm font-semibold text-gray-800 truncate">
            {sample.sample_number ?? t('lab.unnumbered')}
            <span className="text-gray-400 font-normal ml-2">
              {sample.depth_top_m === sample.depth_base_m
                ? `${sample.depth_top_m.toFixed(2)} m`
                : `${sample.depth_top_m.toFixed(2)} – ${sample.depth_base_m.toFixed(2)} m`}
            </span>
          </div>
          <div className="text-[11px] text-gray-500 mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
            {sample.sample_type && <span>{sample.sample_type}</span>}
            {sample.composition && <span>{sample.composition}</span>}
            {sample.instrument && <span>{sample.instrument}</span>}
            {sample.sampling_date && <span>{sample.sampling_date}</span>}
          </div>
        </div>
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => prevSample && onSelectSample(prevSample.id)}
            disabled={!prevSample}
            title={
              prevSample
                ? t('lab.previousSample', { name: prevSample.sample_number ?? t('lab.unnumbered') })
                : t('lab.noPreviousSample')
            }
            className="p-1 rounded text-gray-500 hover:text-gray-800 hover:bg-gray-200 disabled:text-gray-300 disabled:cursor-not-allowed disabled:hover:bg-transparent"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            onClick={() => nextSample && onSelectSample(nextSample.id)}
            disabled={!nextSample}
            title={
              nextSample
                ? t('lab.nextSample', { name: nextSample.sample_number ?? t('lab.unnumbered') })
                : t('lab.noNextSample')
            }
            className="p-1 rounded text-gray-500 hover:text-gray-800 hover:bg-gray-200 disabled:text-gray-300 disabled:cursor-not-allowed disabled:hover:bg-transparent"
          >
            <ChevronRight size={16} />
          </button>
          <button
            onClick={onClose}
            title={t('common.close')}
            className="ml-1 text-gray-400 hover:text-gray-700 transition-colors p-1"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Body — scrollable. Per user request: ALL non-grain-size tests
          (Atterberg, CaCO3, organic, water, scalar catch-all) merge under
          one "Identification tests" header — translation of Dutch
          "Onderkenningsproeven" — instead of a parallel section per
          family. Grain size keeps its own section because of the chart
          visualisation. The typed family records get virtually
          flattened into ScalarLabTestResponse-shape rows and rendered
          alongside the actual scalar tests grouped by parametergroep. */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {!hasAny && (
          <div
            className="text-xs text-gray-400 italic text-center py-8"
            data-testid="lab-test-empty-state"
          >
            {t('lab.noTestsForSample')}
          </div>
        )}
        {hasGrain && <GrainSizeSection grainSizes={sample.grain_sizes} />}
        {(hasAtterberg || hasCaCO3 || hasOrganic || hasWater || hasScalar) && (
          <ScalarTestsSection
            title={t('lab.identificationTests')}
            tests={collectIdentificationTests(sample)}
          />
        )}
        {hasRaw && projectId !== undefined && (
          <LabSeriesSection
            projectId={projectId}
            tests={labSeries}
            onLabTestDeleted={onLabTestDeleted}
          />
        )}
      </div>
    </aside>
  )
}

// ---------------------------------------------------------------------------
// Sub-sections — one per lab-test family
// ---------------------------------------------------------------------------

function SectionTitle({ title, subtitle }: { title: string; subtitle?: string | null }): React.ReactElement {
  return (
    <div>
      <div className="text-[11px] font-semibold text-gray-700 uppercase tracking-wide">{title}</div>
      {subtitle && <div className="text-[10px] text-gray-400 mt-0.5">{subtitle}</div>}
    </div>
  )
}

// Soil-fraction zone boundaries per ISO 14688-1 (used internationally + in
// the user's reference plot). Boundaries are in mm:
//   clay   <  0.002
//   silt   0.002 – 0.063
//   sand   0.063 – 2.0
//   gravel 2.0 – 63
//   cobbles >= 63
// Used for the coloured background bands of the cumulative-curve chart.
const GRAIN_FRACTIONS: { from: number; to: number; label: string; fill: string }[] = [
  { from: 0.0001, to: 0.002, label: 'Clay', fill: '#f3f4f6' },
  { from: 0.002, to: 0.063, label: 'Silt', fill: '#e7eaef' },
  { from: 0.063, to: 2.0, label: 'Sand', fill: '#f3f4f6' },
  { from: 2.0, to: 63.0, label: 'Gravel', fill: '#e7eaef' },
  { from: 63.0, to: 200.0, label: 'Cobbles', fill: '#f3f4f6' },
]

const GRAIN_X_DOMAIN: [number, number] = [0.0001, 200] // mm, log scale

// Curve colours — one per grain-size record so multiple methods on the
// same sample (sieve + hydrometer + laser) read as distinct lines on
// the combined chart.
const GRAIN_CURVE_COLORS = ['#1f5077', '#b45309', '#16a34a', '#9333ea', '#dc2626']

interface GrainSizeChartPoint {
  diameter: number
  // One field per record so Recharts can plot N curves simultaneously.
  // The field names are dynamic (`series_0`, `series_1`, …); see
  // ``buildCombinedSeries`` below.
  [key: string]: number | undefined
}

function GrainSizeSection({
  grainSizes,
}: {
  grainSizes: GrainSizeResponse[]
}): React.ReactElement {
  const t = useT()
  // Combine all records into a single Recharts dataset where each row
  // carries one ``diameter`` x-value and N ``series_i`` y-values. NaN
  // is used for "no point" so Recharts skips the segment between
  // missing points instead of dragging a line across the gap (each
  // method covers a different diameter range — sieve hits gravel /
  // sand, hydrometer hits silt / clay; we don't want a fake straight
  // line bridging them).
  const series = grainSizes.map((gs, i) => ({
    record: gs,
    color: GRAIN_CURVE_COLORS[i % GRAIN_CURVE_COLORS.length],
    label: gs.method ?? t('lab.methodN', { n: i + 1 }),
    key: `series_${i}` as const,
  }))
  const data = buildCombinedSeries(grainSizes)

  // Treatments collected across all records (deduped); one set of pills
  // describes the chemistry pre-treatment regardless of method.
  const treatments = new Set<string>()
  for (const gs of grainSizes) {
    if (gs.lime_removed) treatments.add(t('lab.limeRemoved'))
    if (gs.organics_removed) treatments.add(t('lab.organicsRemoved'))
  }

  return (
    <section data-testid="lab-test-grain-size">
      <SectionTitle
        title={t('lab.grainSize')}
        subtitle={
          grainSizes.length > 1
            ? t('lab.methodsCombined', { n: grainSizes.length })
            : grainSizes[0]?.test_date || null
        }
      />
      {treatments.size > 0 && (
        <div className="flex gap-1.5 mt-1">
          {[...treatments].map(t => (
            <span key={t} className="text-[9px] bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded">
              {t}
            </span>
          ))}
        </div>
      )}
      {data.length === 0 ? (
        <div className="text-[11px] text-gray-400 italic mt-2">{t('lab.curveNotRecorded')}</div>
      ) : (
        <>
          <div className="mt-2 h-52">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 18, right: 8, bottom: 24, left: 4 }}>
                {/* Soil-fraction zone backgrounds (ISO 14688-1). */}
                {GRAIN_FRACTIONS.map(z => (
                  <ReferenceArea
                    key={z.label}
                    x1={z.from}
                    x2={z.to}
                    fill={z.fill}
                    fillOpacity={0.6}
                    ifOverflow="visible"
                    stroke="none"
                  >
                    <Label value={z.label} position="insideTop" fontSize={9} fill="#6b7280" />
                  </ReferenceArea>
                ))}
                <CartesianGrid stroke="#cbd5e1" strokeDasharray="2 2" />
                <XAxis
                  dataKey="diameter"
                  scale="log"
                  domain={GRAIN_X_DOMAIN}
                  type="number"
                  allowDataOverflow
                  // X-axis flipped per user preference: gravel / cobbles
                  // on the LEFT, fines on the RIGHT.
                  reversed
                  tick={{ fontSize: 9, fill: '#6b7280' }}
                  ticks={[0.001, 0.01, 0.1, 1, 10, 100]}
                  tickFormatter={(v: number) =>
                    v >= 1 ? v.toString() : v.toString().replace(/0+$/, '')
                  }
                  label={{
                    value: t('lab.diameterAxis'),
                    position: 'insideBottom',
                    offset: -10,
                    fontSize: 10,
                    fill: '#6b7280',
                  }}
                />
                <YAxis
                  domain={[0, 100]}
                  tick={{ fontSize: 9, fill: '#6b7280' }}
                  label={{
                    value: t('lab.pctFiner'),
                    angle: -90,
                    position: 'insideLeft',
                    offset: 12,
                    fontSize: 10,
                    fill: '#6b7280',
                  }}
                />
                <Tooltip
                  contentStyle={{ fontSize: 10, padding: '4px 8px' }}
                  formatter={(value: number, key: string) => {
                    const s = series.find(ser => ser.key === key)
                    return [`${value.toFixed(1)} %`, s?.label ?? t('lab.pctFiner')]
                  }}
                  labelFormatter={(v: number) => `${v.toFixed(3)} mm`}
                />
                {series.map(s => (
                  <Line
                    key={s.key}
                    type="monotone"
                    dataKey={s.key}
                    stroke={s.color}
                    strokeWidth={1.6}
                    dot={{ r: 2, fill: s.color }}
                    isAnimationActive={false}
                    connectNulls={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
          {/* Method legend — colour swatch + DOV method name + test date. */}
          <div className="mt-1 space-y-0.5 text-[10px] text-gray-600">
            {series.map(s => (
              <div key={s.key} className="flex items-center gap-1.5">
                <span
                  className="inline-block w-3 h-0.5"
                  style={{ backgroundColor: s.color }}
                />
                <span className="flex-1 truncate">{s.label}</span>
                {s.record.test_date && (
                  <span className="text-gray-400">{s.record.test_date}</span>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  )
}

function buildCombinedSeries(grainSizes: GrainSizeResponse[]): GrainSizeChartPoint[] {
  // Collect every unique diameter across all records, then for each
  // diameter emit one row carrying the % finer for whichever record(s)
  // actually measured at that point. ``NaN`` (encoded as ``undefined``
  // in this dict shape) signals "no measurement" to Recharts.
  const points = new Map<number, GrainSizeChartPoint>()
  grainSizes.forEach((gs, i) => {
    const key = `series_${i}` as const
    const n = Math.min(gs.diameters_mm.length, gs.pct_larger.length)
    for (let j = 0; j < n; j += 1) {
      const d = gs.diameters_mm[j]
      const pctFiner = 100 - gs.pct_larger[j]
      const existing = points.get(d) ?? { diameter: d }
      existing[key] = pctFiner
      points.set(d, existing)
    }
  })
  return [...points.values()].sort((a, b) => a.diameter - b.diameter)
}

// Removed: per-family `AtterbergSection`, `CaCO3Section`, `OrganicSection`,
// `WaterSection` — all five non-grain-size families now flatten into the
// single ``ScalarTestsSection`` rendered with title="Identification tests"
// (translation of Dutch "Onderkenningsproeven"). See
// ``collectIdentificationTests`` for the synthesis.

function ScalarTestsSection({
  tests,
  title = 'Other lab tests',
}: {
  tests: ScalarLabTestResponse[]
  // Configurable so the panel can pass "Identification tests" when the
  // typed families and scalar catch-all are all flattened into one
  // unified view.
  title?: string
}): React.ReactElement {
  // Group rows by ``parameter_group`` so related tests cluster together
  // (e.g. grain density + water content under "Density & water content"
  // when both are present). Within each group, one row per test with
  // value + unit + method / date metadata.
  const groups = new Map<string, ScalarLabTestResponse[]>()
  for (const t of tests) {
    const list = groups.get(t.parameter_group) ?? []
    list.push(t)
    groups.set(t.parameter_group, list)
  }

  return (
    <section data-testid="lab-test-identification">
      <SectionTitle
        title={title}
        subtitle={`${tests.length} test${tests.length === 1 ? '' : 's'}`}
      />
      <div className="space-y-3 mt-2">
        {[...groups.entries()].map(([group, rows]) => (
          <div key={group}>
            <div
              className="text-[10px] uppercase tracking-wide text-gray-400 mb-1"
              title={group}
            >
              {labelForParameterGroup(group)}
            </div>
            <table className="w-full text-[11px] border-collapse">
              <tbody>
                {rows.map(t => (
                  <ScalarRow key={t.id} test={t} />
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </section>
  )
}

function ScalarRow({ test }: { test: ScalarLabTestResponse }): React.ReactElement {
  const value = formatScalarValue(test)
  const meta = [test.method, test.test_date].filter(Boolean).join(' · ')
  const label = labelForParameter(test.parameter)
  // ASTM codes (CL, SW, MH, ...) are categorical, not numeric — surface
  // the human-readable description below the code so non-geologists can
  // read the row without a USCS chart in hand.
  const astmDesc =
    isAstmClassification(test.parameter) && test.value_text
      ? astmDescription(test.value_text)
      : null
  return (
    <tr className="border-t border-gray-100">
      <td className="py-1 align-top" title={test.parameter}>
        <div className="text-gray-700">{label}</div>
        {meta && <div className="text-[10px] text-gray-400">{meta}</div>}
      </td>
      <td className="py-1 text-right align-top font-mono text-gray-800 whitespace-nowrap pl-3">
        <div>{value}</div>
        {astmDesc && (
          <div className="text-[10px] text-gray-500 font-sans whitespace-normal mt-0.5">
            {astmDesc}
          </div>
        )}
      </td>
    </tr>
  )
}

function formatScalarValue(t: ScalarLabTestResponse): string {
  if (t.value_numeric != null) {
    const unit = t.unit && t.unit !== '-' ? ` ${t.unit}` : ''
    return `${t.value_numeric}${unit}`
  }
  if (t.value_text) return t.value_text
  if (t.detection_condition) return t.detection_condition
  return '—'
}

// ---------------------------------------------------------------------------
// Tiny helpers
// ---------------------------------------------------------------------------


/**
 * Flatten every non-grain-size lab test family into a single
 * ``ScalarLabTestResponse``-shaped list so they can all render in one
 * "Identification tests" section. Atterberg explodes to LL + PL +
 * computed PI rows; CaCO3 / organic / water typed families become one
 * row each; scalar catch-all rows pass through unchanged.
 *
 * The synthetic IDs (``${realId}-LL`` etc.) are stable and unique
 * across the merged list — Atterberg LL and PL share a parent record
 * but get distinct synthetic suffixes so React's key prop stays sane.
 */
function collectIdentificationTests(
  sample: SampleResponse,
): ScalarLabTestResponse[] {
  const rows: ScalarLabTestResponse[] = []

  // Atterberg → up to 3 rows per parent record (LL, PL, PI/non-plastic).
  for (const att of sample.atterberg_limits_tests) {
    if (att.liquid_limit_pct != null) {
      rows.push({
        id: `${att.id}-LL`,
        parameter_group: 'Onderkenning - proeven',
        parameter: 'Consistentiegrenzen - Vloeigrens (Consistentiegrenzen - Vloeigrens)',
        value_numeric: att.liquid_limit_pct,
        value_text: null,
        unit: '%',
        method: att.method,
        test_date: att.test_date,
        detection_condition: null,
      })
    }
    if (att.plastic_limit_pct != null) {
      rows.push({
        id: `${att.id}-PL`,
        parameter_group: 'Onderkenning - proeven',
        parameter:
          'Consistentiegrenzen - Uitrolgrens (Consistentiegrenzen - Uitrolgrens)',
        value_numeric: att.plastic_limit_pct,
        value_text: null,
        unit: '%',
        method: att.method,
        test_date: att.test_date,
        detection_condition: null,
      })
    }
    const pi =
      att.liquid_limit_pct != null && att.plastic_limit_pct != null
        ? att.liquid_limit_pct - att.plastic_limit_pct
        : null
    if (pi != null) {
      rows.push({
        id: `${att.id}-PI`,
        parameter_group: 'Onderkenning - proeven',
        parameter: 'Plasticity index (computed)',
        value_numeric: pi,
        value_text: null,
        unit: '%',
        method: 'computed (LL − PL)',
        test_date: att.test_date,
        detection_condition: null,
      })
    } else if (att.non_plastic) {
      rows.push({
        id: `${att.id}-NP`,
        parameter_group: 'Onderkenning - proeven',
        parameter: 'Plasticity index',
        value_numeric: null,
        value_text: 'Non-plastic',
        unit: null,
        method: att.method,
        test_date: att.test_date,
        detection_condition: 'NM',
      })
    }
  }

  // Typed CaCO3 / organic / water families — straight 1:1 mapping.
  for (const c of sample.caco3_content_tests) {
    rows.push({
      id: c.id,
      parameter_group: 'Bodem_chemisch',
      parameter: 'Calciumcarbonaatgehalte (caco3_gehalte)',
      value_numeric: c.content_pct,
      value_text: null,
      unit: '%',
      method: c.method,
      test_date: c.test_date,
      detection_condition: null,
    })
  }
  for (const o of sample.organic_content_tests) {
    if (o.carbon_pct != null) {
      rows.push({
        id: `${o.id}-OC`,
        parameter_group: 'Bodem_chemisch',
        parameter: 'Organische C - percentage (organische_c_perc)',
        value_numeric: o.carbon_pct,
        value_text: null,
        unit: '%',
        method: o.method,
        test_date: o.test_date,
        detection_condition: null,
      })
    }
    if (o.matter_pct != null) {
      rows.push({
        id: `${o.id}-OM`,
        parameter_group: 'Bodem_chemisch',
        parameter: 'Organic matter content',
        value_numeric: o.matter_pct,
        value_text: null,
        unit: '%',
        method: o.method,
        test_date: o.test_date,
        detection_condition: null,
      })
    }
  }
  for (const w of sample.water_content_tests) {
    rows.push({
      id: w.id,
      parameter_group: 'Bodem_fysisch_vocht',
      parameter: 'Vochtgehalte luchtdroge grond (vocht_luchtdroge_grond)',
      value_numeric: w.content_pct,
      value_text: null,
      unit: '%',
      method: w.method,
      test_date: w.test_date,
      detection_condition: null,
    })
  }

  // Scalar catch-all — already in the right shape.
  rows.push(...sample.scalar_lab_tests)

  return rows
}
