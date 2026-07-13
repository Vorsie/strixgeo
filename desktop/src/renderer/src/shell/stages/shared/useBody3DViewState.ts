// Shared 3D body-view plumbing for the Geology / Lithology / Geotechnical
// stage canvases.
//
// Extracted per audit 2026-07-12 FE-SHELL-CLIENTS-10: GeotechnicalCanvas was a
// ~350-line admitted-verbatim copy of LithologyCanvas, and GeologyCanvas
// carried a third copy of the split-state + ground-surface blocks. This hook
// owns the blocks that were byte-equal modulo identifiers:
//
//   • Solid/Fence view mode + wireframe + fence-loading state (session-ephemeral)
//   • split-viewport state (splitMode / splitPlane / splitLine) + the
//     handleSplitPlaneDrawn / exitSplit pair, and populating the stage's
//     module-level reset-split ref so the toolbar Reset verb can collapse the
//     split without a bus extension
//   • the fire-and-forget ground-surface TIN fetch scoped to the model id
//   • the lazy per-section approved-correlation-edge fetch for Fence mode
//   • the investigations / investigationXY memos (fence + voxel + fade inputs)
//   • the fenceSectionInputs / fencePanels memos
//   • nulling the stage's voxel-request ref on unmount (closes the async
//     stale-fire window — the voxel builder fans out per-section fetches)
//
// The Geology stage uses only the split-state + ground-surface blocks: it
// passes ``fenceActive: false`` and omits ``layers`` / ``voxelRequestRef``,
// which leaves the fence machinery inert (the fence effect early-returns and
// ``fencePanels`` stays undefined).
//
// All hooks here are unconditional so the call order is stable regardless of
// which canvas mounts the hook (the hook-order rule).

import * as Cesium from 'cesium'
import { useEffect, useMemo, useState } from 'react'

import { api } from '../../../api/client'
import type { GroundSurfaceBuildResponse } from '../../../api/client'
import { useShell } from '../../ShellContext'
import type { SplitMode, SplitLine } from '../geology/Geology3DViewer'
import {
  buildProjectFence,
  type FenceSectionInput,
} from '../../../utils/buildProjectFence'
import type { FencePanel } from '../../../utils/fencePanels'
import {
  assembleLithoSectionInputs,
  type InvestigationLocation,
  type LithoLayerLike,
} from '../../../utils/assembleLithoSectionInputs'
import type { VoxelBuildRequest } from '../../../utils/buildVoxelRequest'
import {
  fetchApprovedEdgesBySection,
  type ApprovedEdgePair,
} from './fetchApprovedEdgesBySection'

// ---------------------------------------------------------------------------
// Stable empty surfaces map — always passed to Geology3DViewer on the litho /
// geotech panes so TIN sheets are never rendered there.  The Surfaces legend
// toggle and draw loop in Geology3DViewer are both gated on the map having
// vertices, so an empty map suppresses both without touching the shared
// viewer.  The geology pane passes its own real surfaces map and is
// unaffected.  Module-level so the reference is identity-stable across
// renders.
// ---------------------------------------------------------------------------

export const EMPTY_SURFACES_MAP: ReadonlyMap<string, never> = new Map<string, never>()

/** Stable empty layer list for canvases that never build a fence (Geology). */
const NO_LAYERS: readonly LithoLayerLike[] = []

/** Options for ``useBody3DViewState``. */
export interface UseBody3DViewStateOptions {
  /** Active model id (litho / geotech / geological), or null when absent. */
  modelId: string | null
  /**
   * The model's litho-layer rows feeding the fence / voxel assembly.
   * Omit on canvases that never build a fence (Geology).
   */
  layers?: readonly LithoLayerLike[]
  /**
   * Module-level reset-split ref shared with the stage toolbar; populated
   * every render with ``exitSplit`` while the canvas is mounted.
   */
  resetSplitViewportRef: React.MutableRefObject<(() => void) | null>
  /**
   * Module-level voxel-request ref shared with the stage toolbar; nulled on
   * unmount here (assignment happens in the canvas, which owns the builder).
   */
  voxelRequestRef?: React.MutableRefObject<(() => Promise<VoxelBuildRequest | null>) | null>
  /**
   * Extra gate ANDed into the fence-edge fetch + panel build.  Geotech passes
   * ``dimension === '3d'`` (its fence only exists in 3D mode); Geology passes
   * ``false`` (no fence machinery at all).  Defaults to ``true`` (Lithology).
   */
  fenceActive?: boolean
}

