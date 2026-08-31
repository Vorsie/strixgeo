/**
 * HALF TWO OF THE GOLDEN MASTER — what actually reaches the SCREEN.
 *
 * Owner, 2026-08-23: *"not only what is in DB also what is rendered on
 * screen"*. He is right, and the evidence is a whole night's work: on
 * 2026-08-22 the ENGINE output for CS1 was proved byte-identical from session
 * start to session end while THREE separate render layers changed what the
 * user saw — the seam-stroke identity, the fill dissolve, and the litho
 * outline's column-line guard. An engine-only snapshot would have called that
 * night a no-op.
 *
 * So this half renders the real ``PartitionFillOverlay`` on the geotech axis
 * into jsdom and freezes every painted SVG element: the dissolved fill groups
 * (with their colour and opacity), the self-colour seam strokes, the litho
 * outline paths, the litho fallback fills and the un-banded hatch.
 *
 * The projection is FIXED here (not the app's live viewport) so the snapshot
 * is a statement about the render's geometry, not about a window size.
 *
 * @module utils/cs1GoldenMaster/screenSnapshot
 */

import { render, cleanup } from '@testing-library/react'

import PartitionFillOverlay, {
  type GeotechLithoFrame,
  type Props,
} from '../../components/sections/PartitionFillOverlay'
import { nadClassColor } from '../nadClasses'
import { loadCs1Scene, type Cs1Scene } from './input'
import type { LithoContactCorrelationEdge, LithoLayerResponse } from '../../api/client'
import type { PlacedColumn } from '../../components/sections/utils'
import type { CorrelationEdge, PartitionColumn } from '../sectionPartition'

/** Fixed viewport — the snapshot freezes geometry, never a window size. */
const PLOT = { top: 0, bottom: 600, left: 0, right: 1200 } as const
/** Screen px per metre of elevation, and the elevation at ``y = 0``. */
const PX_PER_M = 20
const TOP_ELEV_M = 15
/** Screen px per along-metre. */
const PX_PER_ALONG = 1.2

const levelToScreen = (level: number): number => (TOP_ELEV_M - level) * PX_PER_M
const screenToLevel = (y: number): number => TOP_ELEV_M - y / PX_PER_M
const alongToScreenX = (a: number): number => a * PX_PER_ALONG
const screenXToAlong = (x: number): number => x / PX_PER_ALONG

/** Path-data quantum — two decimals, matching what the component itself emits. */
const round2 = (n: number): number => Math.round(n * 100) / 100

function toRows(columns: readonly PartitionColumn[], modelId: string): LithoLayerResponse[] {
  const out: LithoLayerResponse[] = []
  for (const c of columns) {
    for (const u of c.units as unknown as {
      layerId: string
      topDepthM: number
      baseDepthM: number
      formationId: string
      bodyId: string | null
    }[]) {
      out.push({
        id: u.layerId,
        model_id: modelId,
        formation_id: u.formationId,
        borehole_id: c.investigationId,
        cpt_id: null,
        depth_top_m: u.topDepthM,
        depth_base_m: u.baseDepthM,
        status: 'accepted',
        source: 'manual',
        confidence: 'high',
        observation_id: null,
        observation_layer_id: null,
        parent_geo_contact_id: null,
        body_id: u.bodyId,
        notes: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      } as LithoLayerResponse)
    }
  }
  return out
}

function toEdgeRows(
  edges: readonly CorrelationEdge[],
  modelId: string,
): LithoContactCorrelationEdge[] {
  return edges.map(
    (e, i) =>
      ({
        id: `e-${modelId}-${i}`,
        model_id: modelId,
        section_id: 'sec-cs1',
        layer_a_id: e.a,
        layer_b_id: e.b,
        layer_a_side: e.aSide ?? 'top',
        layer_b_side: e.bSide ?? 'top',
        source: 'manual',
        user_approved: true,
      }) as unknown as LithoContactCorrelationEdge,
  )
}

/** Card width in px, and the smallest pitch that keeps every gap paintable. */
const CARD_W = 18
const MIN_PITCH = CARD_W + 14

