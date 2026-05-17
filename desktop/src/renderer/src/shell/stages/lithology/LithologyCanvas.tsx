// Lithology stage canvas — model-management surface, NOT the editor.
//
// Per the re-scoped #55 (owner directive after dogfeed): the
// lithostratigraphic model is built ON cross-sections, not here. This
// canvas exists so the spine stage has a body; it guides the engineer
// to the Sections stage where the actual contact-picking happens
// (slice 2 adds the geology↔lithology model-axis toggle there). The
// 3D surface viewer for litho TINs lands once litho contacts exist.

import { Layers3 } from 'lucide-react'

import { EmptyState } from '../../EmptyState'

/**
 * Guided placeholder for the Lithology stage canvas.
 *
 * Returns
 * -------
 * JSX.Element
 *     The guidance empty-state.
 */
export default function LithologyCanvas(): JSX.Element {
  return (
    <EmptyState
      icon={<Layers3 />}
      title="Lithostratigraphic model"
      hint="Select or create a lithology model in the right panel. To place contacts, open the Sections stage and draw them there — lithostratigraphic contacts are always placed in the context of a cross-section. Once placed and built, the 3D surfaces appear here."
    />
  )
}
