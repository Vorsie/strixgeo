import type {
  BoreholeDetailResponse,
  ObservationLayerResponse,
  ObservationResponse,
} from '../api/client'
import { soilStyle } from '../utils/soilColors'

// PR 4a — first-iteration borelog. Header strip + mTAW axis + ONE
// observation track (preferring `coded_lithology`) with solid soil-code
// fills, plus a dynamic legend below.
//
// Subsequent PRs add: SVG hatching patterns (4b), additional observation
// tracks side-by-side mirroring the DOV PDF report (4b), drill-method +
// field-log + sample tracks (4c), click-to-detail lab-test panel (4d).

const DEFAULT_PX_PER_M = 60 // pixels per metre of depth at default zoom
const TRACK_WIDTH = 180 // px — wide enough for "fine sand + admixtures" labels
const M_TAW_AXIS_WIDTH = 64 // px — left axis column
const HEADER_HEIGHT = 56 // px — diagonal track headers
const PAD = 16

interface Props {
  borehole: BoreholeDetailResponse
}

export default function BoreholeLog({ borehole }: Props): React.ReactElement {
  // Prefer the most-informative stream as the single track for PR 4a.
  // Order: coded_lithology (driller's primary record) → geotechnical_coding
  // (engineer's re-interpretation) → first available stream.
  const track =
    borehole.observations.find(o => o.observation_type === 'coded_lithology') ??
    borehole.observations.find(o => o.observation_type === 'geotechnical_coding') ??
    borehole.observations[0] ??
    null

  // Total depth: prefer the header value; fall back to deepest layer in the
  // chosen track; final fallback is 10 m so the canvas isn't zero-height.
  const layersBottom = track ? Math.max(...track.layers.map(l => l.base_m), 0) : 0
  const totalDepth = borehole.total_depth_m ?? layersBottom ?? 10

  const pxPerMetre = DEFAULT_PX_PER_M
  const trackHeight = totalDepth * pxPerMetre

  return (
    <div className="flex flex-col h-full overflow-auto bg-white">
      {/* Header strip — id, location, depth, date, executor, water table */}
      <BoreholeHeader borehole={borehole} />

      {/* Borelog canvas — mTAW axis (when known) + the chosen observation track */}
      <div className="flex p-4 gap-1 items-start">
        {borehole.elevation_m != null ? (
          <MTawAxis
            surfaceElevation={borehole.elevation_m}
            totalDepth={totalDepth}
            pxPerMetre={pxPerMetre}
            headerHeight={HEADER_HEIGHT}
          />
        ) : (
          <NoElevationBadge totalDepth={totalDepth} pxPerMetre={pxPerMetre} />
        )}

        {track ? (
          <ObservationTrack
            track={track}
            trackHeight={trackHeight}
            pxPerMetre={pxPerMetre}
            headerHeight={HEADER_HEIGHT}
          />
        ) : (
          <div className="text-xs text-gray-400 italic px-4 py-2">
            This borehole has no observations to display yet.
          </div>
        )}
      </div>

      {/* Legend — only the soil tokens actually used in the track */}
      {track && <SoilLegend track={track} />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Header strip
// ---------------------------------------------------------------------------

function BoreholeHeader({ borehole }: { borehole: BoreholeDetailResponse }): React.ReactElement {
  return (
    <div
      className="flex flex-wrap gap-x-6 gap-y-1 px-4 py-2 border-b border-gray-200 bg-gray-50 text-[11px]"
      style={{ minHeight: 56 }}
    >
      <Field label="Boring" value={borehole.name} bold />
      <Field
        label="X / Y"
        value={
          borehole.epsg
            ? `${borehole.location_x.toFixed(1)} / ${borehole.location_y.toFixed(1)} (EPSG:${borehole.epsg})`
            : `${borehole.location_x.toFixed(1)} / ${borehole.location_y.toFixed(1)}`
        }
      />
      <Field
        label="Z (mTAW)"
        value={borehole.elevation_m != null ? borehole.elevation_m.toFixed(2) : '— missing —'}
        warn={borehole.elevation_m == null}
      />
      <Field
        label="Depth"
        value={borehole.total_depth_m != null ? `0 – ${borehole.total_depth_m.toFixed(2)} m` : '—'}
      />
      <Field label="Date" value={borehole.start_date ?? '—'} />
      <Field label="Executor" value={borehole.executor ?? '—'} />
      {borehole.water_table_depth_m != null && (
        <Field label="Water at" value={`${borehole.water_table_depth_m.toFixed(2)} m`} />
      )}
      {borehole.drill_method && <Field label="Method" value={borehole.drill_method} />}
    </div>
  )
}

function Field({
  label,
  value,
  bold,
  warn,
}: {
  label: string
  value: string
  bold?: boolean
  warn?: boolean
}): React.ReactElement {
  return (
    <div className="flex flex-col leading-tight">
      <span className="text-[9px] uppercase tracking-wide text-gray-400">{label}</span>
      <span
        className={[
          'text-gray-700',
          bold ? 'font-semibold' : '',
          warn ? 'text-amber-600 italic' : '',
        ].join(' ')}
      >
        {value}
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// mTAW axis (left column)
// ---------------------------------------------------------------------------

function MTawAxis({
  surfaceElevation,
  totalDepth,
  pxPerMetre,
  headerHeight,
}: {
  surfaceElevation: number
  totalDepth: number
  pxPerMetre: number
  headerHeight: number
}): React.ReactElement {
  const bottomElevation = surfaceElevation - totalDepth
  const ticks: number[] = []
  // Surface elevation explicitly + every whole-metre level down to the bottom.
  ticks.push(surfaceElevation)
  for (let lvl = Math.floor(surfaceElevation); lvl > bottomElevation; lvl -= 1) {
    if (lvl < surfaceElevation) ticks.push(lvl)
  }
  ticks.push(bottomElevation)

  const totalHeight = totalDepth * pxPerMetre

  return (
    <div
      className="relative shrink-0 text-[10px] text-gray-500 font-mono"
      style={{ width: M_TAW_AXIS_WIDTH }}
    >
      <div
        className="text-[9px] uppercase tracking-wide text-gray-400 text-right pr-1"
        style={{ height: headerHeight, paddingTop: headerHeight - 14 }}
      >
        mTAW
      </div>
      <div className="relative" style={{ height: totalHeight }}>
        {/* Vertical guide line */}
        <div className="absolute right-0 top-0 bottom-0 w-px bg-gray-300" />
        {ticks.map((lvl, i) => {
          const depth = surfaceElevation - lvl
          const y = depth * pxPerMetre
          return (
            <div
              key={`${lvl}-${i}`}
              className="absolute right-0 flex items-center gap-1 -translate-y-1/2"
              style={{ top: y }}
            >
              <span className="pr-1.5">{formatMtaw(lvl)}</span>
              <span className="block w-2 h-px bg-gray-400" />
            </div>
          )
        })}
      </div>
    </div>
  )
}

function formatMtaw(lvl: number): string {
  const sign = lvl >= 0 ? '+' : ''
  return `${sign}${lvl.toFixed(2)}`
}

function NoElevationBadge({
  totalDepth,
  pxPerMetre,
}: {
  totalDepth: number
  pxPerMetre: number
}): React.ReactElement {
  // When elevation_m is null the borelog still draws, just without the absolute-
  // level axis. The Phase 3a UX requirement (manual-Z-entry editor + yellow flag
  // in the sidebar) lands in a separate PR; here we only avoid crashing.
  return (
    <div
      className="shrink-0 flex flex-col items-end justify-end pr-2 text-[10px] text-amber-600 italic"
      style={{ width: M_TAW_AXIS_WIDTH, height: HEADER_HEIGHT + totalDepth * pxPerMetre }}
    >
      no Z
    </div>
  )
}

// ---------------------------------------------------------------------------
// Observation track — colored bars per layer + per-layer depth labels
// ---------------------------------------------------------------------------

function ObservationTrack({
  track,
  trackHeight,
  pxPerMetre,
  headerHeight,
}: {
  track: ObservationResponse
  trackHeight: number
  pxPerMetre: number
  headerHeight: number
}): React.ReactElement {
  const friendly = humanizeObservationType(track.observation_type)
  const sub =
    track.author && track.observation_date
      ? `${track.author} (${track.observation_date})`
      : (track.author ?? track.observation_date ?? '')

  return (
    <div className="shrink-0" style={{ width: TRACK_WIDTH }}>
      {/* Track header — title + author + date */}
      <div
        className="border-b border-gray-200 px-1 py-1 text-[10px] leading-tight"
        style={{ height: headerHeight }}
      >
        <div className="font-semibold text-gray-700 truncate">{friendly}</div>
        {sub && <div className="text-gray-400 truncate">{sub}</div>}
      </div>

      {/* Layer rectangles */}
      <div
        className="relative border-l border-r border-gray-300 bg-white"
        style={{ height: trackHeight }}
      >
        {track.layers.map(layer => (
          <LayerBlock
            key={layer.id}
            layer={layer}
            pxPerMetre={pxPerMetre}
            trackWidth={TRACK_WIDTH}
          />
        ))}
      </div>
    </div>
  )
}

function LayerBlock({
  layer,
  pxPerMetre,
  trackWidth,
}: {
  layer: ObservationLayerResponse
  pxPerMetre: number
  trackWidth: number
}): React.ReactElement {
  const top = layer.top_m * pxPerMetre
  const height = (layer.base_m - layer.top_m) * pxPerMetre
  // PR 4a uses the FIRST main-soil token to pick the fill colour. Layers with
  // multiple equally-dominant soils (DOV's <hoofdnaam> can repeat) get a label
  // listing all of them; we'll add a visual mix-pattern in PR 4b.
  const primary = layer.main_soil_codes[0] ?? null
  const style = soilStyle(primary)

  const adminxtureLabel =
    layer.admixtures.length > 0
      ? layer.admixtures
          .map(a => `${a.amount ? `${a.amount} ` : ''}${a.soil_code}${a.locally ? ' (loc.)' : ''}`)
          .join(', ')
      : null

  return (
    <div
      className="absolute left-0 right-0 border-b border-gray-200 px-1 overflow-hidden"
      style={{ top, height, backgroundColor: style.fill }}
      title={[
        `${layer.top_m.toFixed(2)} – ${layer.base_m.toFixed(2)} m`,
        layer.color ? `Colour: ${layer.color}` : null,
        layer.main_soil_codes.length > 0 ? `Main: ${layer.main_soil_codes.join(', ')}` : null,
        adminxtureLabel ? `Admixtures: ${adminxtureLabel}` : null,
        layer.description ? `Description: ${layer.description}` : null,
      ]
        .filter(Boolean)
        .join('\n')}
    >
      {/* Inline label, hidden when the layer is too thin to show text legibly */}
      {height >= 18 && (
        <div className="text-[10px] text-gray-900 font-medium truncate">
          {layer.main_soil_codes.length > 0
            ? layer.main_soil_codes.join(' + ')
            : (layer.description ?? '—')}
          {adminxtureLabel && (
            <span className="text-gray-700 font-normal"> · {adminxtureLabel}</span>
          )}
        </div>
      )}

      {/* Per-layer depth label on the right edge — DOV-style */}
      <div
        className="absolute right-0 top-0 -translate-y-1/2 text-[9px] font-mono text-gray-600 bg-white px-1 rounded-l"
        style={{ pointerEvents: 'none' }}
      >
        {layer.top_m.toFixed(2)}
      </div>
      {/* Bottom-edge label only on the deepest layer; DOV repeats the boundary
          on each layer but that produces visual noise — one per boundary is enough. */}
      <div
        className="absolute right-0 bottom-0 translate-y-1/2 text-[9px] font-mono text-gray-600 bg-white px-1 rounded-l"
        style={{ pointerEvents: 'none' }}
      >
        {layer.base_m.toFixed(2)}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Legend — only renders soil tokens that appear in the track
// ---------------------------------------------------------------------------

function SoilLegend({ track }: { track: ObservationResponse }): React.ReactElement {
  // Collect unique tokens across all layers (main + admixtures) so the legend
  // documents everything visually rendered, including admixture tokens.
  const codes = new Set<string>()
  for (const layer of track.layers) {
    layer.main_soil_codes.forEach(c => codes.add(c))
    layer.admixtures.forEach(a => codes.add(a.soil_code))
  }

  if (codes.size === 0) {
    return <div />
  }

  return (
    <div className="px-4 py-3 border-t border-gray-200 bg-gray-50">
      <div className="text-[10px] uppercase tracking-wide text-gray-400 mb-1">Lithology codes</div>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[11px] text-gray-700">
        {[...codes].sort().map(code => {
          const style = soilStyle(code)
          return (
            <div key={code} className="flex items-center gap-1.5">
              <span
                className="inline-block w-3.5 h-3.5 border border-gray-300 rounded-sm"
                style={{ backgroundColor: style.fill }}
              />
              <span className="font-mono text-gray-500">{code}</span>
              <span className="text-gray-700">{style.label}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function humanizeObservationType(t: string): string {
  // Convert the API's snake_case ObservationType.value into a friendly label.
  // The DOV PDF uses Dutch ("Gecodeerde lithologie"); we surface English in
  // the desktop UI. Translation to Dutch labels can be a presentation toggle
  // later.
  switch (t) {
    case 'coded_lithology':
      return 'Coded lithology'
    case 'geotechnical_coding':
      return 'Geotechnical coding'
    case 'lithological_description':
      return 'Lithological description'
    case 'informal_stratigraphy':
      return 'Informal stratigraphy'
    case 'formal_stratigraphy':
      return 'Formal stratigraphy'
    case 'quaternary_stratigraphy':
      return 'Quaternary stratigraphy'
    case 'hydrogeological_stratigraphy':
      return 'Hydrogeological stratigraphy'
    case 'informal_hydrogeological_stratigraphy':
      return 'Informal hydrogeological stratigraphy'
    default:
      return t
  }
}
