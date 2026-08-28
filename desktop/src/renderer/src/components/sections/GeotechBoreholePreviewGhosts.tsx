/**
 * Ghost packing bands over borehole columns that have not been divided yet.
 *
 * The gap this closes (owner dogfeed 2026-08-04): *"correlation bands aren't
 * plotted over boreholes so it is impossible to see how divide-all-boreholes
 * will act — what gets what packing — before you click the button."*
 * ``Subdivide all bodies`` materialises CPT bands only and defers every
 * borehole-mediated edge to ``Divide boreholes``, so until that verb is pressed
 * a borehole column on the geotech axis is simply blank. Pressing it is the
 * only way to find out what it does, and it rebuilds every borehole band while
 * it is at it.
 *
 * So the bands are drawn BEFORE the commit, from the server's dry run of the
 * same planner the commit uses (``POST .../divide-boreholes/preview``). What is
 * drawn here is what the button writes; the backend parity gate (integration
 * DB5, and DB7 for a re-divide) asserts that band for band.
 *
 * SCOPE — this previews the FIRST divide of a column, not a re-divide
 * ------------------------------------------------------------------
 * A column that already carries committed geotech bands drops its ghosts
 * entirely (see the ``committedBoreholeIds`` filter below), so once
 * ``Divide boreholes`` has run, pressing it again is as blind as it ever was:
 * the ``boreholesStale`` amber says the bands are out of date, not what they
 * would become. That is a deliberate limit of this slice, not an oversight —
 * drawing a plan over the committed rows it would REPLACE needs a diff render
 * (outline-only against the existing bands), which is its own design question.
 * Tracked in ``docs/debt.md`` (stale re-divide preview) and stated in
 * ``docs/design/geotech-stage.md`` §6. The backend already supports it: the
 * preview endpoint plans an already-divided model correctly (gate DB7).
 *
 * Visual convention is the litho axis's pending-suggestion one
 * (``LithoSuggestionGhostColumns`` / ``LithoSuggestionLayer``): a translucent
 * fill in the band's own colour, a dashed outline, and a 45° hatch overlay that
 * says "not committed" at a glance. The fill colour is ``nadClassColor`` so a
 * ghost sits in the same palette as the committed packing bands beside it —
 * same colour, obviously provisional.
 *
 * Confidence is carried by WEIGHT, not only by the tooltip: a class a
 * neighbouring CPT actually resolved and a conservative lithology-floor guess
 * must not look identical on a feature whose whole purpose is "what packing
 * does this borehole get". Low-confidence bands get a lighter fill and a denser
 * hatch (see ``TIERS``) — a difference that survives without hovering.
 *
 * ONE gesture, and it is per COLUMN, not per band: right-click a ghosted
 * borehole -> "Accept these bands (divide this borehole)" commits that column
 * alone (``onAcceptColumn``). The bands of one borehole are a single plan — its
 * donors, its litho extents, its ties — so accepting a band out of the middle
 * of it would ask the planner a question it was never asked. The toolbar's
 * step 4 remains the divide-everything verb; this is the answer to "these
 * ghosts are right, those are not".
 *
 * The band rect stays hit-testable ANYWAY so its ``<title>`` tooltip can appear
 * — a ``pointer-events: none`` ancestor silently kills every ``<title>`` under
 * it. The hatch and the label are ``none`` so they never take the hover from
 * the band beneath them. Trade-off accepted knowingly: a left-click landing on
 * a ghost is swallowed rather than reaching the fill underneath, and a ghosted
 * column is by definition an undivided borehole with nothing to click below.
 *
 * Geometry obeys the section's post-nudge column X (``col.nudgedX``), the same
 * value every other overlay draws at — column spacing warps the layout and a
 * ghost computed from the raw projected distance would float off its borehole.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react'

import type {
  DivideBoreholePreviewColumn,
  DivideBoreholePreviewDonor,
  LithoLayerResponse,
} from '../../api/client'
import {
  publishGeotechPreviewRender,
  resetGeotechPreviewRender,
} from '../../utils/geotechPreviewRenderStore'
import type { GeotechPreviewRender } from '../../utils/geotechPreviewRenderStore'
import { nadClassColor, nadClassName, nadCompactLabel } from '../../utils/nadClasses'
import ContextMenu from '../ui/ContextMenu'
import { surfaceYForColumn } from './contactsLayerGeometry'
import type { PlacedColumn } from './utils'

/**
 * Per-confidence visual weight.
 *
 * ``high`` is the planner's own token for "a same-lithology CPT resolved this
 * depth"; everything else is one of its conservative fallbacks. Weaker evidence
 * reads lighter and more heavily hatched, so the two are distinguishable at a
 * glance and at any zoom. ``fillOpacity`` for ``high`` matches
 * ``LithoSuggestionLayer``'s pending default (0.55) so a preview carries the
 * same weight on both axes.
 */
