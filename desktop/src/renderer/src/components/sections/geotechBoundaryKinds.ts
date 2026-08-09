/**
 * Which drawn boundaries on the geotech axis are LOCKED litho contacts.
 *
 * The geotech axis stacks two kinds of horizontal line and they are NOT interchangeable:
 * a boundary between two packing bands that share a litho parent is the engineer's own
 * subdivision and can be dragged freely, while a boundary whose bands sit in different
 * litho units restates a lithostratigraphic contact — ruling 2 forbids moving it AS a
 * packing boundary, and it is instead dragged as the contact it is (§4c).
 *
 * Drawn identically, a correct refusal reads as a broken app: measured on the owner's
 * model, one column carries 17 internal boundaries of which only 3 are the draggable
 * kind, and he reached for the locked ones twice in ten minutes. The renderer therefore
 * has to draw the two kinds differently, and to do that it needs one flat answer per
 * drawn contact — which is what this produces.
 *
 * Pure — no React, no network.
 */

import type { LithoLayerResponse } from '../../api/client'
import { boundaryRestatesLithoContact, columnBands } from './geotechBandEdit'

/** The layer fields this module reads — the geotech rows AND the litho rows share it. */
type LayerRow = Pick<
  LithoLayerResponse,
  'id' | 'formation_id' | 'cpt_id' | 'borehole_id' | 'depth_top_m' | 'depth_base_m'
>

/**
 * Collect the geotech bands whose TOP boundary restates a lithostratigraphic contact.
 *
 * Parameters
 * ----------
 * geotechLayers : readonly LayerRow[]
 *     Every packing band drawn on the section, any column, any order.
 * lithoLayers : readonly LayerRow[]
 *     Every accepted litho layer, any column, any order. Each column is judged against
 *     its OWN stack: two columns can carry bands at identical depths and disagree about
 *     whether a boundary crosses a litho unit, so reading a neighbour's stack would
 *     invert the verdict rather than approximate it.
 *
 * Returns
 * -------
 * Set<string>
 *     The ids of bands whose top IS a restated litho contact. Keyed by the band BELOW
 *     the boundary because that is what a contact is — the top of the band beneath it —
 *     and it keeps this in step with the ids the drag hit strip and the band-edit
 *     boundary strips already use. The shallowest band on a column is never included:
 *     its top is where the sounding starts, not a boundary between two bands.
 */
export function restatingContactIds(
  geotechLayers: readonly LayerRow[],
  lithoLayers: readonly LayerRow[],
): Set<string> {
  const out = new Set<string>()
  const columnIds = new Set<string>()
  for (const row of geotechLayers) {
    const anchor = row.cpt_id ?? row.borehole_id
    if (anchor !== null && anchor !== undefined) columnIds.add(anchor)
  }
  for (const anchor of columnIds) {
    // ``columnBands`` filters to the column AND sorts by depth — the endpoint gives no
    // ordering guarantee, and pairing unsorted rows would compare non-neighbours.
    const bands = columnBands(geotechLayers, anchor)
    const bodies = columnBands(lithoLayers, anchor).map(b => ({
      topDepthM: b.topDepthM,
      baseDepthM: b.baseDepthM,
    }))
    for (let i = 0; i < bands.length - 1; i += 1) {
      if (boundaryRestatesLithoContact(bands[i], bands[i + 1], bodies)) {
        out.add(bands[i + 1].layerId)
      }
    }
  }
  return out
}
