// Pure pooling of identification-test (OKP — onderkenningsproeven) results
// from borehole samples inside a unit's bands (owner ruling R8, 2026-08-27:
// "i want a plot with all OKP's in a layer").
//
// The qc/fs/Rf statistics read the CONE inside the unit's CPT bands
// (``unitStatistics.ts``); this module is the sibling for the LAB: every
// numeric classification value on every sample whose depth-interval midpoint
// falls inside the unit's borehole bands. Grain-size CURVES are out of THIS
// module — a distribution per sieve is a different chart family — and pool
// through ``unitPsd.ts`` instead (owner ruling S5, 2026-08-27: "i'm missing
// all PSD's on one graph"); the scalar fractions DOV ships (clay content,
// grain density, ...) arrive through the scalar catch-all and pool like any
// other value here.
//
// ELEVATION, NOT DEPTH. Each point carries mTAW, converted exactly as the
// borelog draws its layers (``BoreholeLog.tsx``: depth = collar − mTAW, so
// mTAW = collar − depth). Depth frames differ per hole; elevation is the one
// axis a pooled scatter can share. A borehole with no collar elevation cannot
// be placed and is SKIPPED, counted in ``skippedNoElevation`` so the panel
// can say so instead of silently thinning the pool.
//
// Labels are the presentation-boundary translations (``labTestLabels.ts``)
// with the raw Dutch token carried alongside for the tooltip — the standing
// translate-at-presentation rule.

import type { BoreholeDetailResponse, SampleResponse } from '../../../api/client'
import { labelForParameter } from '../../../utils/labTestLabels'

/** One borehole-anchored band of the unit, in that hole's own depth frame. */
export interface UnitBoreholeBandInterval {
  /** The borehole the band hangs off — the key into the detail map. */
  boreholeId: string
  /** Band top in metres below the collar. */
  topDepthM: number
  /** Band base in metres below the collar. */
  baseDepthM: number
}

/** One plotted identification-test value. */
export interface IdentificationPoint {
  /** The numeric test value, in the panel's unit. */
  value: number
  /** Sample midpoint elevation, mTAW (collar − midpoint depth). */
  elevationM: number
  /**
   * The SAMPLE this value was measured on — the colour key shared with the
   * sample's PSD curve (owner 2026-08-28), so a dot and its grain-size curve
   * wear the same colour.
   */
  sampleId: string
  /** The hole the sample came from — for the point tooltip. */
  boreholeName: string
  /** Sample number when the lab recorded one. */
  sampleNumber: string | null
}

/** One per-parameter scatter panel — only parameters WITH data exist. */
export interface IdentificationPanel {
  /** Stable grouping key (typed family or scalar parameter token). */
  key: string
  /** English presentation label. */
  label: string
  /**
   * The verbatim upstream token for the label tooltip, or ``null`` for a
   * typed family (whose rows carry no single source token).
   */
  rawParameter: string | null
  /** Unit string as the source reports it; ``null`` when absent (typed % families carry '%'). */
  unit: string | null
  /** Every pooled value, unordered. */
  points: IdentificationPoint[]
}

/** The pooled panels plus what could NOT be pooled. */
export interface IdentificationPool {
  /** Panels in display order: typed families first, then scalars by label. */
  panels: IdentificationPanel[]
  /** Samples skipped because their borehole has no collar elevation. */
  skippedNoElevation: number
}

/**
 * The BOREHOLE-anchored bands the OKP pool may read, out of a scope's bands.
 *
 * The sibling of ``unitCptBands`` with the anchor flipped. The SCOPE selection
 * (unit / body / class) is ``bandsForScope`` — the single authority — so this
 * applies only the two population filters that stay per spec §3: accepted-only
 * (defensive) and borehole-anchored-only, plus (when given) the member set —
 * R6's pooling population, so off-section, hidden and removed holes contribute
 * nothing.
 *
 * Parameters
 * ----------
 * scopeBands
 *     The scope's bands from ``bandsForScope`` (already selected, accepted).
 * memberInvestigationIds
 *     The pooling population, or ``null`` to skip the filter (tests).
 *
 * Returns
 * -------
 * UnitBoreholeBandInterval[]
 *     In arrival order; the pooling does not depend on it.
 */
export function unitBoreholeBands(
  scopeBands: readonly {
    borehole_id: string | null
    depth_top_m: number
    depth_base_m: number
    status: string
  }[],
  memberInvestigationIds: ReadonlySet<string> | null = null,
): UnitBoreholeBandInterval[] {
  const out: UnitBoreholeBandInterval[] = []
  for (const layer of scopeBands) {
    if (layer.status !== 'accepted') continue
    if (layer.borehole_id === null) continue
    if (memberInvestigationIds !== null && !memberInvestigationIds.has(layer.borehole_id))
      continue
    out.push({
      boreholeId: layer.borehole_id,
      topDepthM: layer.depth_top_m,
      baseDepthM: layer.depth_base_m,
    })
  }
  return out
}

/**
 * Whether a sample's midpoint falls inside a band.
 *
 * HALF-OPEN ``[top, base)`` — the same rule ``unitStatistics.depthInBand``
 * uses, for the same reason: bands are gap-free, so a closed interval would
 * claim a contact-straddling sample for both neighbours.
 *
 * Exported for ``unitPsd.ts`` — the grain-size curves pool by the SAME rule
 * (owner ruling S5, 2026-08-27), and two copies of the rule would drift.
 */
export function midpointInBand(midM: number, band: UnitBoreholeBandInterval): boolean {
  return midM >= band.topDepthM && midM < band.baseDepthM
}