const TIERS = {
  strong: { fillOpacity: 0.55, hatchSpacing: 6, hatchOpacity: 0.28 },
  weak: { fillOpacity: 0.32, hatchSpacing: 3, hatchOpacity: 0.38 },
} as const

/** Which visual tier a band's confidence token earns. */
type Tier = keyof typeof TIERS

/** Font size of the in-band NAD label, px. Matches the litho ghost label. */
const LABEL_FONT_SIZE = 9

/** Minimum band height in px before the label is suppressed as unreadable. */
const LABEL_MIN_HEIGHT_PX = 12

/**
 * Floor height for a drawn band, px.
 *
 * A band thinner than this at the current zoom is drawn AT this height rather
 * than dropped. A planned band with no pixels reads as "nothing is planned at
 * this depth", which is the one thing this overlay must never imply — and a
 * hairline in the right place is a truthful, if imprecise, answer.
 */
const MIN_DRAWN_HEIGHT_PX = 1

/**
 * Prose for each provenance token the planner emits.
 *
 * Exhaustive over the tokens this build knows
 * (``divide_boreholes.py::_CONFIDENCE_BY_SOURCE``). An unknown token is shown
 * VERBATIM rather than given a default sentence: describing an unrecognised
 * provenance as "the lithology floor, no CPT evidence" would state something
 * about the evidence behind an engineering class that may simply be false.
 */
const PROVENANCE_PROSE: Readonly<Record<string, string>> = {
  cpt_interpolated: 'interpolated from the surrounding CPTs',
  body_min: 'weakest class seen in this body (no CPT resolves this depth)',
  absolute_min: 'lithology floor (no CPT evidence in this body)',
  column_min: 'loosest class this column measured for that soil (not read here)',
}

/** `5 m left` / `624 m right` / `256 m` (fallback has no side to name). */
function donorDistance(d: DivideBoreholePreviewDonor): string {
  const metres = d.along_distance_m ?? d.map_distance_m
  const dist = metres == null ? '' : `${Math.round(metres)} m`
  return d.side === 'nearest' ? dist : `${dist} ${d.side}`
}

/**
 * Donor-aware provenance for one band, or ``null`` when the band carries no
 * donor fields (a pre-rule backend) — the caller then falls back to the
 * ``source``-keyed prose above. Names the actual test(s) so the engineer can
 * go and look at the CPT the machine listened to, instead of the old
 * "surrounding CPTs" sentence that read as a consensus even when one donor
 * 624 m away spoke alone.
 */
function donorProse(band: {
  mode?: string | null
  donors?: DivideBoreholePreviewDonor[]
  section_name?: string | null
}): string | null {
  const donors = band.donors ?? []
  if (!band.mode || donors.length === 0) return null
  const at = band.section_name ? ` on ${band.section_name}` : ''
  if (band.mode === 'flank_interpolated' && donors.length >= 2) {
    const [a, b] = donors
    return `interpolated between ${a.name} (${donorDistance(a)}) and ${b.name} (${donorDistance(b)})${at}`
  }
  const d = donors[0]
  if (band.mode === 'single_donor') {
    return `from ${d.name} (${donorDistance(d)}${at})`
  }
  if (band.mode === 'nearest_fallback') {
    return `from ${d.name} (${donorDistance(d)} away — nearest test, no section neighbour)`
  }
  return null
}

