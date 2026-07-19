/**
 * partitionFillV2/tileCoherentStackTypes.ts — shared geometry types for the ruling-8h coherent
 * sweep + its extracted converging-stack tiler (design partition-engine-v2.md §8 ruling 8h).
 *
 * Extracted so ``tileConvergingStack.ts`` (TARGET 1, session 10) can take the present side's
 * facing geometry without a value-import cycle with ``tileCoherentStack.ts`` (which owns the sweep
 * and imports the converging-stack emitter). Type-only module.
 *
 * Pure module — no React, no Date.now / Math.random, no I/O.
 */

import { type ColumnGeom } from './sectionGeom'
import { type EffectiveCorr } from './effectiveCorr'
import { type IntervalUnit } from './emitIntervalLenses'

/**
 * One matrix unit paired with its per-gap effective corr (2/1/0) on its own side.
 * Moved here from the deleted ``tileGap.ts`` (audit item 7, session 36) — the live
 * flag-OFF lone-stack path (``emitLoneStack`` / ``tileConvergingStack``) still keys
 * unit geometry to its effective corr through this shape.
 */
export interface CorrUnit {
  iu: IntervalUnit
  corr: EffectiveCorr
  /** Unit index on the owning column (to key the effective-corr lookup). */
  colUnitIndex: number
}

/**
 * The subset of one side's resolved geometry the converging-stack tiler needs: the present
 * column's own x, the FACING (converging) column + its x, and the interval's top / base elevation
 * on the FACING column (which define the convergence point). Kept narrow so the extracted tiler
 * does not depend on the full sweep-internal ``SideGeom``.
 */
export interface ConvergingSide {
  /** This side's OWN column (its bracket adjacency names the lateral enclosing at the convergence). */
  col: ColumnGeom
  /** This side's own column x (metres). */
  ownX: number
  /** The FACING column (the enclosing-matrix source across the converging bracket). */
  facing: ColumnGeom
  /** The FACING column x (metres) — the convergence point's x. */
  facingX: number
  /** The interval's top elevation on the FACING column. */
  facingTop: number
  /** The interval's base elevation on the FACING column. */
  facingBase: number
}
