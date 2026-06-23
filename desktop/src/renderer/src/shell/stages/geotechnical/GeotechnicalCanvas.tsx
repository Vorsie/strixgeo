// Geotechnical stage canvas — renders the geotech section view by reusing
// SectionsCanvas with the axis forced to 'geotechnical'.  When no geotech
// model exists yet (the user hasn't run "Subdivide all bodies") a guided
// EmptyState is shown instead.
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
 * ``'geotechnical'`` on mount, so the owner finds NAD-coloured body
 * bands under the Geotechnical spine stage where they expect them.
 *
 * When no geotechnical model exists (``activeGeotechModel === null``),
 * a short guided ``EmptyState`` explains that "Subdivide all bodies"
 * must be run first in the Geotech inspector.
 *
 * Returns
 * -------
 * JSX.Element
 *     Either the geotech section view or a guided placeholder.
 */
export default function GeotechnicalCanvas(): JSX.Element {
  const {
    geoModel: { activeGeotechModel },
    sections: { sectionModelAxis, setSectionModelAxis },
  } = useShell()

  // Force the section axis to 'geotechnical' when the canvas mounts and
  // a geotech model exists.  Guards:
  //   • activeGeotechModel === null → no model yet, show EmptyState instead.
  //   • sectionModelAxis already 'geotechnical' → skip the write to avoid
  //     a spurious render / infinite-loop risk.
  useEffect(() => {
    if (activeGeotechModel !== null && sectionModelAxis !== 'geotechnical') {
      setSectionModelAxis('geotechnical')
    }
  }, [activeGeotechModel, sectionModelAxis, setSectionModelAxis])

  if (activeGeotechModel === null) {
    return (
      <EmptyState
        icon={<Layers />}
        title="No geotechnical model yet"
        hint="Run 'Subdivide all bodies' in the Geotech inspector to derive NAD packing classes (1–31) from the CPT series. The section view here will then colour each body band by its packing class."
      />
    )
  }

  // Render the shared SectionsCanvas — the useEffect above has already
  // set the axis to 'geotechnical', so SectionsCanvas will pass
  // axisMode='geotechnical' into SectionPanel and render NAD bands.
  return <SectionsCanvas />
}
