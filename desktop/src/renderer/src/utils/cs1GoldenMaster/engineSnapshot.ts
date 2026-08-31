/**
 * HALF ONE OF THE GOLDEN MASTER — what the ENGINE derives from the database.
 *
 * Every region the geotech fill emits for CS1: its gap, its class, its kind,
 * the layers it carries and its FULL polygon — every vertex of every quad
 * (owner, 2026-08-23: *"make sure to have all quads too"*). Plus the litho
 * fallback ("correlate me") regions, which are just as much a statement about
 * the model as the classed ones.
 *
 * This half alone is NOT enough, and that is the whole reason the gate has two
 * halves: on 2026-08-22 the engine output was proved byte-identical across a
 * night of work while three separate RENDER layers changed what reached the
 * screen. See ``screenSnapshot`` for the other half.
 *
 * Pure module — no React.
 *
 * @module utils/cs1GoldenMaster/engineSnapshot
 */

import { deriveSectionApexOverrides } from '../buildVoxelRequest'
import { frameAlignedColumns } from '../frameAlignedPartition'
import { computeHierarchicalGeotechFill } from '../geotechHierarchicalFill'
import { computeSectionFillActive } from '../partitionEngineSelect'
import { loadCs1Scene, type Cs1Scene } from './input'
import type { BodyBoundaryResponse } from '../../api/clients/geology.types'
import type { SectionRegion } from '../sectionPartition'

/**
 * Coordinate quantum. Fractions and elevations are rounded to 1e-6 before
 * freezing: far finer than the engine's own 1 mm snap (so a real geometry
 * change can never hide under it) and coarse enough that the golden does not
 * churn on last-bit floating-point noise between platforms.
 */
const QUANTUM = 1e6

const round = (n: number): number => Math.round(n * QUANTUM) / QUANTUM

/** One frozen region — everything that decides what it is and where it is. */
export interface FrozenRegion {
  gap: number
  formationId: string
  kind: string
  layerIds: string[]
  /** ``f,e`` pairs — the full ring, in emission order. */
  ring: string
}

/** The engine half of the golden master. */
export interface EngineSnapshot {
  regions: FrozenRegion[]
  fallback: FrozenRegion[]
}

/**
 * A ring, canonicalised so only its SHAPE is frozen.
 *
 * A polygon is a cycle: which vertex the engine happens to emit first says
 * nothing about what the user sees, and it genuinely varies — the very first
 * faithfulness run caught one region whose ring was identical but rotated by
 * four vertices. Freezing the raw order would have made the gate cry wolf on
 * a change that moves nothing. Rotate to start at the smallest vertex.
 *
 * DIRECTION is deliberately NOT normalised: a winding flip is a real change
 * to the emitted path and the gate should say so.
 */
function canonicalRing(polygon: readonly { fraction: number; elevation: number }[]): string {
  const pts = polygon.map((p) => `${round(p.fraction)},${round(p.elevation)}`)
  if (pts.length === 0) return ''
  let start = 0
  for (let i = 1; i < pts.length; i++) if (pts[i] < pts[start]) start = i
  return [...pts.slice(start), ...pts.slice(0, start)].join(' ')
}

const freeze = (r: SectionRegion): FrozenRegion => ({
  gap: r.gapIndex,
  formationId: (r as unknown as { formationId: string }).formationId,
  kind: r.kind,
  layerIds: [...((r.layerIds ?? []) as string[])].sort(),
  ring: canonicalRing(r.polygon),
})

/**
 * Sort regions into a stable order that does not depend on emission order.
 *
 * The engine is free to emit in any order; only the SET of regions is a
 * statement about the model. Sorting on content means a pure reordering never
 * fails the gate, while any change to a shape, a class or a layer set does.
 */
const stable = (rs: FrozenRegion[]): FrozenRegion[] =>
  [...rs].sort((a, b) =>
    a.gap !== b.gap
      ? a.gap - b.gap
      : a.formationId !== b.formationId
        ? a.formationId.localeCompare(b.formationId)
        : a.kind !== b.kind
          ? a.kind.localeCompare(b.kind)
          : a.ring.localeCompare(b.ring),
  )

/**
 * Run the real pipeline over the frozen CS1 scene.
 *
 * Mirrors the render's own call sequence exactly (``PartitionFillOverlay`` →
 * litho partition → ``computeHierarchicalGeotechFill``), so the snapshot is of
 * the shipped path and not of a test-only arrangement.
 *
 * @param scene The frozen scene; defaults to the committed fixture.
 */
export function computeEngineSnapshot(scene: Cs1Scene = loadCs1Scene()): EngineSnapshot {
  const noBoundaries = new Map<string, BodyBoundaryResponse>()
  const lithoRegions = computeSectionFillActive(
    scene.lithoColumns,
    scene.lithoEdges,
    deriveSectionApexOverrides(
      scene.lithoColumns,
      scene.lithoEdges,
      scene.alongM,
      noBoundaries,
    ),
    scene.alongM,
  )
  const out = computeHierarchicalGeotechFill({
    lithoColumns: scene.lithoColumns,
    lithoEdges: scene.lithoEdges,
    lithoRegions,
    geotechColumns: frameAlignedColumns(
      scene.lithoColumns,
      new Map(scene.geotechColumns.map((c) => [c.investigationId, c])),
    ),
    geotechEdges: scene.geotechEdges,
    alongM: scene.alongM,
    packingClassOf: scene.packingClassByFormationId,
  })
  return {
    regions: stable(out.regions.map(freeze)),
    fallback: stable(out.lithoFallback.map(freeze)),
  }
}