/** The typed lab-test families, in display order, each yielding (key, label, unit, values). */
function typedFamilyValues(
  sample: SampleResponse,
): { key: string; label: string; unit: string; value: number }[] {
  const out: { key: string; label: string; unit: string; value: number }[] = []
  for (const t of sample.water_content_tests) {
    if (t.content_pct !== null) {
      out.push({ key: 'typed:water_content', label: 'Water content', unit: '%', value: t.content_pct })
    }
  }
  for (const t of sample.atterberg_limits_tests) {
    if (t.liquid_limit_pct !== null) {
      out.push({ key: 'typed:liquid_limit', label: 'Liquid limit', unit: '%', value: t.liquid_limit_pct })
    }
    if (t.plastic_limit_pct !== null) {
      out.push({ key: 'typed:plastic_limit', label: 'Plastic limit', unit: '%', value: t.plastic_limit_pct })
    }
  }
  for (const t of sample.caco3_content_tests) {
    if (t.content_pct !== null) {
      out.push({ key: 'typed:caco3', label: 'Calcium carbonate (CaCO₃)', unit: '%', value: t.content_pct })
    }
  }
  for (const t of sample.organic_content_tests) {
    if (t.carbon_pct !== null) {
      out.push({ key: 'typed:organic_carbon', label: 'Organic carbon', unit: '%', value: t.carbon_pct })
    }
    if (t.matter_pct !== null) {
      out.push({ key: 'typed:organic_matter', label: 'Organic matter content', unit: '%', value: t.matter_pct })
    }
  }
  return out
}

/** Display rank: typed families keep their fixed order, scalars follow by label. */
const TYPED_ORDER = [
  'typed:water_content',
  'typed:liquid_limit',
  'typed:plastic_limit',
  'typed:caco3',
  'typed:organic_carbon',
  'typed:organic_matter',
]

/**
 * Pool every numeric identification value inside the unit's borehole bands.
 *
 * Parameters
 * ----------
 * bands
 *     The unit's borehole bands (already member-filtered by the caller).
 * detailsByBorehole
 *     Full borehole trees per id; a band whose hole is absent contributes
 *     nothing (the batch may not have landed yet).
 *
 * Returns
 * -------
 * IdentificationPool
 *     Only parameters with at least one value — no empty jars (the owner's
 *     standing rule) — plus the count of samples no mTAW could be given.
 */
export function poolIdentificationPanels(
  bands: readonly UnitBoreholeBandInterval[],
  detailsByBorehole: ReadonlyMap<string, BoreholeDetailResponse>,
): IdentificationPool {
  const bandsByBorehole = new Map<string, UnitBoreholeBandInterval[]>()
  for (const band of bands) {
    const existing = bandsByBorehole.get(band.boreholeId)
    if (existing === undefined) bandsByBorehole.set(band.boreholeId, [band])
    else existing.push(band)
  }

  const panelsByKey = new Map<string, IdentificationPanel>()
  let skippedNoElevation = 0

  const push = (
    key: string,
    label: string,
    rawParameter: string | null,
    unit: string | null,
    point: IdentificationPoint,
  ): void => {
    let panel = panelsByKey.get(key)
    if (panel === undefined) {
      panel = { key, label, rawParameter, unit, points: [] }
      panelsByKey.set(key, panel)
    }
    panel.points.push(point)
  }

  for (const [boreholeId, holeBands] of bandsByBorehole) {
    const bh = detailsByBorehole.get(boreholeId)
    if (bh === undefined) continue
    for (const sample of bh.samples) {
      const midM = (sample.depth_top_m + sample.depth_base_m) / 2
      if (!holeBands.some(band => midpointInBand(midM, band))) continue
      // The borelog's conversion: mTAW = collar elevation − depth.
      if (bh.elevation_m === null) {
        // Only count a skip when the sample actually carries a value we
        // would have plotted — a value-less sample loses nothing.
        const hasValue =
          typedFamilyValues(sample).length > 0 ||
          sample.scalar_lab_tests.some(t => t.value_numeric !== null)
        if (hasValue) skippedNoElevation += 1
        continue
      }
      const elevationM = bh.elevation_m - midM
      const base: Omit<IdentificationPoint, 'value'> = {
        elevationM,
        sampleId: sample.id,
        boreholeName: bh.name,
        sampleNumber: sample.sample_number,
      }
      for (const v of typedFamilyValues(sample)) {
        push(v.key, v.label, null, v.unit, { ...base, value: v.value })
      }
      for (const t of sample.scalar_lab_tests) {
        // Non-numeric values (ASTM codes, descriptive calcareous classes)
        // have no place on a value axis; grain-size curves never reach here
        // at all (they live on ``sample.grain_sizes``, deliberately unread).
        if (t.value_numeric === null || !Number.isFinite(t.value_numeric)) continue
        push(`scalar:${t.parameter}`, labelForParameter(t.parameter), t.parameter, t.unit, {
          ...base,
          value: t.value_numeric,
        })
      }
    }
  }

  const panels = Array.from(panelsByKey.values()).sort((a, b) => {
    const ra = TYPED_ORDER.indexOf(a.key)
    const rb = TYPED_ORDER.indexOf(b.key)
    if (ra !== -1 || rb !== -1) {
      return (ra === -1 ? TYPED_ORDER.length : ra) - (rb === -1 ? TYPED_ORDER.length : rb)
    }
    return a.label.localeCompare(b.label)
  })

  return { panels, skippedNoElevation }
}
