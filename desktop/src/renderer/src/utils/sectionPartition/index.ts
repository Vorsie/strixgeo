// sectionPartition — the shared section-partition vocabulary.
//
// This module is what SURVIVED the v1 partition engine (#280, archived
// 2026-08-31: "archive the first faulty engine. the new one is de standard").
// It holds no engine: the fill itself lives in ``partitionFillV2`` and is
// reached through ``partitionEngineSelect``. What lives here is the currency
// every consumer of a partition speaks — the column/edge/region types, the
// column matcher, the two column-reduction helpers, the region-area helpers
// and the polygon slicer.

export {
  EPS,
  LENS_PINCH_FRACTION,
  INTERIOR_PINCH_FRACTION,
  lensApexOverrideKey,
  type PartitionUnit,
  type PartitionColumn,
  type CorrelationEdge,
  type LensApexOverride,
  type PartitionPoint,
  type PartitionRegion,
} from './types'
export {
  classifyTermination,
  matchColumns,
  type MatchUnit,
  type Correlated,
  type ContactTermination,
} from './matcher'
export { closeColumnGaps, collapseAdjacentSameFormation, computeBottomTieLine } from './columnReduce'
export {
  slicePolygonAtFraction,
  type SectionRegion,
  type UnderColumnQuad,
  type UnderColumnFill,
} from './sectionRegion'
