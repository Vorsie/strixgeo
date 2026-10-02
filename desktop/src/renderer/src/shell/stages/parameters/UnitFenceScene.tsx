// The Cesium half of the fence cutout (owner ruling R4, 2026-08-27) — kept in
// its own module so ``UnitFenceCutout`` can load it lazily: the Cesium chunk
// and the per-section fence-edge fetches spin up only while a unit is
// actually scoped on the Parameters stage.
//
// A PASSIVE embed: ``chromeless`` viewer, single pane, no split / compare /
// legend — the host's own verbs are the camera reset, "Zoom to unit" and a
// basemap on/off (owner ruling C(a), 2026-10-02). The walls are the
// SAME ``buildProjectFence`` panels the 3-D stages draw, filtered to the
// scoped unit's formation id (each panel carries exactly one), over the same
// basemap lid the ground surface supplies.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Focus, Map as MapIcon, RotateCcw } from 'lucide-react'

import type { LithoBodySolidResponse } from '../../../api/client'
import type * as Cesium from 'cesium'
import { nadColoredFormations } from '../../../utils/nadClasses'
import { buildPackingClassOf } from '../../../utils/geotechHierarchicalFill/packingClassOf'
import { LoadingState } from '../../EmptyState'
import { useT } from '../../../i18n/translate'
import { useShell } from '../../ShellContext'
import { parameterScopeModel, type ParameterUnitScope } from '../../ShellContext'
import Geology3DViewer from '../geology/Geology3DViewer'
import type { SplitLine } from '../geology/geology3DPrimitives'
import type { ZoomToVerticesFn } from '../geology/useZoomToVerticesRef'
import { EMPTY_SURFACES_MAP, useBody3DViewState } from '../shared/useBody3DViewState'
import { bandsForScope, type ParameterTreeInput } from './parameterBodyTree'
import { cutoutFilterForScope, fenceCutoutPanels } from './fenceCutoutFilter'
import { fenceFrameCorners } from './unitFenceFrame'
import { readUnitFenceBasemapOn, writeUnitFenceBasemapOn } from './unitFenceBasemapPref'
import {
  UNIT_FENCE_BASEMAP_LID_ALPHA,
  UNIT_FENCE_ZOOM_TO_UNIT_MIN_RANGE_M,
  UNIT_FENCE_ZOOM_TUNING,
} from './unitFenceSceneConstants'

/** The cutout's overlay verb buttons — one look, with a visible keyboard focus
 * ring (WCAG 2.4.7). */