/** State + derived values returned by ``useBody3DViewState``. */
export interface Body3DViewState {
  /** The app project id, or null when no project is open. */
  projectId: string | null
  /** Solid/Fence view sub-mode — session-ephemeral, not persisted. */
  viewMode: 'solid' | 'fence'
  setViewMode: React.Dispatch<React.SetStateAction<'solid' | 'fence'>>
  /** Wireframe render of the body solids — Solid mode only. */
  wireframe: boolean
  setWireframe: React.Dispatch<React.SetStateAction<boolean>>
  /** True while the per-section edge fetches are in flight (Fence mode). */
  fenceLoading: boolean
  /** Split-viewport state — session-ephemeral. */
  splitMode: SplitMode
  splitPlane: Cesium.Plane | null
  splitLine: SplitLine | null
  /** Store the drawn split plane/line and enter split mode. */
  handleSplitPlaneDrawn: (plane: Cesium.Plane, line: SplitLine) => void
  /** Collapse the split viewport back to single-viewport mode. */
  exitSplit: () => void
  /** Ground-surface TIN for the model, or null (no model / DEM unavailable). */
  groundSurface: GroundSurfaceBuildResponse | null
  /** All visible CPTs + boreholes in the projection shape. */
  investigations: InvestigationLocation[]
  /** Investigation (x, y) positions — the confidence-fade distance metric. */
  investigationXY: [number, number][]
  /** Fence panels (Fence mode only; undefined in Solid mode / when inactive). */
  fencePanels: FencePanel[] | undefined
}

/**
 * Own the 3D body-view state shared by the stage canvases.
 *
 * Parameters
 * ----------
 * options : UseBody3DViewStateOptions
 *     Model id, layer rows, module refs and the fence gate (see the interface
 *     docs above).
 *
 * Returns
 * -------
 * Body3DViewState
 *     View-mode / split / ground-surface state plus the fence-derived memos.
 */
