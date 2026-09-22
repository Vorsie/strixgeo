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
//
// The stage's voxel-request ref is populated AND nulled by the canvas that
// owns the builder (debt #276) — NOT here. The unmount null must be guarded
// against a newer canvas that has already reclaimed the ref, and only the
// writer of the value can compare identity, so the whole voxel-ref lifecycle
// stays in the canvas.
//
// The Stratigraphy stage uses only the split-state + ground-surface blocks: it
// passes ``fenceActive: false`` and omits ``layers``, which leaves the fence
// machinery inert (the fence effect early-returns and ``fencePanels`` stays
// undefined).
//
// All hooks here are unconditional so the call order is stable regardless of
// which canvas mounts the hook (the hook-order rule).

import * as Cesium from 'cesium'
import { useEffect, useMemo, useState } from 'react'

import { api } from '../../../api/client'
import type { GroundSurfaceBuildResponse } from '../../../api/client'
import { t } from '../../../i18n/translate'
import type { LithoBodySolidResponse } from '../../../api/clients/geology'
import { useShell } from '../../ShellContext'
import type { SplitLine } from '../geology/Geology3DViewer'
import {
  SINGLE_VIEWPORT,
  splitAfterCompare,
  splitAfterCutDrawn,
  splitAfterExit,
  type SplitMode,
  type SplitViewportState,
} from './splitViewport'
import { footprintRingPositions, resolveFootprintRingElevation } from '../../../utils/footprintRing'
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
import {
  fetchApprovedEdgesBySection,
  type ApprovedEdgePair,
} from './fetchApprovedEdgesBySection'
import { resolveRegionBodyId } from '../../../components/sections/regionBodyId'
import { bedPolygonsForCrs } from '../../../utils/bedPolygonMembership'

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

/** Stable empty solid list for canvases that render TIN sheets (Geology). */
const NO_SOLIDS: readonly LithoBodySolidResponse[] = []

