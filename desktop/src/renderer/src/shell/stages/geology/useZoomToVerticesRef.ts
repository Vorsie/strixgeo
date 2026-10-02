// Publish a "fly to these vertices" camera verb on a caller's ref while the
// viewport's scene is mounted — the fence cutout's "Zoom to unit" (owner ruling
// C(a), 2026-10-02). Its own hook so CesiumViewport does not grow (debt #201).
//
// A sibling of ``cameraResetRef``: the reset frames the WHOLE model; this verb
// frames whatever geometry the caller hands it, with the caller's minimum
// range. It only publishes a callback — nothing here moves the camera on its
// own (audit F4: the cutout camera moves only on a user click).

import { useEffect } from 'react'
import type * as Cesium from 'cesium'

import { flyToBounds } from './geology3DPrimitives'

/** Fly the camera to frame ``vertices`` (project CRS), no closer than ``minRangeM``. */
export type ZoomToVerticesFn = (
  vertices: readonly (readonly [number, number, number])[],
  minRangeM: number,
) => void

/**
 * Keep ``ref.current`` set to a fly-to-vertices callback bound to ``scene``.
 *
 * Parameters
 * ----------
 * scene
 *     The mounted Cesium scene, or ``null`` while the viewport is not mounted.
 * projectEpsg
 *     The horizontal CRS the vertices are in.
 * ref
 *     The caller's ref; omitted (every shared stage) = the hook does nothing.
 *
 * Returns
 * -------
 * void
 */
export function useZoomToVerticesRef(
  scene: Cesium.Scene | null,
  projectEpsg: number,
  ref: React.MutableRefObject<ZoomToVerticesFn | null> | undefined,
): void {
  useEffect(() => {
    if (ref === undefined) return
    if (scene === null) {
      ref.current = null
      return
    }
    ref.current = (vertices, minRangeM) =>
      flyToBounds(scene.camera, [{ vertices }], projectEpsg, minRangeM)
    return () => {
      // Null it so a caller never flies a destroyed widget's camera.
      ref.current = null
    }
  }, [scene, projectEpsg, ref])
}