/**
 * Place the columns the way the app does — WITH the collision nudge.
 *
 * The fill's x does not come from ``alongToScreenX``; it comes from each
 * card's own ``nudgedX ± width/2`` (a gap runs from one card's right edge to
 * the next card's left edge). ``overlayFaces`` then drops any gap under 1 px
 * as degenerate — no fill, no outline, no hatch. Real CS1 has columns 0.17 m
 * apart (S5/S5A/S5B, and B9/S9/B3), so placing cards at raw along-position
 * silently DROPS about ten of the twenty-three gaps and the snapshot would
 * freeze a picture with holes in it — a gate blind to a third of the section.
 * The app avoids this with its spacing nudge; so must this harness.
 */
function toPlaced(scene: Cs1Scene): PlacedColumn[] {
  const nudged: number[] = []
  for (let i = 0; i < scene.lithoColumns.length; i++) {
    const want = alongToScreenX(scene.alongM[i])
    nudged.push(i === 0 ? want : Math.max(want, nudged[i - 1] + MIN_PITCH))
  }
  return scene.lithoColumns.map(
    (c, i) =>
      ({
        kind: 'borehole',
        nudgedX: nudged[i],
        trueX: alongToScreenX(scene.alongM[i]),
        width: CARD_W,
        displaced: nudged[i] !== alongToScreenX(scene.alongM[i]),
        proj: {
          along: scene.alongM[i],
          offset: 0,
          item: { id: c.investigationId, elevation_m: c.surfaceElevM },
        },
      }) as unknown as PlacedColumn,
  )
}

/** One painted SVG element, reduced to what the eye can tell apart. */
export interface FrozenElement {
  /** Element family — the data-testid stem, or ``paint-def``. */
  family: string
  fill: string
  stroke: string
  opacity: string
  strokeOpacity: string
  strokeWidth: string
  /**
   * Path data with every coordinate rounded to 2 dp — or, for a
   * ``paint-def``, that definition's own attributes serialised.
   */
  d: string
}

/**
 * The screen half: WHAT is painted, and in WHICH LAYER ORDER.
 *
 * The elements are sorted by content so a pure reshuffle inside one layer is
 * not reported as a change — but that sort, and the content-keyed comparison
 * in the gate, together erase paint ORDER completely. Paint order is not
 * cosmetic here: the litho outline is drawn deliberately OVER the packing
 * fills ("litho boundaries persist", owner ruling 2026-08-13), and an audit
 * agent moved that layer beneath the fills with the gate staying green
 * (2026-08-23). So the LAYER sequence is frozen separately — six entries,
 * a tiny readable diff, and it pins exactly the thing that matters.
 */
export interface ScreenSnapshot {
  elements: FrozenElement[]
  /** Distinct element families in DOM paint order — first painted first. */
  layerOrder: string[]
}

/** Build the props exactly as ``SectionPanel`` wires them on the geotech axis. */
export function cs1GeotechProps(scene: Cs1Scene = loadCs1Scene()): Props {
  const lithoFrame: GeotechLithoFrame = {
    lithoLayers: toRows(scene.lithoColumns, 'litho-model'),
    lithoEdges: toEdgeRows(scene.lithoEdges, 'litho-model'),
    // Litho colour is the STORED lithology colour; deterministic per soil here.
    lithoFormationColorById: new Map(
      [...scene.lithoSoilByFormationId.entries()].map(([fid, soil]) => [
        fid,
        { ZAND: '#fbbf24', KLEI: '#0ea5e9', SILT: '#84cc16', VEEN: '#7c3f00' }[soil ?? ''] ??
          '#9ca3af',
      ]),
    ),
    lithoSoilByFormationId: scene.lithoSoilByFormationId,
    geotechSoilByFormationId: scene.geotechSoilByFormationId,
    packingClassByFormationId: scene.packingClassByFormationId,
  }
  return {
    lithoLayers: toRows(scene.geotechColumns, 'geotech-model'),
    contactEdges: toEdgeRows(scene.geotechEdges, 'geotech-model'),
    lithoFrame,
    axisMode: 'geotechnical',
    bodies: [],
    placedColumns: toPlaced(scene),
    // On the geotech axis SectionPanel maps every row to nadClassColor.
    formationColorById: new Map(
      [...scene.nadClassByFormationId.entries()].map(([fid, cls]) => [fid, nadClassColor(cls)]),
    ),
    showBands: true,
    levelToScreen,
    plotTop: PLOT.top,
    plotBottom: PLOT.bottom,
    plotLeft: PLOT.left,
    plotRight: PLOT.right,
    alongToScreenX,
    screenXToAlong,
    screenToLevel,
  } as Props
}

