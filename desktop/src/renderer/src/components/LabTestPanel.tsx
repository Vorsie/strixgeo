import { X } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'

import type {
  AtterbergLimitsResponse,
  CaCO3ContentResponse,
  GrainSizeResponse,
  OrganicContentResponse,
  SampleResponse,
  WaterContentResponse,
} from '../api/client'

// PR 4d — slide-in lab-test detail panel.
//
// Opens when the user clicks a sample marker in the borelog's samples track.
// Shows the sample header + one sub-section per lab-test family the sample
// has data for. Empty families render nothing so the panel stays compact.
//
// Layout: HTML / Tailwind only. The grain-size cumulative curve uses
// Recharts (already a dependency for CptChart); other tests render as plain
// HTML tables.

interface Props {
  sample: SampleResponse
  onClose: () => void
}

export default function LabTestPanel({ sample, onClose }: Props): React.ReactElement {
  const hasGrain = sample.grain_sizes.length > 0
  const hasAtterberg = sample.atterberg_limits_tests.length > 0
  const hasCaCO3 = sample.caco3_content_tests.length > 0
  const hasOrganic = sample.organic_content_tests.length > 0
  const hasWater = sample.water_content_tests.length > 0
  const hasAny = hasGrain || hasAtterberg || hasCaCO3 || hasOrganic || hasWater

  return (
    <aside className="absolute top-0 right-0 bottom-0 w-[420px] bg-white border-l border-gray-200 shadow-xl flex flex-col z-30">
      {/* Header */}
      <div className="flex items-start justify-between gap-2 px-4 py-3 border-b border-gray-200 bg-gray-50">
        <div className="flex-1 min-w-0">
          <div className="text-[10px] uppercase tracking-wide text-gray-400">Sample</div>
          <div className="text-sm font-semibold text-gray-800 truncate">
            {sample.sample_number ?? '(unnumbered)'}
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
        <button
          onClick={onClose}
          title="Close"
          className="text-gray-400 hover:text-gray-700 transition-colors p-1 -mr-1"
        >
          <X size={16} />
        </button>
      </div>

      {/* Body — scrollable */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {!hasAny && (
          <div className="text-xs text-gray-400 italic text-center py-8">
            No lab tests recorded for this sample.
          </div>
        )}
        {hasGrain &&
          sample.grain_sizes.map((gs, i) => (
            <GrainSizeSection key={gs.id} gs={gs} index={i} total={sample.grain_sizes.length} />
          ))}
        {hasAtterberg &&
          sample.atterberg_limits_tests.map(att => (
            <AtterbergSection key={att.id} att={att} />
          ))}
        {hasCaCO3 &&
          sample.caco3_content_tests.map(c => <CaCO3Section key={c.id} caco3={c} />)}
        {hasOrganic &&
          sample.organic_content_tests.map(o => <OrganicSection key={o.id} organic={o} />)}
        {hasWater &&
          sample.water_content_tests.map(w => <WaterSection key={w.id} water={w} />)}
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

function GrainSizeSection({
  gs,
  index,
  total,
}: {
  gs: GrainSizeResponse
  index: number
  total: number
}): React.ReactElement {
  // Recharts data: pair diameters with pct_larger by index. The arrays
  // SHOULD be the same length (parser guarantees this) but we defensively
  // truncate to the shorter one if not.
  const n = Math.min(gs.diameters_mm.length, gs.pct_larger.length)
  const data = Array.from({ length: n }, (_, i) => ({
    diameter: gs.diameters_mm[i],
    pct: gs.pct_larger[i],
  }))

  // Treatments shown as small pills underneath the title.
  const treatments: string[] = []
  if (gs.lime_removed) treatments.push('lime removed')
  if (gs.organics_removed) treatments.push('organics removed')

  return (
    <section>
      <SectionTitle
        title={total > 1 ? `Grain size (${index + 1}/${total})` : 'Grain size'}
        subtitle={[gs.method, gs.test_date].filter(Boolean).join(' · ') || null}
      />
      {treatments.length > 0 && (
        <div className="flex gap-1.5 mt-1">
          {treatments.map(t => (
            <span key={t} className="text-[9px] bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded">
              {t}
            </span>
          ))}
        </div>
      )}
      {data.length === 0 ? (
        <div className="text-[11px] text-gray-400 italic mt-2">Curve not recorded.</div>
      ) : (
        <div className="mt-2 h-44">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 12, bottom: 24, left: 4 }}>
              <CartesianGrid stroke="#e5e7eb" strokeDasharray="2 2" />
              <XAxis
                dataKey="diameter"
                scale="log"
                domain={['auto', 'auto']}
                type="number"
                tick={{ fontSize: 9, fill: '#6b7280' }}
                label={{
                  value: 'Diameter (mm)',
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
                  value: '% larger',
                  angle: -90,
                  position: 'insideLeft',
                  offset: 12,
                  fontSize: 10,
                  fill: '#6b7280',
                }}
              />
              <Tooltip
                contentStyle={{ fontSize: 10, padding: '4px 8px' }}
                formatter={(value: number, name: string) => [
                  name === 'pct' ? `${value.toFixed(1)} %` : `${value.toFixed(3)} mm`,
                  name === 'pct' ? '% larger' : 'Diameter',
                ]}
              />
              <Line
                type="monotone"
                dataKey="pct"
                stroke="#1f5077"
                strokeWidth={1.5}
                dot={{ r: 2 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  )
}

function AtterbergSection({ att }: { att: AtterbergLimitsResponse }): React.ReactElement {
  // PI is derived on read: LL - PL. None when either is null OR when
  // non_plastic is true (the soil cannot be rolled into a 3 mm thread).
  const pi =
    att.non_plastic === true
      ? null
      : att.liquid_limit_pct != null && att.plastic_limit_pct != null
        ? att.liquid_limit_pct - att.plastic_limit_pct
        : null

  return (
    <section>
      <SectionTitle
        title="Atterberg limits"
        subtitle={[att.method, att.test_date].filter(Boolean).join(' · ') || null}
      />
      <table className="w-full mt-2 text-[11px] border-collapse">
        <tbody>
          <Row label="Liquid limit (LL)" value={fmtPct(att.liquid_limit_pct)} />
          <Row label="Plastic limit (PL)" value={fmtPct(att.plastic_limit_pct)} />
          <Row label="Plasticity index (PI)" value={fmtPct(pi)} muted={pi == null} />
          {att.non_plastic === true && (
            <tr>
              <td colSpan={2} className="pt-1.5 text-[10px] text-amber-700 italic">
                Soil cannot be rolled into a 3 mm thread (non-plastic).
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  )
}

function CaCO3Section({ caco3 }: { caco3: CaCO3ContentResponse }): React.ReactElement {
  return (
    <section>
      <SectionTitle
        title="Calcium carbonate (CaCO₃)"
        subtitle={[caco3.method, caco3.test_date].filter(Boolean).join(' · ') || null}
      />
      <table className="w-full mt-2 text-[11px] border-collapse">
        <tbody>
          <Row label="Content" value={fmtPct(caco3.content_pct)} />
        </tbody>
      </table>
    </section>
  )
}

function OrganicSection({ organic }: { organic: OrganicContentResponse }): React.ReactElement {
  return (
    <section>
      <SectionTitle
        title="Organic content"
        subtitle={[organic.method, organic.test_date].filter(Boolean).join(' · ') || null}
      />
      <table className="w-full mt-2 text-[11px] border-collapse">
        <tbody>
          <Row label="Organic carbon (OC)" value={fmtPct(organic.carbon_pct)} />
          <Row label="Organic matter (OM)" value={fmtPct(organic.matter_pct)} />
        </tbody>
      </table>
      {organic.carbon_pct != null && organic.matter_pct == null && (
        <div className="text-[10px] text-gray-400 italic mt-1">
          DOV reports OC only. OM (Van Bemmelen ≈ 1.724 × OC) is not stored — the
          conversion is empirical and soil-type-dependent.
        </div>
      )}
    </section>
  )
}

function WaterSection({ water }: { water: WaterContentResponse }): React.ReactElement {
  return (
    <section>
      <SectionTitle
        title="Water content"
        subtitle={[water.method, water.test_date].filter(Boolean).join(' · ') || null}
      />
      <table className="w-full mt-2 text-[11px] border-collapse">
        <tbody>
          <Row label="Water content (w)" value={fmtPct(water.content_pct)} />
        </tbody>
      </table>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Tiny helpers
// ---------------------------------------------------------------------------

function Row({
  label,
  value,
  muted,
}: {
  label: string
  value: string
  muted?: boolean
}): React.ReactElement {
  return (
    <tr className="border-t border-gray-100">
      <td className="py-1 text-gray-500">{label}</td>
      <td
        className={['py-1 text-right font-mono', muted ? 'text-gray-300' : 'text-gray-800'].join(
          ' ',
        )}
      >
        {value}
      </td>
    </tr>
  )
}

function fmtPct(v: number | null | undefined): string {
  if (v == null) return '—'
  return `${v.toFixed(2)} %`
}
