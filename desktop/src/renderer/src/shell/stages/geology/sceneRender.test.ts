// On-demand rendering for the 3D viewports (M7c).
//
// Two pins in the ruling's own words: "a static 3D scene does not redraw" —
// so the widget is constructed with requestRenderMode on and the render clock
// pinned to Infinity; and "requestRender after every mutation" — so a scene
// mutation routes through requestSceneRender, which asks the (mocked) scene to
// redraw exactly once.

import { describe, expect, it, vi } from 'vitest'

import { REQUEST_RENDER_WIDGET_OPTIONS, requestSceneRender } from './sceneRender'

describe('request-render widget options (M7c)', () => {
  it('C1 — the widget is built for on-demand rendering', () => {
    expect(REQUEST_RENDER_WIDGET_OPTIONS.requestRenderMode).toBe(true)
    expect(REQUEST_RENDER_WIDGET_OPTIONS.maximumRenderTimeChange).toBe(Number.POSITIVE_INFINITY)
  })
})

describe('requestSceneRender (M7c)', () => {
  it('C2 — a mutation asks the scene to redraw exactly once', () => {
    const scene = { requestRender: vi.fn() }
    requestSceneRender(scene)
    expect(scene.requestRender).toHaveBeenCalledTimes(1)
  })

  it('C3 — a not-yet-mounted scene (null) is a safe no-op', () => {
    expect(() => requestSceneRender(null)).not.toThrow()
  })
})
