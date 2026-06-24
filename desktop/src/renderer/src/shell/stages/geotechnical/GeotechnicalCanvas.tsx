// Geotechnical stage canvas — renders the geotech section view by reusing
// SectionsCanvas with the axis forced to 'geotechnical'.
//
// Bootstrap requirement (F4): "Subdivide all bodies" creates the geotech
// model when none exists, so the toolbar verb must be reachable BEFORE the
// model exists.  The canvas is therefore rendered whenever a litho model
// is present (not gated on activeGeotechModel).  Without a litho model the
// subdivision verb has nothing to subdivide; only then is an EmptyState shown.
//
// Implementation rationale: the Sections stage and the Geotechnical stage
// share the same SectionsCanvas component and the same sectionModelAxis
// piece of ShellContext state.  On mount this canvas forces the axis to
// 'geotechnical' so the user lands in the NAD-coloured band view rather
// than whatever the Sections stage left selected.  The axis is shared, so
// switching back to the Sections stage retains 'geotechnical' until the
// user manually picks Geology or Litho — consistent with the way switching
// between Geology/Litho in the Sections stage persists.

import { useEffect } from 'react'
import { Layers } from 'lucide-react'

import { useShell } from '../../ShellContext'
import { EmptyState } from '../../EmptyState'
import SectionsCanvas from '../sections/SectionsCanvas'

/**
 * Canvas for the Geotechnical stage (S6).
 *
 * Reuses ``SectionsCanvas`` with the section-model axis forced to
 * ``'geotechnical'`` on mount.  The user lands in the NAD-coloured band
 * view; when no bodies have been subdivided yet the section simply shows
 * no geotech bands — the "Subdivide all bodies" toolbar verb is still
 * reachable (it creates the model).
 *
 * An ``EmptyState`` is shown ONLY when no lithostratigraphic model exists,
 * because subdivision requires a litho model as its source.
 *
 * Returns
 * -------
 * JSX.Element
 *     The geotech section view, or a guided placeholder when no litho model.
 */
export default function GeotechnicalCanvas(): JSX.Element {
  const {
    geoModel: { activeLithoModel },
    sections: { sectionModelAxis, setSectionModelAxis },
  } = useShell()

  // Force the section axis to 'geotechnical' on mount (and whenever it has
  // drifted, e.g. after the user switched axes in the Sections stage).
  // Guard: skip the write when already on 'geotechnical' to avoid a
  // spurious re-render / infinite-loop risk.
  useEffect(() => {
    if (sectionModelAxis !== 'geotechnical') {
      setSectionModelAxis('geotechnical')
    }
  }, [sectionModelAxis, setSectionModelAxis])

  // Without a litho model there is nothing to subdivide — the verb would
  // have no parent to work from.  Guide the user to create one first.
  if (activeLithoModel === null) {
    return (
      <EmptyState
        icon={<Layers />}
        title="No lithostratigraphic model yet"
        hint="Create a lithostratigraphic model in the Lithology stage and accept litho suggestions, then return here to run 'Subdivide all bodies'."
      />
    )
  }

  // Render the shared SectionsCanvas — the useEffect above has already
  // set the axis to 'geotechnical'.  When no geotech model exists yet the
  // section renders with no bands (normal first-run state); running
  // "Subdivide all bodies" from the toolbar populates the bands.
  return <SectionsCanvas />
}
