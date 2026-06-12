// Lithology stage descriptor (#55 peer-stage scaffolding — Slice D).
//
// The lithostratigraphic model refines the geological backbone and is
// itself refined into the geotechnical (NAD) model — so it sits
// between them on the spine. This stage is the model-management +
// 3D-view surface; the actual contact editing happens on the Sections
// stage scoped to the active litho model.
//
// LithologyToolbar: "Build model" (single button, Task 7 — collapses
// the former "Build litho" TIN-surface button and "Build solids" button
// into one verb that calls buildLithoSolids directly). The TIN-surface
// build (handleRebuildLithoSurfaces) is retired from the UI; it remains
// available in the hook for potential future re-exposure.
// Stale badge mirrors the geological Build button amber-tint convention
// (project_dirty_amber_color.md).
//
// Split-viewport wiring added 2026-06-01 (debt #64 resolved):
// resetLithoSplitViewportCallback mirrors GeologyCanvas's
// resetSplitViewportCallback — the toolbar Reset button collapses the
// split back to a single viewport.

import { Rows3, RefreshCw, Box } from 'lucide-react'

import type { StageDescriptor, StageSummary } from '../../StageDescriptor'
import { useShell } from '../../ShellContext'
import LithologyCanvas, {
  resetLithoCameraCallback,
  resetLithoSplitViewportCallback,
} from './LithologyCanvas'
import LithologyInspector from './LithologyInspector'
import { ToolbarButton } from '../../ToolbarPrimitives'

/**
 * Toolbar for the Lithology stage.
 *
 * Renders a single "Build model" button (always shown when a litho model
 * is active) that builds the watertight 3-D body solids, and a "Reset
 * camera" button when at least one built litho surface exists.
 *
 * The former "Build litho" TIN-surface button has been retired from the
 * UI (Task 7, litho-3D plan). handleRebuildLithoSurfaces remains in the
 * hook for potential future re-exposure but is not called from here.
 *
 * Returns
 * -------
 * JSX.Element | null
 *     The toolbar button group, or null when no litho model is active.
 */
function LithologyToolbar(): JSX.Element | null {
  const {
    geoModel: {
      activeLithoModel,
      lithoContacts,
      lithoSurfacesByFormationId,
      lithoSolidsBuilding,
      hasStaleLithoSolid,
      buildLithoSolids,
    },
  } = useShell()

  const hasLithoSurfaces = Array.from(lithoSurfacesByFormationId.values()).some(
    s => s.vertices.length > 0,
  )

  if (!activeLithoModel) return null

  // Gate Build model on contact presence: with zero contacts the solids
  // builder has nothing to work with. The tooltip directs to the
  // cross-section view as the place to accept contacts first.
  const hasLithoContacts = lithoContacts.length > 0

  const buildModelLabel = lithoSolidsBuilding
    ? 'Building…'
    : hasStaleLithoSolid
      ? 'Build model · stale'
      : 'Build model'

  return (
    <>
      {/* Single "Build model" button — calls buildLithoSolids directly.
          Amber badge mirrors GeologyToolbar stale-count convention (debt #55).
          Gated on contact presence so the button is never a confusing no-op. */}
      <ToolbarButton
        icon={<Box size={13} />}
        label={buildModelLabel}
        onClick={() => void buildLithoSolids()}
        disabled={lithoSolidsBuilding || !hasLithoContacts}
        busy={lithoSolidsBuilding}
        amber={hasStaleLithoSolid && hasLithoContacts}
        testid="litho-build-model-button"
        title={
          !hasLithoContacts
            ? 'No litho contacts yet — open a cross-section on the litho axis, Suggest litho, accept the layers, then return here to Build'
            : lithoSolidsBuilding
              ? 'Building watertight body solids…'
              : hasStaleLithoSolid
                ? 'One or more body solids are stale — click to rebuild'
                : 'Build the 3-D body solids from accepted contacts'
        }
      />
      {hasLithoSurfaces && (
        <ToolbarButton
          icon={<RefreshCw size={13} />}
          label="Reset camera"
          onClick={() => {
            // Collapse split viewport (if active) then fly to model bounds —
            // mirrors GeologyToolbar's two-step Reset behaviour.
            resetLithoSplitViewportCallback.current?.()
            resetLithoCameraCallback.current?.()
          }}
          title="Collapse any split view and fly the camera back to the model extent"
        />
      )}
    </>
  )
}

/**
 * ``useStageSummary`` for the Lithology stage.
 *
 * Returns
 * -------
 * StageSummary
 *     Count of formations in the ACTIVE litho model — mirrors the
 *     Geology stage badge (``visibleFormations.length``) so every spine
 *     badge consistently counts that stage's content, not containers.
 *     An empty/new litho model (nothing drawn yet) → no badge.
 */
function useLithologyStageSummary(): StageSummary {
  const {
    geoModel: { lithoFormations },
  } = useShell()
  const count = lithoFormations.length
  return {
    label: 'Lithology units',
    badge: count > 0 ? String(count) : null,
    badgeIntent: 'neutral',
  }
}

const LithologyStage: StageDescriptor = {
  id: 'lithology',
  // Rows3 (flat stacked beds) — deliberately a different glyph family
  // from Sections' Layers (perspective planes) + Geology's Mountain,
  // so the adjacent spine buttons are unambiguous at 20px
  // (ux-review SF-1).
  icon: Rows3,
  spineLabel: 'Litho',
  useStageSummary: useLithologyStageSummary,
  CanvasComponent: LithologyCanvas,
  ToolbarComponent: LithologyToolbar,
  InspectorComponent: LithologyInspector,
}

export default LithologyStage
