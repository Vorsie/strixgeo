import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import L from 'leaflet'
import { useEventHandlers, type EventedProps } from './events'

function evented(): L.Evented {
  // @types/leaflet marks Evented as abstract even though the runtime class is
  // directly instantiable; cast once here so tests don't need per-call noise.
  const EventedCtor = L.Evented as unknown as new () => L.Evented
  return new EventedCtor()
}

describe('useEventHandlers', () => {
  it('binds a direct prop handler (onClick → "click")', () => {
    const target = evented()
    const onClick = vi.fn()
    renderHook(() => useEventHandlers(target, { onClick } as EventedProps))
    target.fire('click')
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('binds an escape-hatch handler via `on`', () => {
    const target = evented()
    const custom = vi.fn()
    renderHook(() => useEventHandlers(target, { on: { popupopen: custom } } as EventedProps))
    target.fire('popupopen')
    expect(custom).toHaveBeenCalledOnce()
  })

  it('rebinds only the changed handler on update (no stacking)', () => {
    const target = evented()
    const a = vi.fn()
    const b = vi.fn()
    const { rerender } = renderHook(
      ({ h }) => useEventHandlers(target, { onClick: h } as EventedProps),
      { initialProps: { h: a } },
    )
    rerender({ h: b })
    target.fire('click')
    expect(a).not.toHaveBeenCalled()
    expect(b).toHaveBeenCalledOnce()
  })

  it('unbinds on unmount', () => {
    const target = evented()
    const onClick = vi.fn()
    const { unmount } = renderHook(() => useEventHandlers(target, { onClick } as EventedProps))
    unmount()
    target.fire('click')
    expect(onClick).not.toHaveBeenCalled()
  })
})
