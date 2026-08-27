// The Cesium half of the fence cutout (owner ruling R4, 2026-08-27) — kept in
// its own module so ``UnitFenceCutout`` can load it lazily: the Cesium chunk
// and the per-section fence-edge fetches spin up only while a unit is
// actually scoped on the Parameters stage.
//
// A PASSIVE embed: ``chromeless`` viewer, single pane, no split / compare /
// legend — the one verb is the host's own camera reset. The walls are the
// SAME ``buildProjectFence`` panels the 3-D stages draw, filtered to the
// scoped unit's formation id (each panel carries exactly one), over the same
// basemap lid the ground surface supplies.

import { useEffect, useMemo, useRef } from 'react'

import type { LithoBodySolidResponse } from '../../../api/client'
import type * as Cesium from 'cesium'
import { nadColoredFormations } from '../../../utils/nadClasses'
import { buildPackingClassOf } from '../../../utils/geotechHierarchicalFill/packingClassOf'
import { LoadingState } from '../../EmptyState'
import { useShell } from '../../ShellContext'
import type { ParameterUnitScope } from '../../ShellContext'
import Geology3DViewer from '../geology/Geology3DViewer'
import type { SplitLine } from '../geology/geology3DPrimitives'
import { EMPTY_SURFACES_MAP, useBody3DViewState } from '../shared/useBody3DViewState'

/** The viewer requires the callback; a passive pane never draws a split. */
const NOOP_SPLIT_DRAWN = (_plane: Cesium.Plane, _line: SplitLine): void => {}

interface Props {
  /** The unit whose walls the cutout shows. */
  scope: ParameterUnitScope
}

/**
 * Fence walls of one unit over the basemap.
 *
 * Parameters
 * ----------
 * props : Props
 *     The typed unit scope; litho scopes cut the litho model's fence, geotech
 *     scopes the (litho-framed) geotech fence.
 *
 * Returns
 * -------
 * JSX.Element
 *     The Cesium pane, a loading state, or a quiet hint when the model has no
 *     fence walls for this unit.
 */
export default function UnitFenceScene({ scope }: Props): JSX.Element {
  const {
    geoModel: {
      activeLithoModel,
      activeGeotechModel,
      lithoLayers,
      geotechLayers,
      lithoFormations,
      geotechFormations,
    },
    project,
  } = useShell()

  const isGeotech = scope.kind === 'geotech'
  const modelId = (isGeotech ? activeGeotechModel?.id : activeLithoModel?.id) ?? null

  // Same identity map the geotech 3-D canvas threads (render = build = one
  // identity); inert on a litho scope.
  const packingClassOf = useMemo(
    () =>
      buildPackingClassOf(
        geotechFormations.map(
          f =>
            [
              f.id,
              { nadClass: f.nad_class ?? null, soilCode: f.litho_main_soil_code ?? null },
            ] as const,
        ),
      ),
    [geotechFormations],
  )

  // Passive pane: the split ref is required by the hook's contract but this
  // embed never enters a split, so a local ref suffices.
  const resetSplitRef = useRef<(() => void) | null>(null)
  const resetCameraRef = useRef<(() => void) | null>(null)

  const { setViewMode, fenceLoading, groundSurface, fencePanels } = useBody3DViewState({
    modelId,
    layers: isGeotech ? geotechLayers : lithoLayers,
    frameModelId: isGeotech ? (activeLithoModel?.id ?? null) : null,
    frameLayers: isGeotech ? lithoLayers : undefined,
    resetSplitViewportRef: resetSplitRef,
    // The cutout is walls-only: no footprint ring, no solids.
    footprintActive: false,
    packingClassOf: isGeotech ? packingClassOf : undefined,
  })

  // The hook builds the fence only in fence mode — this IS the lazy trigger.
  useEffect(() => {
    setViewMode('fence')
  }, [setViewMode])

  // The cutout: each panel carries exactly one formationId, so the filter is
  // the whole R4 mechanism.
  const cutout = useMemo(
    () => fencePanels?.filter(p => p.formationId === scope.unitId),
    [fencePanels, scope.unitId],
  )

  // Fence panels are NOT camera frame targets (CesiumViewport frames on
  // surfaces or solids), so hand the viewer a synthetic solid carrying the
  // cutout's vertices — fence mode skips its render, the framing reads it.
  const frameSolids = useMemo<LithoBodySolidResponse[]>(() => {
    if (cutout === undefined || cutout.length === 0) return []
    return [
      {
        id: 'unit-fence-frame',
        model_id: modelId ?? '',
        body_id: 'unit-fence-frame',
        formation_id: scope.unitId,
        body_ordinal: 0,
        method: 'fence-frame',
        vertices: cutout.flatMap(p => p.vertices),
        triangles: [],
      } as unknown as LithoBodySolidResponse,
    ]
  }, [cutout, modelId, scope.unitId])

  // The colour lookup needs the FULL roster (filtering it would only break
  // the wall colours); geotech walls wear NAD colours exactly as the geotech
  // stage paints them.
  const viewerFormations = useMemo(
    () => (isGeotech ? nadColoredFormations(geotechFormations) : lithoFormations),
    [isGeotech, geotechFormations, lithoFormations],
  )

  if (modelId === null) {
    return (
      <div className="px-3 py-2 text-[10px] text-text-muted" data-testid="unit-fence-no-model">
        No {isGeotech ? 'geotechnical' : 'lithostratigraphic'} model yet — the
        fence cutout appears once one exists.
      </div>
    )
  }

  if (fenceLoading || cutout === undefined) {
    return (
      <div className="h-40" data-testid="unit-fence-loading">
        <LoadingState label="Assembling the fence…" />
      </div>
    )
  }

  if (cutout.length === 0) {
    // A quiet hint, never an error: a unit can be real and still paint no
    // wall (no accepted ties on any section yet).
    return (
      <div className="px-3 py-2 text-[10px] text-text-muted" data-testid="unit-fence-empty">
        No fence walls for this unit yet — connect its bands across sections
        and they will appear here.
      </div>
    )
  }

  return (
    <div className="relative h-80 rounded border border-border-subtle overflow-hidden">
      <Geology3DViewer
        splitMode="single"
        splitPlane={null}
        formations={viewerFormations}
        surfacesByFormationId={EMPTY_SURFACES_MAP}
        projectEpsg={project.default_horizontal_epsg ?? 31370}
        onSplitPlaneDrawn={NOOP_SPLIT_DRAWN}
        resetCameraRef={resetCameraRef}
        groundSurface={groundSurface}
        fencePanels={cutout}
        bodySolids={frameSolids}
        chromeless
      />
      <button
        onClick={() => resetCameraRef.current?.()}
        className="absolute top-2 right-2 z-10 px-2 py-0.5 rounded text-[10px] bg-surface-overlay/95 border border-border-default text-text-primary hover:bg-surface-page shadow"
        title="Reset the camera to frame the unit"
        data-testid="unit-fence-reset-camera"
      >
        Reset view
      </button>
    </div>
  )
}
