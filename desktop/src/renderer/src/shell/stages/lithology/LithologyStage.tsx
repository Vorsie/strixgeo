// Lithology stage descriptor (#55 peer-stage scaffolding — Slice D).
//
// The lithostratigraphic model refines the geological backbone and is
// itself refined into the geotechnical (NAD) model — so it sits
// between them on the spine. This stage is the model-management +
// 3D-view surface; the actual contact editing happens on the Sections
// stage scoped to the active litho model.
//
// LithologyToolbar: Build litho (moved from SectionsToolbar in Phase 1
// accept flow) + Reset Camera when built litho surfaces exist.
// Build litho triggers handleRebuildLithoSurfaces which runs Delaunay
// on all litho contacts for the active lithostratigraphic model.
// The stale surface count badge mirrors the geological Build button.
//
// Split-viewport wiring added 2026-06-01 (debt #64 resolved):
// resetLithoSplitViewportCallback mirrors GeologyCanvas's
// resetSplitViewportCallback — the toolbar Reset button collapses the
// split back to a single viewport.

import { useState } from 'react'
import { Rows3, RefreshCw, Cpu } from 'lucide-react'

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
 * Renders a "Build litho" button (always shown when a litho model is
 * active) and a "Reset camera" button when at least one built litho
 * surface exists.  Build litho was moved here from SectionsToolbar in
 * Phase 1 of the accept flow so it lives with the model-management
 * surface rather than the section-editing surface.
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
      lithoStaleSurfaceCount,
      handleRebuildLithoSurfaces,
    },
  } = useShell()

  const [rebuilding, setRebuilding] = useState(false)

  const hasLithoSurfaces = Array.from(lithoSurfacesByFormationId.values()).some(
    s => s.vertices.length > 0,
  )

  if (!activeLithoModel) return null

  // Debt #94: gate Build litho on contact presence. With zero contacts
  // in the active litho model the Delaunay pass has nothing to
  // triangulate; clicking the button is a no-op that confuses dogfeed
  // users. The tooltip directs to the cross-section view as the place
  // to place contacts (Suggest litho / manual pick).
  const hasLithoContacts = lithoContacts.length > 0

  const buildLabel =
    rebuilding
      ? 'Building…'
      : lithoStaleSurfaceCount > 0
        ? `Build litho · ${lithoStaleSurfaceCount} stale`
        : 'Build litho'

  async function handleBuild(): Promise<void> {
    if (rebuilding) return
    setRebuilding(true)
    try {
      await handleRebuildLithoSurfaces()
    } finally {
      setRebuilding(false)
    }
  }

  return (
    <>
      <ToolbarButton
        icon={<Cpu size={13} />}
        label={buildLabel}
        onClick={() => void handleBuild()}
        disabled={rebuilding || !hasLithoContacts}
        busy={rebuilding}
        // Amber tint mirrors GeologyToolbar stale-count convention (debt #55).
        amber={lithoStaleSurfaceCount > 0 && hasLithoContacts}
        title={
          !hasLithoContacts
            ? 'No litho contacts yet — open a cross-section on the litho axis, Suggest litho, accept the layers, then return here to Build'
            : rebuilding
              ? 'Running Delaunay triangulation on litho contacts…'
              : lithoStaleSurfaceCount > 0
                ? `${lithoStaleSurfaceCount} litho surface(s) need rebuilding — click to update`
                : 'Rebuild 3D lithostratigraphic surfaces from all accepted contacts'
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
