// Geotechnical stage canvas placeholder — the next milestone after the
// lithostratigraphic stage (v1.0 gate step 4, owner rescope 2026-05-18).

import { Layers } from 'lucide-react'

import { EmptyState } from '../../EmptyState'

/**
 * Placeholder canvas for the Geotechnical stage (S6 stub).
 *
 * Uses the shared EmptyState primitive (debt #45) so the placeholder
 * matches the icon + guided-copy bar the rest of the shell holds —
 * a bare "coming soon" line on camera undercut the polish narrative.
 *
 * Returns
 * -------
 * JSX.Element
 *     The guided placeholder.
 */
export default function GeotechnicalCanvas(): JSX.Element {
  return (
    <EmptyState
      icon={<Layers />}
      title="Geotechnical subdivision"
      hint="Subdivide lithostratigraphic units by packing density into NAD classes (1–31) and view CPT-derived indicators (Ic zone, Dr, NAD class, γ-estimate) per unit. This is the next stage to build after the lithostratigraphic model; design-ready parameter values (φ′, c′, cu, E50) stay Phase 5."
    />
  )
}