/** Which testid stems carry visible geometry, and what they are called here. */
const FAMILIES: readonly [string, string][] = [
  ['partition-fill-group-', 'fill-group'],
  ['partition-region-stroke', 'seam-stroke-region'],
  ['partition-undercol-stroke', 'seam-stroke-undercol'],
  ['partition-litho-outline', 'litho-outline'],
  ['partition-litho-fallback', 'litho-fallback'],
  ['partition-unbanded-hatch', 'unbanded-hatch'],
]

/** Round every number inside an SVG path's ``d`` to 2 dp. */
const roundPath = (d: string): string =>
  d.replace(/-?\d+\.?\d*/g, (m) => String(round2(Number(m))))

/**
 * Render CS1 on the geotech axis and freeze everything painted.
 *
 * @param scene The frozen scene; defaults to the committed fixture.
 * @returns Every painted element, in a deterministic order.
 */
export function computeScreenSnapshot(scene: Cs1Scene = loadCs1Scene()): ScreenSnapshot {
  const { container } = render(
    <svg width={PLOT.right} height={PLOT.bottom}>
      <PartitionFillOverlay {...cs1GeotechProps(scene)} />
    </svg>,
  )
  const out: FrozenElement[] = []
  const layerOrder: string[] = []
  for (const el of Array.from(container.querySelectorAll('[data-testid]'))) {
    const testid = el.getAttribute('data-testid') ?? ''
    const hit = FAMILIES.find(([stem]) => testid.startsWith(stem))
    if (!hit) continue
    const d = el.getAttribute('d')
    if (d === null) continue
    if (layerOrder[layerOrder.length - 1] !== hit[1]) layerOrder.push(hit[1])
    out.push({
      family: hit[1],
      fill: el.getAttribute('fill') ?? '',
      stroke: el.getAttribute('stroke') ?? '',
      opacity: el.getAttribute('fill-opacity') ?? el.getAttribute('opacity') ?? '',
      strokeOpacity: el.getAttribute('stroke-opacity') ?? '',
      strokeWidth: el.getAttribute('stroke-width') ?? '',
      d: roundPath(d),
    })
  }
  // PAINT DEFINITIONS — the <defs> the painted elements refer to.
  //
  // A hatch <path> only says fill="url(#id)"; everything the eye actually
  // sees of that texture — its ink, spacing, rotation, stroke width — lives
  // in the <pattern> under <defs>, which carries no data-testid and no `d`
  // and was therefore skipped entirely. Demonstrated (audit finding,
  // 2026-08-23, reproduced by hand): changing UNBANDED_HATCH_INK from slate
  // to magenta left the gate GREEN. A definition is part of the picture.
  for (const def of Array.from(container.querySelectorAll('pattern, pattern *'))) {
    const attrs = Array.from(def.attributes)
      .map((a) => `${a.name}=${a.value}`)
      .sort()
      .join(' ')
    out.push({
      family: `paint-def:${def.tagName.toLowerCase()}`,
      fill: def.getAttribute('fill') ?? '',
      stroke: def.getAttribute('stroke') ?? '',
      opacity: def.getAttribute('opacity') ?? '',
      strokeOpacity: def.getAttribute('stroke-opacity') ?? '',
      strokeWidth: def.getAttribute('stroke-width') ?? '',
      d: attrs,
    })
  }
  cleanup()
  // Content order — the DOM order is an implementation detail, the SET of
  // painted things is the statement. (Paint ORDER is covered separately by
  // the component's own z-order tests.)
  out.sort((a, b) =>
    a.family !== b.family
      ? a.family.localeCompare(b.family)
      : a.fill !== b.fill
        ? a.fill.localeCompare(b.fill)
        : a.d.localeCompare(b.d),
  )
  return { elements: out, layerOrder }
}
