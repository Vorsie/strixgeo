// Fixture builders for the geotech borehole packing-preview tests.
//
// Extracted from GeotechBoreholePreviewGhosts.test.tsx when that file crossed
// the 500-line guardrail (debt #201). They live here rather than inline so the
// overlay test and the toolbar-legend test describe the same world, and so the
// displaced-column shape below has ONE definition — a fixture whose trueX and
// nudgedX agree silently stops pinning the post-nudge geometry rule.

import type { DivideBoreholePreviewColumn, LithoLayerResponse } from '../../api/client'
import type { PlacedColumn } from './utils'

/** Identity level→screen so 1 m = 1 px and depths read directly off the DOM. */
export const levelToScreen = (level: number): number => 100 - level

/**
 * A placed borehole column.
 *
 * Parameters
 * ----------
 * id : string
 *     Investigation id, also used as the display name.
 * along : number
 *     Raw projected distance along the section — the value ``trueX`` and
 *     ``proj.along`` both take.
 * elevationM : number | null
 *     Collar elevation; ``null`` models a borehole with no known collar.
 * nudgedX : number
 *     Where the column is actually DRAWN once column spacing has warped the
 *     layout. Defaults to ``along``; pass something else to get a displaced
 *     column, which is the only shape that can catch an overlay reading
 *     ``trueX`` / ``proj.along`` instead.
 *
 * Returns
 * -------
 * PlacedColumn
 *     The fixture column.
 */
export function boreholeColumn(
  id: string,
  along: number,
  elevationM: number | null = 5,
  nudgedX: number = along,
): PlacedColumn {
  return {
    kind: 'borehole',
    trueX: along,
    nudgedX,
    width: 20,
    displaced: nudgedX !== along,
    proj: {
      along,
      offset: 0,
      item: {
        id,
        name: id,
        test_id: id,
        location_x: 0,
        location_y: 0,
        epsg: 31370,
        elevation_m: elevationM,
        z_epsg: null,
        elevation_source: 'none',
        drill_method: null,
        borehole_type: null,
        total_depth_m: null,
        start_date: null,
        n_drill_segments: null,
        n_field_log_intervals: null,
      },
    },
  } as unknown as PlacedColumn
}

/**
 * A placed CPT column — never ghosted, since only boreholes are left undivided.
 *
 * Parameters
 * ----------
 * id : string
 *     Investigation id.
 * along : number
 *     Projected distance along the section (also the drawn X).
 *
 * Returns
 * -------
 * PlacedColumn
 *     The fixture column.
 */
export function cptColumn(id: string, along: number): PlacedColumn {
  return {
    kind: 'cpt',
    trueX: along,
    nudgedX: along,
    width: 20,
    displaced: false,
    proj: {
      along,
      offset: 0,
      item: {
        id,
        name: id,
        test_id: id,
        location_x: 0,
        location_y: 0,
        epsg: 31370,
        elevation_m: 5,
        z_epsg: null,
        cpt_type: 'CPTU',
        max_depth_m: 10,
      },
    },
  } as unknown as PlacedColumn
}

/**
 * One borehole's planned bands, as the preview endpoint reports them.
 *
 * Parameters
 * ----------
 * boreholeId : string
 *     The borehole the plan is for.
 * bands : object[]
 *     ``{ top, base, nad }`` per band; ``source`` / ``confidence`` default to
 *     the CPT-interpolated, high-confidence case.
 *
 * Returns
 * -------
 * DivideBoreholePreviewColumn
 *     The fixture payload column.
 */
export function previewColumn(
  boreholeId: string,
  bands: { top: number; base: number; nad: number; source?: string; confidence?: string }[],
): DivideBoreholePreviewColumn {
  return {
    borehole_id: boreholeId,
    name: `BH-${boreholeId}`,
    bands: bands.map(b => ({
      depth_top_m: b.top,
      depth_base_m: b.base,
      nad_class: b.nad,
      source: b.source ?? 'cpt_interpolated',
      confidence: b.confidence ?? 'high',
    })),
  }
}

/**
 * A committed geotech band — what makes a borehole count as already divided.
 *
 * Parameters
 * ----------
 * boreholeId : string
 *     The borehole the band is anchored on.
 *
 * Returns
 * -------
 * LithoLayerResponse
 *     The fixture row.
 */
export function committedBand(boreholeId: string): LithoLayerResponse {
  return {
    id: `layer-${boreholeId}`,
    model_id: 'geotech-model',
    formation_id: 'formation-1',
    cpt_id: null,
    borehole_id: boreholeId,
    depth_top_m: 0,
    depth_base_m: 4,
    status: 'accepted',
    source: 'segmenter',
    confidence: 'high',
    body_id: 'body-1',
  } as unknown as LithoLayerResponse
}