/** Options for ``useBody3DViewState``. */
export interface UseBody3DViewStateOptions {
  /** Active model id (litho / geotech / geological), or null when absent. */
  modelId: string | null
  /**
   * The LITHO model this stage's fence is framed on — set on the GEOTECH stage
   * only (owner ruling 2026-08-18, "densities on top of lithos"). With it the
   * fence panels carry the hierarchical fill the geotech axis renders and the
   * voxel build posts; without it the fence is the model's own partition.
   */
  frameModelId?: string | null
  /** The frame model's litho-layer rows; required alongside ``frameModelId``. */
  frameLayers?: readonly LithoLayerLike[]
  /**
   * The model's litho-layer rows feeding the fence / voxel assembly.
   * Omit on canvases that never build a fence (Geology).
   */
  layers?: readonly LithoLayerLike[]
  /**
   * The model's built body solids. Used ONLY to place the footprint ring at
   * the top of the model when there is no DEM ground surface to sit above —
   * the litho / geotech panes often have none. Omit on Geology (which renders
   * TIN sheets rather than solids and always has its own ground surface).
   */
  bodySolids?: readonly LithoBodySolidResponse[]
  /**
   * Module-level reset-split ref shared with the stage toolbar; populated
   * every render with ``exitSplit`` while the canvas is mounted.
   */
  resetSplitViewportRef: React.MutableRefObject<(() => void) | null>
  /**
   * Extra gate ANDed into the fence-edge fetch + panel build.  Geotech passes
   * ``dimension === '3d'`` (its fence only exists in 3D mode); Geology passes
   * ``false`` (no fence machinery at all).  Defaults to ``true`` (Lithology).
   */
  fenceActive?: boolean
  /**
   * Whether to fetch the model's footprint ring.  Defaults to ``true``.
   *
   * Geology passes ``false``: the footprint is the hull of a VOXEL build, and
   * only litho / geotech models ever have one, so the request could never
   * return a ring — it would only add a per-mount round trip and two "never
   * built" server log lines to a stage that does not draw the ring anyway.
   * Same shape as ``fenceActive`` above, for the same reason.
   */
  footprintActive?: boolean
  /**
   * Geotech formation id → canonical class key (``buildPackingClassOf``) for a
   * framed geotech fence — the same mass identity the geotech axis renders
   * with (owner 2026-08-21: one mass one body). Omit on litho / geology use.
   */
  packingClassOf?: ReadonlyMap<string, string>
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
  /** Store the drawn split plane/line and enter the CUT split. */
  handleSplitPlaneDrawn: (plane: Cesium.Plane, line: SplitLine) => void
  /** Collapse either split back to a single whole viewport. */
  exitSplit: () => void
  /** Show the counterpart model side by side, whole, at one viewpoint. */
  enterCompare: () => void
  /**
   * Closed ring of ``[x_m, y_m, elevation_m]`` marking the model footprint,
   * or ``undefined`` while it is unknown (not fetched yet, never built, or
   * nothing rendered to place it above).
   */
  footprintRing: readonly (readonly number[])[] | undefined
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
    bodySolids = NO_SOLIDS,
    frameModelId = null,
    frameLayers,
    resetSplitViewportRef,
    fenceActive = true,
    footprintActive = true,
    packingClassOf,
  } = options

  const {
    project,
    visibleCpts,
    visibleBoreholes,
    sections: { visibleSections },
    toasts: { toast },
    bedOverrides,
  } = useShell()

  const projectId = project?.id ?? null

  // Bumped by ``useBedOverrides`` on every bed create / update / delete. Keying
  // the ground-surface fetch on it makes a bed change refresh the 3-D terrain
  // mesh while the stage stays mounted (owner walk of installer #20/#21,
  // 2026-09-06); 0 when the bus has no bed-override slice (test fixtures).
  const groundRefreshNonce = bedOverrides?.groundRefreshNonce ?? 0

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
  //
  // ONE value, not three loose useStates: the viewer now has a third mode
  // (compare), and three independent setters over a three-mode machine is
  // exactly where "compare left a stale cut plane behind" lives — which would
  // show half a model in each compare pane and read as a modelling gap. The
  // transitions are pinned in splitViewport.test.ts.
  // -------------------------------------------------------------------------

  const [split, setSplit] = useState<SplitViewportState<Cesium.Plane, SplitLine>>(
    SINGLE_VIEWPORT,
  )

  function handleSplitPlaneDrawn(plane: Cesium.Plane, line: SplitLine): void {
    setSplit(prev => splitAfterCutDrawn(prev, plane, line))
  }

  function exitSplit(): void {
    setSplit(splitAfterExit)
  }

  function enterCompare(): void {
    setSplit(splitAfterCompare)
  }

  // Exposed so the stage toolbar Reset can collapse the split without a bus
  // extension — populated every render while the canvas is mounted. One verb
  // closes BOTH split kinds, so the user never has to know which is open.
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
    // Key on stable id strings + the bed-override refresh nonce: the DEM fetch
    // does not depend on surface staleness (a server refresh returning a new
    // model object with the same id must not re-fire it), but a bed-override
    // change DOES move the ground surface (the DEM is wrapped with the bed
    // level server-side), so the nonce re-fires it in place.
  }, [projectId, modelId, groundRefreshNonce])

  // -------------------------------------------------------------------------
  // Model footprint polygon — the alpha hull the 3-D build clipped to.
  //
  // Fetched, never derived here. The backend replays the persisted build
  // payload through the same hull the build used, so the ring the user sees is
  // the build's OWN boundary. A hull re-implemented in TypeScript would be a
  // second source of truth and could draw an edge the geometry does not have,
  // which is worse than drawing no edge at all.
  //
  // Keyed on the model id alone, like the ground-surface fetch above: a build
  // replaces the polygon, and the effect re-fires when the caller remounts /
  // switches models. A stale ring after a rebuild in the same session is the
  // known limit — the ring moves on the next model switch or reload. (Cheap to
  // tighten later by keying on a build stamp, once one is on the bus.)
  // -------------------------------------------------------------------------

  const [footprintPolygon, setFootprintPolygon] = useState<number[][] | null>(null)

  useEffect(() => {
    if (!projectId || !modelId || !footprintActive) {
      setFootprintPolygon(null)
      return
    }
    let cancelled = false

    api.geology
      .getModelFootprint(projectId, modelId)
      .then(result => {
        if (cancelled) return
        // The endpoint answers 200 with an empty polygon + a reason for every
        // "no ring yet" state, so an empty array here is a normal answer.
        setFootprintPolygon(result.polygon.length > 0 ? result.polygon : null)
      })
      .catch(() => {
        // A footprint is decoration: a failed fetch must never degrade the
        // model view. No ring, no toast.
        if (!cancelled) setFootprintPolygon(null)
      })

    return () => {
      cancelled = true
    }
  }, [projectId, modelId, footprintActive])

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
      // A section whose edge fetch failed resolves to ZERO edges, which is
      // indistinguishable from "this section genuinely has no correlations" —
      // so the fence renders untied panels and looks complete. The build path
      // refuses outright; a view cannot refuse, so it says so (audit
      // 2026-08-02, Class 1; fetchApprovedEdgesBySection's header makes acting
      // on ``failedSectionIds`` a caller obligation).
      if (result.failedSectionIds.length > 0) {
        const nameById = new Map(visibleSections.map(s => [s.id, s.name]))
        const names = result.failedSectionIds.map(id => nameById.get(id) ?? id)
        const n = result.failedSectionIds.length
        toast(
          'warning',
          t(n === 1 ? 'export.fenceIncompleteOne' : 'export.fenceIncompleteMany', {
            n,
            names: names.join(', '),
          }),
        )
      }
    })

    return () => {
      cancelled = true
      // Clear the loading flag on cleanup so a stale fetch never leaves
      // the buttons permanently disabled when the effect re-fires.
      setFenceLoading(false)
    }
    // reason: ``toast`` is the ref-stable action from useToasts — adding it
    // would not change identity, and listing it invites the impression that a
    // toast change should refire the fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, modelId, fenceActive, viewMode, visibleSections])

  // The voxel-build ref is nulled on unmount by the canvas that owns the
  // builder (debt #276), not here: the null must be guarded against a newer
  // canvas that has already reclaimed the ref, which only the writer can do.

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

  // The FRAME model's per-section edges — same lazy fetch, second model. A
  // section whose litho edges fail to load resolves to zero edges, which the
  // hierarchical fill reads as "no litho unit is correlated here": every unit
  // becomes its own family, so the fence shows each test's densities pinching
  // at their own level rather than banding. The toast above already warns that
  // the fence is incomplete; this arm inherits that warning by construction
  // because both fetches share it.
  const [frameEdgesBySectionId, setFrameEdgesBySectionId] = useState<
    Map<string, ApprovedEdgePair[]>
  >(new Map())

  useEffect(() => {
    if (!projectId || !frameModelId || !fenceActive || viewMode !== 'fence') return
    if (visibleSections.length === 0) {
      setFrameEdgesBySectionId(new Map())
      return
    }
    let cancelled = false
    void fetchApprovedEdgesBySection(projectId, frameModelId, visibleSections).then(result => {
      if (cancelled) return
      setFrameEdgesBySectionId(result.edgesBySectionId)
    })
    return () => {
      cancelled = true
    }
  }, [projectId, frameModelId, fenceActive, viewMode, visibleSections])

  const frameSectionInputs = useMemo<FenceSectionInput[] | undefined>(() => {
    if (!fenceActive || viewMode !== 'fence') return undefined
    if (!frameModelId || frameLayers === undefined) return undefined
    return assembleLithoSectionInputs({
      visibleSections,
      investigations,
      lithoLayers: frameLayers,
      edgesBySectionId: frameEdgesBySectionId,
    })
  }, [
    fenceActive,
    viewMode,
    frameModelId,
    frameLayers,
    visibleSections,
    investigations,
    frameEdgesBySectionId,
  ])

  // Fence panels — built only in Fence mode to avoid the CPU cost otherwise.
  // The body resolver collapses each section's per-gap panels to ONE panel per
  // connected body (debt #278 fence follow-on): ``litho_layer id → body_id`` over
  // this axis's own layers is the label-independent identity ``mergeFencePanels``
  // groups on (the same authority the cutout filter resolves through).
  const fencePanels = useMemo(() => {
    if (!(fenceActive && viewMode === 'fence')) return undefined
    const bodyIdByLayerId = new Map<string, string | null>()
    for (const l of layers) bodyIdByLayerId.set(l.id, l.body_id ?? null)
    const resolveBody = (layerIds: readonly string[] | undefined): string | null =>
      resolveRegionBodyId(layerIds, bodyIdByLayerId)
    // Cut the drawn bed level out of the fence walls, like the section view
    // (owner 2026-09-13). Only overrides in the panels' CRS (the sections' EPSG)
    // are kept; none → no clip, byte-identical fence.
    const bedPolygons = bedPolygonsForCrs(bedOverrides?.overrides, visibleSections[0]?.epsg ?? null)
    return buildProjectFence(
      fenceSectionInputs,
      frameSectionInputs,
      packingClassOf,
      resolveBody,
      bedPolygons,
    )
  }, [
    fenceActive,
    viewMode,
    fenceSectionInputs,
    frameSectionInputs,
    packingClassOf,
    layers,
    bedOverrides?.overrides,
    visibleSections,
  ])

  // The ring, placed at the top of whatever this pane actually renders. Split
  // from the fetch because the elevation moves when the ground surface or the
  // solids arrive, while the polygon does not.
  const footprintRing = useMemo<readonly (readonly number[])[] | undefined>(() => {
    if (!footprintPolygon) return undefined
    const elevation = resolveFootprintRingElevation(
      groundSurface?.vertices ?? [],
      // A generator, not a flatMap: a built model carries tens of thousands of
      // solid vertices and this runs whenever the solid list changes.
      (function* () {
        for (const solid of bodySolids) yield* solid.vertices
      })(),
    )
    if (elevation === null) return undefined
    const ring = footprintRingPositions(footprintPolygon, elevation)
    return ring.length > 0 ? ring : undefined
  }, [footprintPolygon, groundSurface, bodySolids])

  return {
    projectId,
    viewMode,
    setViewMode,
    wireframe,
    setWireframe,
    fenceLoading,
    splitMode: split.mode,
    splitPlane: split.plane,
    splitLine: split.line,
    handleSplitPlaneDrawn,
    exitSplit,
    enterCompare,
    groundSurface,
    investigations,
    investigationXY,
    fencePanels,
    footprintRing,
  }
}