export function useBody3DViewState(options: UseBody3DViewStateOptions): Body3DViewState {
  const {
    modelId,
    layers = NO_LAYERS,
    resetSplitViewportRef,
    voxelRequestRef,
    fenceActive = true,
  } = options

  const {
    project,
    visibleCpts,
    visibleBoreholes,
    sections: { visibleSections },
  } = useShell()

  const projectId = project?.id ?? null

  // -------------------------------------------------------------------------
  // Fence / Solid view toggle + wireframe — session-ephemeral, not persisted.
  // -------------------------------------------------------------------------

  const [viewMode, setViewMode] = useState<'solid' | 'fence'>('solid')
  const [wireframe, setWireframe] = useState(false)

  // True while the per-section edge fetches are in flight (Fence mode only).
  // Drives the loading spinner on the Fence button and the disabled state of
  // both toggle buttons so the user cannot switch during an in-flight fetch.
  const [fenceLoading, setFenceLoading] = useState(false)

  // -------------------------------------------------------------------------
  // Split-viewport state — session-ephemeral, not persisted to the bundle.
  // -------------------------------------------------------------------------

  const [splitMode, setSplitMode] = useState<SplitMode>('single')
  const [splitPlane, setSplitPlane] = useState<Cesium.Plane | null>(null)
  const [splitLine, setSplitLine] = useState<SplitLine | null>(null)

  function handleSplitPlaneDrawn(plane: Cesium.Plane, line: SplitLine): void {
    setSplitPlane(plane)
    setSplitLine(line)
    setSplitMode('split')
  }

  function exitSplit(): void {
    setSplitMode('single')
    setSplitPlane(null)
    setSplitLine(null)
  }

  // Exposed so the stage toolbar Reset can collapse the split without a bus
  // extension — populated every render while the canvas is mounted.
  resetSplitViewportRef.current = exitSplit

  // -------------------------------------------------------------------------
  // Ground-surface TIN scoped to the active model.  Fire-and-forget,
  // session-local (not persisted to the bundle).  Null when no model or DEM
  // unavailable.
  // -------------------------------------------------------------------------

  const [groundSurface, setGroundSurface] = useState<GroundSurfaceBuildResponse | null>(null)

  useEffect(() => {
    if (!projectId || !modelId) {
      setGroundSurface(null)
      return
    }
    let cancelled = false

    api.geology
      .buildGroundSurface(projectId, modelId)
      .then(result => {
        if (!cancelled) setGroundSurface(result)
      })
      .catch(() => {
        // DEM provider unavailable or network error — flat ellipsoid fallback.
        if (!cancelled) setGroundSurface(null)
      })

    return () => {
      cancelled = true
    }
    // Key on stable id strings; the DEM fetch does not depend on surface
    // staleness (a server refresh returning a new model object with the same
    // id must not re-fire it).
  }, [projectId, modelId])

  // -------------------------------------------------------------------------
  // Per-section approved correlation edges — fetched lazily when Fence mode
  // is active.
  //
  // WHY: edges are section-scoped (each edge row carries a section_id — owner
  // directive 2026-06-08).  Each section's edges are fetched in parallel so
  // the fence build gets only the edges authored on that section.  The fetch
  // fires whenever viewMode switches to 'fence', the model changes, or the
  // section list changes.  In Solid mode (or when fenceActive is false) the
  // effect early-returns immediately, so no fetch fires.
  // -------------------------------------------------------------------------

  const [approvedEdgesBySectionId, setApprovedEdgesBySectionId] = useState<
    Map<string, ApprovedEdgePair[]>
  >(new Map())

  useEffect(() => {
    if (!projectId || !modelId || !fenceActive || viewMode !== 'fence') {
      return
    }
    if (visibleSections.length === 0) {
      setApprovedEdgesBySectionId(new Map())
      return
    }
    let cancelled = false

    setFenceLoading(true)
    void fetchApprovedEdgesBySection(projectId, modelId, visibleSections).then(result => {
      if (cancelled) return
      setApprovedEdgesBySectionId(result.edgesBySectionId)
      setFenceLoading(false)
    })

    return () => {
      cancelled = true
      // Clear the loading flag on cleanup so a stale fetch never leaves
      // the buttons permanently disabled when the effect re-fires.
      setFenceLoading(false)
    }
  }, [projectId, modelId, fenceActive, viewMode, visibleSections])

  // Null the voxel-build ref on unmount.  Unlike the synchronous reset
  // callbacks, the voxel builder is async (it fans out per-section edge
  // fetches), so a stale callback could in principle be invoked after the
  // canvas unmounts / the model switches — clearing it on unmount closes
  // that async stale-fire window.
  useEffect(
    () => () => {
      if (voxelRequestRef) voxelRequestRef.current = null
    },
    [voxelRequestRef],
  )

  // -------------------------------------------------------------------------
  // Investigations + projected positions (shared by fence + voxel + fade).
  // -------------------------------------------------------------------------

  const investigations = useMemo(
    () => [
      ...visibleCpts.map(c => ({
        id: c.id,
        location_x: c.location_x,
        location_y: c.location_y,
        elevation_m: c.elevation_m,
      })),
      ...visibleBoreholes.map(b => ({
        id: b.id,
        location_x: b.location_x,
        location_y: b.location_y,
        elevation_m: b.elevation_m,
      })),
    ],
    [visibleCpts, visibleBoreholes],
  )

  const investigationXY = useMemo<[number, number][]>(
    () => investigations.map(i => [i.location_x, i.location_y]),
    [investigations],
  )

  // -------------------------------------------------------------------------
  // Fence inputs — assembled from shell-bus data + fetched approved edges.
  // The layers already live on the geoModel bus; no extra fetch is needed.
  // -------------------------------------------------------------------------

  const fenceSectionInputs = useMemo<FenceSectionInput[]>(() => {
    if (!fenceActive || viewMode !== 'fence') return []
    if (!modelId) return []
    return assembleLithoSectionInputs({
      visibleSections,
      investigations,
      lithoLayers: layers,
      edgesBySectionId: approvedEdgesBySectionId,
    })
  }, [fenceActive, viewMode, modelId, visibleSections, investigations, layers, approvedEdgesBySectionId])

  // Fence panels — built only in Fence mode to avoid the CPU cost otherwise.
  const fencePanels = useMemo(
    () =>
      fenceActive && viewMode === 'fence' ? buildProjectFence(fenceSectionInputs) : undefined,
    [fenceActive, viewMode, fenceSectionInputs],
  )

  return {
    projectId,
    viewMode,
    setViewMode,
    wireframe,
    setWireframe,
    fenceLoading,
    splitMode,
    splitPlane,
    splitLine,
    handleSplitPlaneDrawn,
    exitSplit,
    groundSurface,
    investigations,
    investigationXY,
    fencePanels,
  }
}
