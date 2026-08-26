// Geotechnical stage toolbar — "Build model" + "Reset camera".
//
// Direct mirror of LithologyToolbar, scoped to the GEOTECH model: the same
// single "Build model" verb POSTs the geotech voxel partition payload to the
// model-agnostic voxel builder (buildGeotechSolids), and a "Reset camera"
// button appears once geotech solids exist.
//
// WHY this lives here (not in the SectionsToolbar geotech branch): the Build
// path needs the per-section partition payload assembled by GeotechnicalCanvas
// (the geotechVoxelRequestCallback module ref). GeotechnicalToolbar and
// GeotechnicalCanvas are BOTH mounted on the Geotechnical stage — exactly like
// LithologyToolbar + LithologyCanvas — so the ref is always populated when
// Build is clicked. SectionsToolbar renders on the SECTIONS stage, where
// GeotechnicalCanvas is not mounted, so a Build button there would never have
// the callback and would be a permanent no-op. The 2D editing verbs (Subdivide
// all bodies / Correlate packing) stay in the SectionsToolbar geotech branch.

import { Box, RefreshCw } from 'lucide-react'

import { useShell } from '../../ShellContext'
import { ToolbarButton } from '../../ToolbarPrimitives'
import {
  resetGeotechCameraCallback,
  resetGeotechSplitViewportCallback,
  geotechVoxelRequestCallback,
} from './GeotechnicalCanvas'

/**
 * Toolbar for the Geotechnical stage.
 *
 * Renders a single "Build model" button (shown once a geotech model exists)
 * that builds the watertight 3-D NAD body solids from the geotech partition,
 * and a "Reset camera" button when at least one geotech solid has been built.
 *
 * Returns
 * -------
 * JSX.Element | null
 *     The toolbar button group, or null when no geotech model is active yet
 *     (run "Subdivide all bodies" on the Sections stage first).
 */
export default function GeotechnicalToolbar(): JSX.Element | null {
  const {
    geoModel: {
      activeGeotechModel,
      geotechLayers,
      geotechSolidsBuilding,
      hasStaleGeotechSolid,
      hasGeotechSolids,
      buildGeotechSolids,
    },
  } = useShell()

  // No geotech model yet → nothing to build. "Subdivide all bodies" (the
  // SectionsToolbar geotech verb) creates the model first.
  if (!activeGeotechModel) return null

  // Gate Build on geotech band presence: with zero geotech layers the voxel
  // builder has nothing to project. The tooltip directs to the Sections stage.
  const hasGeotechBands = geotechLayers.length > 0

  const buildModelLabel = geotechSolidsBuilding
    ? 'Building…'
    : hasStaleGeotechSolid
      ? 'Build model · stale'
      : 'Build model'

  return (
    <>
      {/* Single "Build model" button — calls buildGeotechSolids directly with
          the canvas-populated voxel-request builder. Amber badge mirrors the
          litho stale-count convention. Gated on geotech band presence so the
          button is never a confusing no-op. */}
      <ToolbarButton
        icon={<Box size={13} />}
        label={buildModelLabel}
        onClick={() => void buildGeotechSolids(geotechVoxelRequestCallback.current ?? undefined)}
        disabled={geotechSolidsBuilding || !hasGeotechBands}
        busy={geotechSolidsBuilding}
        amber={hasStaleGeotechSolid && hasGeotechBands}
        testid="geotech-build-model-button"
        title={
          !hasGeotechBands
            ? 'No geotech bands yet — run "Subdivide all bodies" on the Sections stage (geotech axis) first, then Build'
            : geotechSolidsBuilding
              ? 'Building watertight NAD body solids…'
              : hasStaleGeotechSolid
                ? 'One or more geotech body solids are stale — click to rebuild'
                : 'Build the 3-D NAD body solids from the geotech partition'
        }
      />
      {hasGeotechSolids && (
        <ToolbarButton
          icon={<RefreshCw size={13} />}
          label="Reset camera"
          onClick={() => {
            // Collapse split viewport (if active) then fly to model bounds —
            // mirrors LithologyToolbar's two-step Reset behaviour.
            resetGeotechSplitViewportCallback.current?.()
            resetGeotechCameraCallback.current?.()
          }}
          title="Collapse any split view and fly the camera back to the model extent"
        />
      )}
    </>
  )
}