/** Props for the borehole packing preview overlay. */
export interface Props {
  /**
   * Per-borehole planned bands from the preview endpoint. Empty / absent while
   * loading, or when there is nothing pending — the overlay then draws nothing.
   */
  previewColumns: readonly DivideBoreholePreviewColumn[]
  /**
   * Committed geotech ``litho_layer`` rows. A borehole that already has bands
   * here is DIVIDED: its ghosts are dropped immediately, so the preview never
   * double-draws over the real thing.
   */
  geotechLayers: readonly LithoLayerResponse[]
  /**
   * Whether ``geotechLayers`` currently reflects the server.
   *
   * ``useGeologicalModel`` clears the array to ``[]`` before every refetch, and
   * swallows a failed load to ``[]`` as well. Read literally, that empty array
   * claims "no borehole is divided" — which would put ghosts back over columns
   * that already carry committed bands, and keep them there for good if the
   * load failed. While this is false the last KNOWN answer is used instead.
   */
  geotechLayersLoaded: boolean
  /** Placed columns; ``nudgedX`` is the post-spacing X every overlay draws at. */
  placedColumns: readonly PlacedColumn[]
  /** Absolute elevation (mTAW) → screen y. */
  levelToScreen: (level: number) => number
  /** Top / bottom of the plot area in screen px. */
  plotTop: number
  plotBottom: number
  /**
   * Commit THIS borehole's ghosts — right-click → "Accept these bands".
   *
   * The pipeline's step 4 divides every borehole at once, which is the right
   * default and the wrong granularity when one column's ghosts look wrong and
   * the rest look right. The subset commit runs the SAME planner over the SAME
   * column, so what is committed is what was ghosted (backend gate GP9).
   *
   * Absent → the ghosts stay the read-only overlay they shipped as, and no
   * context menu is offered.
   */
  onAcceptColumn?: (boreholeId: string) => void
}

/** One resolved ghost band, in screen coordinates. */
interface GhostBand {
  depthTopM: number
  y: number
  height: number
  fill: string
  tier: Tier
  label: string
  title: string
}

/** One borehole column's ghost geometry, resolved once per render. */
interface GhostColumn {
  investigationId: string
  /** Display name — the context menu names the column it is about to divide. */
  name: string
  x0: number
  width: number
  bands: readonly GhostBand[]
}

/** An open right-click menu over one ghosted column. */
interface GhostMenuState {
  x: number
  y: number
  investigationId: string
  name: string
  bandCount: number
}

/** Everything the render needs, plus what to tell the toolbar about it. */
interface Resolved {
  columns: readonly GhostColumn[]
  summary: GeotechPreviewRender
}

/** Nothing drawn — the shape returned when the overlay renders no band. */
const NOTHING: Resolved = {
  columns: [],
  summary: { columnCount: 0, bandCount: 0, clampedBandCount: 0 },
}

/**
 * Borehole ids that carry at least one committed geotech band.
 *
 * Falls back to the last known set while ``loaded`` is false, so the ghosts on
 * screen hold their ground through the mid-refetch window instead of flickering
 * back over already-divided columns (see ``Props.geotechLayersLoaded``).
 *
 * Parameters
 * ----------
 * layers : readonly LithoLayerResponse[]
 *     Committed geotech rows, as last received.
 * loaded : boolean
 *     Whether those rows currently reflect the server.
 *
 * Returns
 * -------
 * ReadonlySet<string>
 *     Investigation ids to suppress ghosts for.
 */
function useCommittedBoreholeIds(
  layers: readonly LithoLayerResponse[],
  loaded: boolean,
): ReadonlySet<string> {
  const lastKnown = useRef<ReadonlySet<string>>(new Set())
  return useMemo(() => {
    // Deliberately idempotent: for the same (layers, loaded) inputs this
    // produces the same set, so writing the ref during the memo is safe under
    // StrictMode's double invocation.
    if (!loaded) return lastKnown.current
    const ids = new Set<string>()
    for (const layer of layers) {
      if (layer.borehole_id) ids.add(layer.borehole_id)
    }
    lastKnown.current = ids
    return ids
  }, [layers, loaded])
}

/**
 * Draw the packing bands "Divide boreholes" would write, as ghosts.
 *
 * Parameters
 * ----------
 * props : Props
 *     The preview payload, the committed rows that supersede it, and the
 *     section geometry.
 *
 * Returns
 * -------
 * JSX.Element | null
 *     ``null`` when no borehole is pending division — the axis then looks
 *     exactly as it did before this overlay existed.
 */
