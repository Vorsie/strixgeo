// Camera link between two Cesium viewports (compare mode).
//
// Comparing two models side by side only answers a question when both panes
// show the SAME viewpoint; two independently-panned cameras turn "does the
// geotech subdivision respect the litho units?" back into an eyeballing
// exercise. The CUT split deliberately keeps its cameras independent (each pane
// is half of one model and the user wants to inspect each half on its own) —
// this hook is used ONLY by compare mode.
//
// Its own module rather than two more effects inside CesiumViewport.tsx, which
// is at the 500-line god-component threshold (debt #201).

import * as Cesium from 'cesium'
import { useEffect } from 'react'

import { requestSceneRender } from './sceneRender'

/**
 * Publish a viewport's camera and/or mirror a sibling viewport's camera.
 *
 * The follower copies pose in ``preRender`` rather than on the camera's
 * ``changed`` event: ``changed`` fires on a percentage-of-movement threshold,
 * so it lags visibly during a slow orbit, and the follower's own writes would
 * re-arm it. ``preRender`` runs once per frame BEFORE the follower draws — so
 * it renders the leader's current pose with no one-frame lag — costs four
 * ``Cartesian3`` copies, and is strictly one-directional: the follower never
 * writes back to the leader, so no feedback loop is possible.
 *
 * Writing the four basis vectors directly (rather than ``camera.setView``) is
 * the standard Cesium viewer-sync move: ``Camera.update`` recomputes the view
 * matrix from them every frame, and setView would fight the follower's own
 * ``ScreenSpaceCameraController`` for ownership of the transform.
 *
 * Parameters
 * ----------
 * scene
 *     This viewport's Cesium scene, or ``null`` before the widget mounts.
 * publishRef
 *     Ref to publish this viewport's camera on while mounted, so a sibling can
 *     follow it. Nulled on unmount. Omit when nothing follows this viewport.
 * followRef
 *     Ref carrying the LEADER's camera. When set, this viewport mirrors it
 *     every frame. Omit for an independently-driven viewport.
 *
 * Returns
 * -------
 * void
 */
export function useCameraLink(
  scene: Cesium.Scene | null,
  publishRef?: React.MutableRefObject<Cesium.Camera | null>,
  followRef?: React.MutableRefObject<Cesium.Camera | null>,
): void {
  useEffect(() => {
    if (!scene || !publishRef) return
    publishRef.current = scene.camera
    return () => {
      publishRef.current = null
    }
  }, [scene, publishRef])

  useEffect(() => {
    if (!scene || !followRef) return

    const mirror = (): void => {
      const leader = followRef.current
      // The leader can unmount first on a layout change; skip rather than throw.
      if (!leader) return
      const follower = scene.camera
      follower.position = Cesium.Cartesian3.clone(leader.position, follower.position)
      follower.direction = Cesium.Cartesian3.clone(leader.direction, follower.direction)
      follower.up = Cesium.Cartesian3.clone(leader.up, follower.up)
      follower.right = Cesium.Cartesian3.clone(leader.right, follower.right)
    }

    // Under on-demand rendering (M7c) the follower would freeze: its own camera
    // is not what changed (the LEADER's is), so nothing requests a follower
    // redraw, so preRender never fires, so the mirror never runs. Keep the
    // follower drawing every frame while it follows — compare mode is exactly
    // when continuous render is wanted — by re-requesting a render after each
    // one. ``requestRender`` before the first frame bootstraps the loop in case
    // the widget's initial render was already consumed before this effect ran.
    const pump = (): void => requestSceneRender(scene)
    scene.preRender.addEventListener(mirror)
    scene.postRender.addEventListener(pump)
    requestSceneRender(scene)
    return () => {
      scene.preRender.removeEventListener(mirror)
      scene.postRender.removeEventListener(pump)
    }
  }, [scene, followRef])
}
