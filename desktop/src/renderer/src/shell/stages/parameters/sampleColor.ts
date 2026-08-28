/**
 * One stable colour per lab SAMPLE, shared by every lab-derived panel of the
 * per-unit Parameters stage.
 *
 * Owner ask 2026-08-28, verbatim: *"can we also make the psd the same colour
 * (sieving hydrometer and all dots in the plots above, except for the cpt plots
 * ofcourse)."* — one colour identifies one sample, consistently across the
 * sample's PSD curve (both its sieve and hydrometer portions) and that sample's
 * dots in the scatter / identification panels above it. The CPT-derived plots
 * (qc / fs / Rf) keep their own channel colours and never call this.
 *
 * Keyed on the SAMPLE id, not the series index and not the grain-size-test id:
 * a sample split into two grain-size records (sieve + hydrometer) then draws
 * both curves in the sample's one colour, and that same colour marks the
 * sample's water-content / Atterberg / scalar dots in the panels above.
 *
 * ``UnitPsdPanel`` and ``UnitIdentificationPanels`` both import THIS — a single
 * source of truth, so the two surfaces cannot drift (the house
 * "extract on the second copy" rule). It delegates to the project's existing
 * deterministic ``hashHexColor`` so the colour is stable across renders,
 * reloads and machines, and — because it is a pure function of the one id —
 * unaffected by how the pool is ordered or which other samples are present.
 *
 * @module shell/stages/parameters/sampleColor
 */

import { hashHexColor } from '../../../utils/hashColor'

/**
 * The stable colour for one lab sample.
 *
 * Parameters
 * ----------
 * sampleId : string
 *     The sample's id (``SampleResponse.id``) — the identity every lab-derived
 *     mark of that sample shares.
 *
 * Returns
 * -------
 * string
 *     A ``#rrggbb`` hex colour, deterministic for the id and independent of
 *     any other sample.
 */
export function sampleColor(sampleId: string): string {
  return hashHexColor(sampleId)
}
