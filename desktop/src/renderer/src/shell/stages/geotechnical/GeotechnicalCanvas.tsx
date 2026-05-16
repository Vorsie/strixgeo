// Geotechnical stage canvas placeholder — Phase 5.

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
      hint="Split geological formations into geotechnical units with their own parameter sets. This stage lands in a later phase — the geological model + cross-sections are the v1 focus."
    />
  )
}
