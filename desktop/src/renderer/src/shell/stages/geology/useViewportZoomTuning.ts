// Per-viewport wheel-zoom tuning (audit F5, 2026-08-27) — its own hook so
// CesiumViewport does not grow (debt #201). Only the Parameters fence cutout
// passes a tuning; with ``tuning`` undefined this hook does nothing at all,
// so every shared 3-D stage keeps Cesium's defaults byte-identically.

import * as Cesium from 'cesium'

import { useEffect } from 'react'

/** The tuning shape — mirrored on ``CesiumViewportProps.zoomTuning``. */
export interface ViewportZoomTuning {
  /** ScreenSpaceCameraController.zoomFactor (Cesium default 5). */
  zoomFactor: number
  /** ScreenSpaceCameraController.minimumZoomDistance, metres (default 1). */
  minimumZoomDistanceM: number
  /** CTRL+wheel fine step, as a fraction of camera height per notch. */
  fineZoomFraction: number
}

/**
 * Apply a wheel-zoom tuning to one mounted Cesium scene.
 *
 * Two mechanisms, deliberately split:
 *
 * * the controller's ``zoomFactor`` / ``minimumZoomDistance`` are lowered /
 *   raised for the PLAIN wheel (and right-drag / pinch, which share them);
 * * CTRL+wheel is bound as a FINE zoom through a modifier-qualified
 *   ``ScreenSpaceEventHandler``. It is NOT added to the controller's
 *   ``zoomEventTypes``: the controller applies ONE shared ``zoomFactor`` to
 *   every entry, so routing the modifier through it could never be finer —
 *   and registering both would double-fire on each notch. Today CTRL+wheel
 *   reaches the controller as nothing at all (modifier-qualified events only
 *   fire for explicitly registered actions), so the handler collides with
 *   nothing.
 *
 * The fine step is ``fineZoomFraction`` of the camera's ellipsoidal height
 * per notch (floored at the minimum zoom distance), so it shrinks
 * asymptotically toward the ground instead of punching through it.
 *
 * Parameters
 * ----------
 * scene
 *     The mounted scene, or ``null`` while the widget does not exist.
 * tuning
 *     The tuning to apply, or ``undefined`` to leave the viewport untouched.
 */
export function useViewportZoomTuning(
  scene: Cesium.Scene | null,
  tuning: ViewportZoomTuning | undefined,
): void {
  useEffect(() => {
    if (scene === null || tuning === undefined) return
    const controller = scene.screenSpaceCameraController
    controller.zoomFactor = tuning.zoomFactor
    controller.minimumZoomDistance = tuning.minimumZoomDistanceM

    const handler = new Cesium.ScreenSpaceEventHandler(scene.canvas)
    handler.setInputAction(
      (delta: number) => {
        if (delta === 0) return
        const camera = scene.camera
        const height = camera.positionCartographic.height
        const step =
          Math.max(Math.abs(height), tuning.minimumZoomDistanceM) * tuning.fineZoomFraction
        if (delta > 0) camera.zoomIn(step)
        else camera.zoomOut(step)
      },
      Cesium.ScreenSpaceEventType.WHEEL,
      Cesium.KeyboardEventModifier.CTRL,
    )

    return () => {
      // The widget's own unmount cleanup may already have destroyed the
      // handler's canvas listeners; a destroyed handler is a no-op guard.
      if (!handler.isDestroyed()) handler.destroy()
    }
  }, [scene, tuning])
}
