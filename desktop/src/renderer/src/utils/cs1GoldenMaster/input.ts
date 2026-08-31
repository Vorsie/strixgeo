/**
 * The committed CS1 scene the golden master runs on — fixture JSON turned
 * into exactly the inputs the two real consumers take.
 *
 * One loader, used by BOTH halves of the gate (the engine snapshot and the
 * on-screen snapshot), so the two can never drift apart on their inputs and
 * disagree for a reason that is not a real regression.
 *
 * @module utils/cs1GoldenMaster/input
 */

import fixture from '../__fixtures__/cs1_golden_input.json'
import { buildPackingClassOf } from '../geotechHierarchicalFill/packingClassOf'
import type { CorrelationEdge, PartitionColumn } from '../sectionPartition'

/** One anonymised column as the fixture stores it. */
interface FixtureColumn {
  investigationId: string
  surfaceElevM: number
  units: {
    layerId: string
    topDepthM: number
    baseDepthM: number
    formationId: string
    bodyId: string | null
  }[]
}

/** Everything the CS1 scene needs, in consumer-ready shape. */
export interface Cs1Scene {
  lithoColumns: PartitionColumn[]
  lithoEdges: CorrelationEdge[]
  geotechColumns: PartitionColumn[]
  geotechEdges: CorrelationEdge[]
  alongM: number[]
  /**
   * Geotech formation id → ``SOIL|CLASS``. ONE map, handed to both the fill
   * (as its mass identity) and the render (as its dissolve/seam identity) —
   * the 2026-08-21 "one mass one body" single translation point.
   */
  packingClassByFormationId: Map<string, string>
  /** Litho formation id → soil code, for the outline pass. */
  lithoSoilByFormationId: Map<string, string | null>
  /** Geotech formation id → soil code. */
  geotechSoilByFormationId: Map<string, string | null>
  /** Geotech formation id → its NAD class, or null. */
  nadClassByFormationId: Map<string, number | null>
}

const toColumns = (cols: readonly FixtureColumn[]): PartitionColumn[] =>
  cols.map((c) => ({
    investigationId: c.investigationId,
    surfaceElevM: c.surfaceElevM,
    units: c.units.map((u) => ({ ...u })),
  })) as unknown as PartitionColumn[]

const toEdges = (
  es: readonly { a: string; b: string; aSide: string; bSide: string }[],
): CorrelationEdge[] =>
  es.map((e) => ({
    a: e.a,
    b: e.b,
    aSide: e.aSide as 'top' | 'base',
    bSide: e.bSide as 'top' | 'base',
  }))

/**
 * Load the frozen CS1 scene.
 *
 * @returns The scene, freshly built each call (never shared/mutated).
 */
export function loadCs1Scene(): Cs1Scene {
  const nadFormations = fixture.nadFormations as Record<
    string,
    { nadClass: number | null; soilCode: string | null }
  >
  const lithoSoil = fixture.lithoSoil as Record<string, string | null>

  const geotechSoilByFormationId = new Map<string, string | null>()
  const nadClassByFormationId = new Map<string, number | null>()
  for (const [fid, meta] of Object.entries(nadFormations)) {
    geotechSoilByFormationId.set(fid, meta.soilCode)
    nadClassByFormationId.set(fid, meta.nadClass)
  }

  return {
    lithoColumns: toColumns(fixture.columns as FixtureColumn[]),
    lithoEdges: toEdges(fixture.edges),
    geotechColumns: toColumns(fixture.geotechColumns as FixtureColumn[]),
    geotechEdges: toEdges(fixture.geotechEdges),
    alongM: [...fixture.alongM],
    packingClassByFormationId: buildPackingClassOf(Object.entries(nadFormations)),
    lithoSoilByFormationId: new Map(Object.entries(lithoSoil)),
    geotechSoilByFormationId,
    nadClassByFormationId,
  }
}
