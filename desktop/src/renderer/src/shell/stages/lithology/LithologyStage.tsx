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

import { Rows3, RefreshCw, Box, Download } from 'lucide-react'

import type { StageDescriptor, StageSummary } from '../../StageDescriptor'
import { useShell } from '../../ShellContext'
import LithologyCanvas, {
  resetLithoCameraCallback,
  resetLithoSplitViewportCallback,
  lithoVoxelRequestCallback,
} from './LithologyCanvas'
import LithologyInspector from './LithologyInspector'
import { ToolbarButton } from '../../ToolbarPrimitives'
import VoxelBuildProgressInline from '../../../components/VoxelBuildProgressInline'
import { useT } from '../../../i18n/translate'

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
      hasStaleLithoSolid,
      hasLithoSolids,
      startLithoBuild,
      cancelLithoBuild,
      voxelBuildState,
    },
    sections: { selectedSectionId },
    coordinator: { setExportDeepLinkTarget },
  } = useShell()
  // Unconditional hook — above the ``!activeLithoModel`` early return.
  const t = useT()

  if (!activeLithoModel) return null

  // Gate Build model on contact presence: with zero contacts the solids
  // builder has nothing to work with. The tooltip directs to the
  // cross-section view as the place to accept contacts first.
  const hasLithoContacts = lithoContacts.length > 0

  // While a background build job runs, the Build button becomes an inline
  // progress bar with a Cancel (debt #282).
  const building = voxelBuildState.status === 'running'
  const buildModelLabel = hasStaleLithoSolid ? t('litho.buildModelStale') : t('litho.buildModel')

  return (
    <>
      {building ? (
        <VoxelBuildProgressInline state={voxelBuildState} onCancel={cancelLithoBuild} />
      ) : (
        /* Single "Build model" button — starts the streaming build job.
           Amber badge mirrors GeologyToolbar stale-count convention (debt #55).
           Gated on contact presence so the button is never a confusing no-op. */
        <ToolbarButton
          icon={<Box size={13} />}
          label={buildModelLabel}
          // Route Build through the VOXEL streaming path: the canvas-populated
          // module ref assembles the per-section partition payload (the source of
          // truth); startLithoBuild runs it as a cancellable background job.
          onClick={() => void startLithoBuild(lithoVoxelRequestCallback.current ?? undefined)}
          disabled={!hasLithoContacts}
          amber={hasStaleLithoSolid && hasLithoContacts}
          testid="litho-build-model-button"
          title={
            !hasLithoContacts
              ? t('litho.buildNoContacts')
              : hasStaleLithoSolid
                ? t('litho.solidsStale')
                : t('litho.buildSolidsTitle')
          }
        />
      )}
      {/* Export… — jumps to the Export hub (installer #35: the Export stage is
          the only export surface). Offered once solids exist, because the fence
          DXF (the litho stage's export) needs a built model; the hub's fence card
          then writes it. */}
      {hasLithoSolids && (
        <ToolbarButton
          icon={<Download size={13} />}
          label={t('sections.toolbar.export')}
          onClick={() =>
            setExportDeepLinkTarget?.({
              sectionId: selectedSectionId ?? null,
              axis: 'lithostratigraphic',
            })
          }
          testid="litho-export-fence-button"
          title={t('litho.exportHubHint')}
        />
      )}
      {hasLithoSolids && (
        <ToolbarButton
          icon={<RefreshCw size={13} />}
          label={t('litho.resetCamera')}
          onClick={() => {
            // Collapse split viewport (if active) then fly to model bounds —
            // mirrors GeologyToolbar's two-step Reset behaviour.
            resetLithoSplitViewportCallback.current?.()
            resetLithoCameraCallback.current?.()
          }}
          title={t('litho.resetCameraHint')}
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
 *     Stratigraphy stage badge (``visibleFormations.length``) so every spine
 *     badge consistently counts that stage's content, not containers.
 *     An empty/new litho model (nothing drawn yet) → no badge.
 */
function useLithologyStageSummary(): StageSummary {
  const {
    geoModel: { lithoFormations, hasStaleLithoSolid },
  } = useShell()
  const t = useT()
  const count = lithoFormations.length
  // STALENESS OUTRANKS THE COUNT (owner, 2026-08-10). The Build button already says
  // stale, but only once you are standing on this stage — and the edit that stales the
  // 3-D model is usually made somewhere else: dragging a contact on the GEOTECH axis
  // moves a litho boundary, so the model you are not looking at is the one that went
  // out of date. The badge is how a stage reports work without being opened.
  //
  // It borrows the badge rather than adding a second mark: two indicators on one 20px
  // button is how a spine stops being readable. The count comes back the moment the
  // model is rebuilt.
  if (hasStaleLithoSolid) {
    // "!" and not "stale": the spine truncates any badge over 4 characters to an
    // ellipsis, so the word would have rendered as "…" and said nothing. The WORD goes
    // in the label, which is the button's tooltip and its accessible name.
    return {
      label: t('litho.unitsStale'),
      badge: '!',
      badgeIntent: 'amber',
    }
  }
  return {
    label: t('litho.units'),
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
