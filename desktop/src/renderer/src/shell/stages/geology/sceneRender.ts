/**
 * On-demand rendering for the 3D Cesium viewports (M7c).
 *
 * By default a ``CesiumWidget`` redraws continuously at ~60fps even when nothing
 * moves — a static geological model burns a GPU core for no visual change.
 * ``requestRenderMode`` flips that: the scene draws only when something asks it
 * to. The cost is that every scene mutation (a primitive rebuild, a programmatic
 * camera move) must then explicitly {@link requestSceneRender} or the change is
 * invisible until the next automatic trigger.
 *
 * ``maximumRenderTimeChange: Infinity`` stops the simulation-time clock from
 * forcing periodic redraws — our scene has no time-animated content (no
 * sun/atmosphere animation), so a static view should truly stop.
 *
 * Both live here (not inline in ``CesiumViewport``) so the option object and the
 * "mutated → redraw" seam are one tested thing reused by the viewport, the
 * wheel-zoom tuning and the compare-mode camera link.
 */

/** A scene we can ask to redraw — the slice of ``Cesium.Scene`` this needs. */
export interface RenderableScene {
  requestRender(): void
}

/**
 * ``CesiumWidget`` construction options that enable on-demand rendering.
 *
 * Spread into the widget options so a static scene stops redrawing. Cesium
 * forwards both to the ``Scene``.
 */
export const REQUEST_RENDER_WIDGET_OPTIONS = {
  /** Draw only when a render is requested, not every animation frame. */
  requestRenderMode: true,
  /**
   * No simulation-time change ever forces a redraw. Infinity because the scene
   * has no time-animated content, so an idle view should stay idle.
   */
  maximumRenderTimeChange: Number.POSITIVE_INFINITY,
} as const

/**
 * Request one redraw after a scene mutation.
 *
 * The single seam every ``requestRenderMode`` scene mutation goes through — a
 * primitive rebuild, a programmatic camera move, or the compare-mode follower
 * keeping itself live. A thin wrapper on purpose: it is the one place tests
 * assert "a mutation asks the scene to redraw", and it null-guards a scene that
 * has not mounted yet.
 *
 * Parameters
 * ----------
 * scene : RenderableScene | null
 *     The mounted scene, or ``null`` before the widget exists (a no-op then).
 */
export function requestSceneRender(scene: RenderableScene | null): void {
  if (scene === null) return
  scene.requestRender()
}
