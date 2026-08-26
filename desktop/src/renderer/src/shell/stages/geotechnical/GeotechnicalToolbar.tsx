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
//
// Since 2026-08-26 the press goes through a PRE-FLIGHT
// (``useGeotechBuildPreflight``): a test imported after the packing subdivision
// carries accepted litho and no bands, so the build would frame a gap around it
// with nothing to fill it. On a finished model the pre-flight finds nothing and
// the press is exactly what it always was.

import { Box, RefreshCw } from 'lucide-react'

import { useShell } from '../../ShellContext'
import { ToolbarButton } from '../../ToolbarPrimitives'
import PendingTieChip from '../../../components/sections/PendingTieChip'
import GeotechBuildPreflightDialog from './GeotechBuildPreflightDialog'
import { useGeotechBuildPreflight } from './useGeotechBuildPreflight'
import {
  resetGeotechCameraCallback,
  resetGeotechSplitViewportCallback,
} from './GeotechnicalCanvas'

/**
 * Toolbar for the Geotechnical stage.
 *
 * Renders a single "Build model" button (shown once a geotech model exists)
 * that builds the watertight 3-D NAD body solids from the geotech partition,
 * and a "Reset camera" button when at least one geotech solid has been built.
 *
 * The Build press runs the pre-flight first, and where it finds a test in the
 * model with no packing bands the dialog asks what to do about it. After a
 * "Build without them" an amber chip names what the last build left out, each
 * one a press away.
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
    },
  } = useShell()

  // Above every early return — the hook order must not depend on whether a
  // geotech model exists yet (the TDZ / hook-order rule).
  const preflight = useGeotechBuildPreflight()

  // No geotech model yet → nothing to build. "Subdivide all bodies" (the
  // SectionsToolbar geotech verb) creates the model first.
  if (!activeGeotechModel) return null

  // Gate Build on geotech band presence: with zero geotech layers the voxel
  // builder has nothing to project. The tooltip directs to the Sections stage.
  const hasGeotechBands = geotechLayers.length > 0

  const buildModelLabel = preflight.busy
    ? 'Subdividing…'
    : geotechSolidsBuilding
      ? 'Building…'
      : hasStaleGeotechSolid
        ? 'Build model · stale'
        : 'Build model'

  const excludedCount = preflight.excludedFromLastBuild.length
  const excludedNames = preflight.excludedFromLastBuild.map(t => t.name).join(', ')

  return (
    <>
      {/* Single "Build model" button — runs the pre-flight, which either builds
          straight through or opens the dialog. Amber badge mirrors the litho
          stale-count convention. Gated on geotech band presence so the button
          is never a confusing no-op. */}
      <ToolbarButton
        icon={<Box size={13} />}
        label={buildModelLabel}
        onClick={preflight.pressBuild}
        disabled={geotechSolidsBuilding || preflight.busy || !hasGeotechBands}
        busy={geotechSolidsBuilding || preflight.busy}
        amber={hasStaleGeotechSolid && hasGeotechBands}
        testid="geotech-build-model-button"
        title={
          !hasGeotechBands
            ? 'No geotech bands yet — run "Subdivide all bodies" on the Sections stage (geotech axis) first, then Build'
            : preflight.busy
              ? 'Subdividing the tests that had no packing bands, then building…'
              : geotechSolidsBuilding
                ? 'Building watertight NAD body solids…'
                : hasStaleGeotechSolid
                  ? 'One or more geotech body solids are stale — click to rebuild'
                  : 'Build the 3-D NAD body solids from the geotech partition'
        }
      />
      {/* What the last build deliberately left out. Same chip contract as the
          pending-tie one: it is a real button because it can act, and pressing
          it walks the excluded tests one by one. */}
      {excludedCount > 0 && (
        <PendingTieChip
          testid="geotech-excluded-tests-chip"
          label={`${excludedCount} test${excludedCount === 1 ? '' : 's'} excluded`}
          title={
            `The last build ignored ${excludedNames} — ${excludedCount === 1 ? 'it has' : 'they have'} ` +
            'no packing bands, so the model is the one you had before ' +
            `${excludedCount === 1 ? 'it was' : 'they were'} imported.`
          }
          clickHint="Click to open the next one on a cross-section."
          ariaHint="Activate to open the next excluded test."
          onReveal={preflight.visitNextExcluded}
        />
      )}
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
      <GeotechBuildPreflightDialog
        open={preflight.askingAbout !== null}
        tests={preflight.askingAbout ?? []}
        onVisitTest={preflight.visitTest}
        onSubdivideAndBuild={() => void preflight.subdivideAndBuild()}
        onBuildWithout={preflight.buildWithout}
        onCancel={preflight.cancel}
        busy={preflight.busy}
      />
    </>
  )
}