export default function GeotechBoreholePreviewGhosts({
  previewColumns,
  geotechLayers,
  geotechLayersLoaded,
  placedColumns,
  levelToScreen,
  plotTop,
  plotBottom,
  onAcceptColumn,
}: Props): JSX.Element | null {
  // Per-instance discriminator for the SVG pattern ids. A second mounted
  // section surface (split viewport, offscreen PDF render) would otherwise
  // repaint this one's hatching through a shared document-global id — the
  // reason LithoSuggestionGhostColumns suffixes its own pattern id.
  const instanceId = useId().replace(/:/g, '')
  const patternIdFor = (tier: Tier): string => `geotech-preview-hatch-${tier}-${instanceId}`

  const committedBoreholeIds = useCommittedBoreholeIds(geotechLayers, geotechLayersLoaded)

  // Above the "nothing drawn" early return, per the hook-order rule.
  const [menu, setMenu] = useState<GhostMenuState | null>(null)

  const { columns, summary } = useMemo<Resolved>(() => {
    if (previewColumns.length === 0) return NOTHING
    const previewById = new Map(previewColumns.map(c => [c.borehole_id, c]))
    const out: GhostColumn[] = []
    let bandCount = 0
    let clampedBandCount = 0

    for (const col of placedColumns) {
      if (col.kind !== 'borehole') continue
      const item = col.proj.item as { id: string }
      const preview = previewById.get(item.id)
      if (preview === undefined || preview.bands.length === 0) continue
      // The commit has landed for this column — the real bands own it now.
      if (committedBoreholeIds.has(item.id)) continue
      const surface = surfaceYForColumn(col, levelToScreen)
      if (surface.surfaceElevationM === null || surface.pxPerMetre === 0) continue

      const bands: GhostBand[] = []
      for (const band of preview.bands) {
        const rawTop = surface.surfaceY + band.depth_top_m * surface.pxPerMetre
        const rawBase = surface.surfaceY + band.depth_base_m * surface.pxPerMetre
        // Wholly outside the visible depth window: there is no pixel to draw
        // it at. Counted so the toolbar can say so rather than let the silence
        // read as "nothing planned down there".
        if (rawBase <= plotTop || rawTop >= plotBottom) {
          clampedBandCount += 1
          continue
        }
        const y = Math.max(plotTop, Math.min(plotBottom, rawTop))
        const clampedBase = Math.max(plotTop, Math.min(plotBottom, rawBase))
        const height = Math.max(MIN_DRAWN_HEIGHT_PX, clampedBase - y)
        const tier: Tier = band.confidence === 'high' ? 'strong' : 'weak'
        const provenance =
          donorProse(band) ?? PROVENANCE_PROSE[band.source] ?? band.source
        bands.push({
          depthTopM: band.depth_top_m,
          y,
          height,
          fill: nadClassColor(band.nad_class),
          tier,
          label: nadCompactLabel(band.nad_class),
          title:
            `${preview.name} · ${nadClassName(band.nad_class)} · ` +
            `${band.depth_top_m.toFixed(2)}–${band.depth_base_m.toFixed(2)} m\n` +
            `Preview — ${provenance} (${band.confidence} confidence).\n` +
            'Press "Divide boreholes" to commit.',
        })
      }
      if (bands.length === 0) continue
      bandCount += bands.length
      out.push({
        investigationId: item.id,
        name: preview.name,
        x0: col.nudgedX - col.width / 2,
        width: col.width,
        bands,
      })
    }

    return {
      columns: out,
      summary: { columnCount: out.length, bandCount, clampedBandCount },
    }
  }, [
    previewColumns,
    committedBoreholeIds,
    placedColumns,
    levelToScreen,
    plotTop,
    plotBottom,
  ])

  // Tell the toolbar what is actually hatched, so its legend is gated on the
  // drawing rather than on an approximation of it. Above the early return: a
  // frame that draws nothing must publish zero, not skip the effect.
  useEffect(() => {
    publishGeotechPreviewRender(summary)
  }, [summary])

  // Leaving the axis / unmounting means nothing is hatched any more.
  useEffect(() => resetGeotechPreviewRender, [])

  if (columns.length === 0) return null

  return (
    <g data-testid="geotech-borehole-preview-ghosts">
      <defs>
        {/* 45° hatch, identical in construction to the litho pending-ghost
            pattern, so "hatched = not committed yet" means one thing across
            the whole section editor. One per confidence tier: the denser weave
            is the conservative fallback. */}
        {(Object.keys(TIERS) as Tier[]).map(tier => (
          <pattern
            key={tier}
            id={patternIdFor(tier)}
            patternUnits="userSpaceOnUse"
            width={TIERS[tier].hatchSpacing}
            height={TIERS[tier].hatchSpacing}
            patternTransform="rotate(45)"
          >
            <line
              x1={0}
              y1={0}
              x2={0}
              y2={TIERS[tier].hatchSpacing}
              stroke="#000000"
              strokeOpacity={TIERS[tier].hatchOpacity}
              strokeWidth={1.4}
            />
          </pattern>
        ))}
      </defs>

      {columns.map(column => (
        <g
          key={`gbp-${column.investigationId}`}
          data-testid={`geotech-preview-column-${column.investigationId}`}
          onContextMenu={
            onAcceptColumn
              ? e => {
                  e.preventDefault()
                  e.stopPropagation()
                  const r = e.currentTarget.ownerSVGElement?.getBoundingClientRect()
                  setMenu({
                    x: r ? e.clientX - r.left : column.x0,
                    y: r ? e.clientY - r.top : 0,
                    investigationId: column.investigationId,
                    name: column.name,
                    bandCount: column.bands.length,
                  })
                }
              : undefined
          }
        >
          {column.bands.map(band => (
            <g key={`gbp-band-${column.investigationId}-${band.depthTopM}`}>
              <rect
                data-testid={`geotech-preview-band-${column.investigationId}-${band.depthTopM}`}
                x={column.x0}
                y={band.y}
                width={column.width}
                height={band.height}
                fill={band.fill}
                fillOpacity={TIERS[band.tier].fillOpacity}
                stroke={band.fill}
                strokeOpacity={0.85}
                strokeWidth={1.2}
                strokeDasharray="4 2"
              >
                {/* The only channel naming the evidence behind the class, so
                    the rect deliberately stays hit-testable — see the module
                    docstring on the click trade-off. */}
                <title>{band.title}</title>
              </rect>
              <rect
                data-testid={`geotech-preview-hatch-${column.investigationId}-${band.depthTopM}`}
                x={column.x0}
                y={band.y}
                width={column.width}
                height={band.height}
                fill={`url(#${patternIdFor(band.tier)})`}
                pointerEvents="none"
              />
              {band.height >= LABEL_MIN_HEIGHT_PX && (
                <text
                  x={column.x0 + column.width / 2}
                  y={band.y + band.height / 2 + LABEL_FONT_SIZE / 3}
                  textAnchor="middle"
                  fontSize={LABEL_FONT_SIZE}
                  fill="#1f2937"
                  pointerEvents="none"
                  style={{ userSelect: 'none' }}
                >
                  {band.label}
                </text>
              )}
            </g>
          ))}
        </g>
      ))}

      {/* Right-click -> commit THIS column. ``portal="svg"`` because the menu is
          HTML and this component renders inside the section's <svg>. */}
      {menu && onAcceptColumn && (
        <ContextMenu
          portal="svg"
          x={menu.x}
          y={menu.y}
          width={260}
          // One row plus the header — the same 48 + 32/row sizing the edge menu
          // uses, so an SVG-portalled menu never clips the row it decided to show.
          height={80}
          minWidth={240}
          testid="geotech-preview-column-menu"
          header={`${menu.name} · ${menu.bandCount} planned band${menu.bandCount === 1 ? '' : 's'}`}
          onClose={() => setMenu(null)}
          items={[
            {
              label: `Accept these bands (divide this borehole)`,
              onClick: () => {
                const id = menu.investigationId
                setMenu(null)
                onAcceptColumn(id)
              },
              testid: 'geotech-preview-accept-column',
            },
          ]}
        />
      )}
    </g>
  )
}
