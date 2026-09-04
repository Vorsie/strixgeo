/**
 * partitionFillV2 — planar-arrangement core for partition engine v2.
 *
 * This package is the closed-loop (face-tracing) replacement for the v1
 * ``partitionFill/`` engine (see ``docs/design/partition-engine-v2.md``). This
 * increment ships ONLY the pure-geometry arrangement core:
 *
 *   input polylines (metres × elevation)
 *     → snap to 1 mm grid
 *     → pairwise-intersect + split
 *     → build planar DCEL (twin / next wired)
 *     → trace bounded faces (CCW), drop degenerate, attach holes
 *
 * The public entry point is ``buildArrangement``. Later increments will add face
 * labelling (formation / body / band-onlap-lens), slicing at column verticals,
 * and the ``computeSectionFillV2`` domain wrapper — all layered on top of the
 * ``Arrangement`` this module returns. NONE of that domain logic is here.
 *
 * Pure module — no React, no ``Date.now`` / ``Math.random``, no I/O.
 */

export {
  type Point,
  type CurveKind,
  type InputCurve,
  type Face,
  type Arrangement,
  type HalfEdge,
  SNAP_GRID_M,
} from './types'

export { buildArrangement } from './arrangement'

// Increment 2: curve emission -> face labelling -> slicing -> the domain entry.
export {
  classifyOverrideOutcome,
  computeSectionFillV2,
  computeSectionFillV2WithConflicts,
  type FillIdentity,
  type OverrideOutcome,
} from './computeSectionFillV2'
export { type TieConflict, type ResolvedTie } from './emitCurves'
export { type ReviewFlag } from './forceLensUnits'
export {
  detectCrossingConflicts,
  edgeKey,
  type CrossingConflict,
} from './crossingConflicts'
export { type LabelledFace, type FaceClass } from './labelFaces'
export { type ColumnGeom, type UnitGeom, type SectionInput } from './sectionGeom'