const CUTOUT_VERB_CLASS =
  'inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] border shadow ' +
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1'

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
  const t = useT()

  const isGeotech = parameterScopeModel(scope) === 'geotech'
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
  // "Zoom to unit" (owner ruling C(a), 2026-10-02): the viewport publishes a
  // fly-to-vertices verb here; only the button below ever calls it.
  const zoomToVerticesRef = useRef<ZoomToVerticesFn | null>(null)
  // Basemap on/off — the chromeless pane hides the viewer's own toggle, so the
  // cutout offers its own: the orthophoto lid (depthTest off, alpha 0.6) can
  // hide a thin wall. Remembered per viewer (UI chrome, localStorage).
  const [basemapOn, setBasemapOn] = useState<boolean>(readUnitFenceBasemapOn)
  const toggleBasemap = useCallback(() => {
    setBasemapOn(prev => {
      const next = !prev
      writeUnitFenceBasemapOn(next)
      return next
    })
  }, [])

  // ``groundSurface`` is deliberately NOT taken (owner ruling B6a,
  // 2026-08-27): the cutout renders no ground-surface lid — the walls + the
  // basemap are the whole scene. The lid footprint comes from the wall panels
  // themselves (the CesiumViewport fallback).
  const { setViewMode, fenceLoading, fencePanels } = useBody3DViewState({
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

  // ``litho_layer id → body_id`` over the AXIS'S OWN layer list — the body
  // authority the cutout filter resolves panels through (amended F3,
  // 2026-08-27: the panel's ``bodyId`` LABEL is weld-minted / frame-stamped
  // and dropped mid-wall segments of one continuous body on CS1).
  const axisLayers = isGeotech ? geotechLayers : lithoLayers
  const bodyIdByLayerId = useMemo(() => {
    const out = new Map<string, string | null>()
    for (const l of axisLayers) out.set(l.id, l.body_id ?? null)
    return out
  }, [axisLayers])

  // The cutout: a pooled UNIT keeps the formation's panels; a body / class
  // scope keeps every panel whose SOURCE LAYERS the resolver stamped with ANY
  // of the scope's bodies (owner body-scope ruling 2026-08-27, generalised to
  // a body SET for the class row, spec §4). The body set is derived from the
  // ONE band authority so the cutout and the pools can never disagree.
  const scopeBands = useMemo(() => {
    const treeInput: ParameterTreeInput = {
      lithoFormations,
      geotechFormations,
      lithoLayers,
      geotechLayers,
      lithoBodies: new Map(),
      geotechBodies: new Map(),
    }
    return bandsForScope(scope, treeInput)
  }, [scope, lithoFormations, geotechFormations, lithoLayers, geotechLayers])
  const cutout = useMemo(
    () => fenceCutoutPanels(fencePanels, cutoutFilterForScope(scope, scopeBands), bodyIdByLayerId),
    [fencePanels, scope, scopeBands, bodyIdByLayerId],
  )

  // Fence panels are NOT camera frame targets (CesiumViewport frames on
  // surfaces or solids), so hand the viewer a synthetic solid — fence mode
  // skips its render, the framing reads it. Built from the UNFILTERED panel
  // set's bounding box (audit F4): 8 corners, so the framing sphere contains
  // EVERY wall and a small scoped body keeps its orientation context.
  // DELIBERATE: the viewer's camera fitKey keys on vertex counts, and this
  // solid is a constant 8 vertices — so changing the scope never re-flies
  // the camera (the frame already covers the whole model).
  const frameSolids = useMemo<LithoBodySolidResponse[]>(() => {
    if (fencePanels === undefined) return []
    const corners = fenceFrameCorners(fencePanels)
    if (corners === null) return []
    return [
      {
        id: 'unit-fence-frame',
        model_id: modelId ?? '',
        body_id: 'unit-fence-frame',
        formation_id: 'unit-fence-frame',
        body_ordinal: 0,
        method: 'fence-frame',
        vertices: corners,
        triangles: [],
      } as unknown as LithoBodySolidResponse,
    ]
  }, [fencePanels, modelId])

  // The colour lookup needs the FULL roster (filtering it would only break
  // the wall colours); geotech walls wear NAD colours exactly as the geotech
  // stage paints them.
  // The SELECTED unit's frame — the filtered cutout's box, not the whole
  // fence's (that one is Reset view's). Computed on click only: the camera
  // never moves on its own (audit F4).
  const zoomToUnit = useCallback(() => {
    if (cutout === undefined) return
    const corners = fenceFrameCorners(cutout)
    if (corners === null) return
    zoomToVerticesRef.current?.(corners, UNIT_FENCE_ZOOM_TO_UNIT_MIN_RANGE_M)
  }, [cutout])

  const viewerFormations = useMemo(
    () => (isGeotech ? nadColoredFormations(geotechFormations) : lithoFormations),
    [isGeotech, geotechFormations, lithoFormations],
  )

  if (modelId === null) {
    return (
      <div className="px-3 py-2 text-[10px] text-text-muted" data-testid="unit-fence-no-model">
        {t('params.noModelYet', {
          kind: t(isGeotech ? 'params.kindGeotech' : 'params.kindLitho'),
        })}
      </div>
    )
  }

  if (fenceLoading || cutout === undefined) {
    return (
      <div className="h-40" data-testid="unit-fence-loading">
        <LoadingState label={t('params.assemblingFence')} />
      </div>
    )
  }

  if (cutout.length === 0) {
    // A quiet hint, never an error: a unit can be real and still paint no
    // wall (no accepted ties on any section yet).
    return (
      <div className="px-3 py-2 text-[10px] text-text-muted" data-testid="unit-fence-empty">
        {t('params.noFenceWalls')}
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
        // B6a: no ground-surface lid in the cutout — walls + basemap only.
        groundSurface={null}
        // B6b: "make the basemap a bit more seethrough? like 5%?" — the
        // cutout's own dial; the shared stages keep their default.
        basemapLidAlpha={UNIT_FENCE_BASEMAP_LID_ALPHA}
        basemapEnabled={basemapOn}
        zoomToVerticesRef={zoomToVerticesRef}
        fencePanels={cutout}
        // F4: the orthophoto footprint + lid elevation come from the WHOLE
        // model's panels, so a scoped body keeps the same photo the other
        // 3-D stages drape — only the WALLS are filtered.
        lidFootprintPanels={fencePanels}
        bodySolids={frameSolids}
        // F5: the cutout is the shortest canvas in the app — gentler wheel
        // steps, a metres-scale zoom floor, CTRL+wheel as fine zoom.
        zoomTuning={UNIT_FENCE_ZOOM_TUNING}
        chromeless
      />
      <div className="absolute top-2 right-2 z-10 flex flex-wrap justify-end gap-1">
        <button
          type="button"
          onClick={toggleBasemap}
          aria-pressed={basemapOn}
          className={
            CUTOUT_VERB_CLASS +
            (basemapOn
              ? ' bg-surface-overlay/95 border-border-default text-text-primary hover:bg-surface-page'
              : ' bg-surface-overlay/80 border-border-subtle text-text-muted line-through hover:bg-surface-page')
          }
          title={basemapOn ? t('geology.hideBasemap') : t('geology.showBasemap')}
          data-testid="unit-fence-basemap-toggle"
        >
          <MapIcon size={11} aria-hidden="true" />
          {t('params.fenceBasemap')}
        </button>
        <button
          type="button"
          onClick={zoomToUnit}
          className={
            CUTOUT_VERB_CLASS +
            ' bg-surface-overlay/95 border-border-default text-text-primary hover:bg-surface-page'
          }
          // C(a): frames the SELECTED unit's walls (the filtered cutout), with
          // a ~40 m floor so a thin unit fills the pane.
          title={t('params.zoomToUnitTitle')}
          data-testid="unit-fence-zoom-to-unit"
        >
          <Focus size={11} aria-hidden="true" />
          {t('params.zoomToUnit')}
        </button>
        <button
          type="button"
          onClick={() => resetCameraRef.current?.()}
          className={
            CUTOUT_VERB_CLASS +
            ' bg-surface-overlay/95 border-border-default text-text-primary hover:bg-surface-page'
          }
          // F4: the frame is the WHOLE fence's bounding box, so the reset
          // restores the model-wide view, not a unit close-up.
          title={t('params.resetCameraFrame')}
          data-testid="unit-fence-reset-camera"
        >
          <RotateCcw size={11} aria-hidden="true" />
          {t('common.resetView')}
        </button>
      </div>
    </div>
  )
}
