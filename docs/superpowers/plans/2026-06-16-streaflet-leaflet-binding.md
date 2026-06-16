# streaflet — Leaflet React Binding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Hippocratic-2.1 `react-leaflet` + `@react-leaflet/core` with `streaflet`, a first-party, cleaner-API, full general-purpose React binding over bare `leaflet` (BSD-2), then delete both Hippocratic packages.

**Architecture:** A tiny `core/` (a `MapContext`, five `create*Component` factories, and lifecycle/event hooks) solves the React↔Leaflet sync problem once; every component is a thin `createInstance`/`updateInstance` pair on top. Components never recreate their Leaflet object on a prop change — they mutate in place. Events are first-class typed props plus an `on={{}}` escape hatch.

**Tech Stack:** React 18, `leaflet@1.9` (+ `@types/leaflet`), TypeScript (strict, `tsconfig.web.json`), Vitest + jsdom + `@testing-library/react@16`, Playwright e2e.

**Spec:** `docs/superpowers/specs/2026-06-16-streaflet-leaflet-binding-design.md` — read it first.

**Standing rules for this repo:** commit per file/task; do NOT `git push`; run desktop checks from `desktop/`; every `eslint-disable react-hooks/exhaustive-deps` needs a `// reason:` comment; English-only; numpy/JSDoc-style doc comments on public surface. The git pre-commit hook runs `npm test` when a `desktop/*.{ts,tsx}` is staged — so each commit's vitest must be green.

---

## File structure

All new code under `desktop/src/renderer/src/lib/streaflet/`:

```
index.ts                         barrel — the ONLY public import surface
types.ts                         shared prop/event types
core/
  MapContext.ts                  React context { map, layerContainer }
  events.ts                      LEAFLET_EVENTS map + useEventHandlers
  lifecycle.ts                   useLayerLifecycle, useImperativeHandleRef
  createLayerComponent.tsx       base factory
  createPathComponent.tsx        vector factory (adds `style`)
  createTileComponent.tsx        raster factory
  createOverlayComponent.tsx     Marker/Popup/Tooltip factory
  createControlComponent.tsx     L.Control factory
components/
  MapContainer.tsx Pane.tsx LayerGroup.tsx FeatureGroup.tsx
  TileLayer.tsx WMSTileLayer.tsx ImageOverlay.tsx
  Polyline.tsx Polygon.tsx Rectangle.tsx Circle.tsx CircleMarker.tsx
  Marker.tsx Popup.tsx Tooltip.tsx GeoJSON.tsx
  controls/ ZoomControl.tsx ScaleControl.tsx AttributionControl.tsx LayersControl.tsx
hooks/
  useMap.ts useMapEvent.ts useMapEvents.ts
test/
  renderInMap.tsx                shared test helper
```

Consumers (migrated in Phase 3): `MapView.tsx`, `BboxDrawer.tsx`,
`SectionLineDrawer.tsx`, `SectionOverlays.tsx`, `TieSuggestionOverlay.tsx`.

---

## PHASE 1 — Core

### Task 1: MapContext

**Files:**
- Create: `desktop/src/renderer/src/lib/streaflet/core/MapContext.ts`

- [ ] **Step 1: Write the context + hook**

```ts
import { createContext, useContext } from 'react'
import type L from 'leaflet'

/** Value carried through the streaflet tree. */
export interface StreafletContextValue {
  /** The root Leaflet map. */
  readonly map: L.Map
  /** Nearest container layers attach to (a Pane/group), else the map itself. */
  readonly layerContainer: L.Map | L.LayerGroup
}

export const MapContext = createContext<StreafletContextValue | null>(null)

/** Internal: read the context or throw if used outside <MapContainer>. */
export function useStreafletContext(): StreafletContextValue {
  const ctx = useContext(MapContext)
  if (ctx === null) {
    throw new Error('streaflet: component used outside <MapContainer>')
  }
  return ctx
}
```

- [ ] **Step 2: Commit**

```bash
git add desktop/src/renderer/src/lib/streaflet/core/MapContext.ts
git commit -m "feat(streaflet): MapContext + useStreafletContext (#213)"
```

### Task 2: Event types + useEventHandlers

**Files:**
- Create: `desktop/src/renderer/src/lib/streaflet/core/events.ts`
- Test: `desktop/src/renderer/src/lib/streaflet/core/events.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import L from 'leaflet'
import { useEventHandlers, type EventedProps } from './events'

function evented(): L.Evented {
  return new L.Evented()
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
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `desktop/`): `npx vitest run src/renderer/src/lib/streaflet/core/events.test.ts`
Expected: FAIL — `useEventHandlers` not found.

- [ ] **Step 3: Implement events.ts**

```ts
import { useEffect, useRef } from 'react'
import type L from 'leaflet'

/**
 * Map of first-class React event-prop names → Leaflet event names. Add a row
 * here to promote a new Leaflet event to a typed prop across all components.
 */
export const LEAFLET_EVENTS = {
  onClick: 'click',
  onDblClick: 'dblclick',
  onMouseDown: 'mousedown',
  onMouseUp: 'mouseup',
  onMouseOver: 'mouseover',
  onMouseOut: 'mouseout',
  onMouseMove: 'mousemove',
  onContextMenu: 'contextmenu',
  onDragStart: 'dragstart',
  onDrag: 'drag',
  onDragEnd: 'dragend',
  onMove: 'move',
  onMoveStart: 'movestart',
  onMoveEnd: 'moveend',
  onZoom: 'zoom',
  onZoomStart: 'zoomstart',
  onZoomEnd: 'zoomend',
  onAdd: 'add',
  onRemove: 'remove',
  onPopupOpen: 'popupopen',
  onPopupClose: 'popupclose',
  onTooltipOpen: 'tooltipopen',
  onTooltipClose: 'tooltipclose',
} as const

export type LeafletEventPropName = keyof typeof LEAFLET_EVENTS

/** Props every interactive streaflet component accepts. */
export type EventedProps = {
  [K in LeafletEventPropName]?: L.LeafletEventHandlerFn
} & {
  /** Escape hatch: bind any Leaflet event not promoted to a typed prop. */
  on?: Partial<Record<string, L.LeafletEventHandlerFn>>
}

/** Flatten direct event props + `on` into one {leafletEvent: handler} record. */
function resolveHandlers(props: EventedProps): Record<string, L.LeafletEventHandlerFn> {
  const out: Record<string, L.LeafletEventHandlerFn> = {}
  for (const [propName, leafletName] of Object.entries(LEAFLET_EVENTS)) {
    const handler = props[propName as LeafletEventPropName]
    if (handler) out[leafletName] = handler
  }
  if (props.on) {
    for (const [name, handler] of Object.entries(props.on)) {
      if (handler) out[name] = handler
    }
  }
  return out
}

/**
 * Keep a Leaflet object's event bindings in sync with React props. Diffs the
 * resolved handler set against the previous render and only `off`/`on`s what
 * changed, so handlers never stack and nothing leaks on unmount.
 */
export function useEventHandlers(target: L.Evented | null, props: EventedProps): void {
  const boundRef = useRef<Record<string, L.LeafletEventHandlerFn>>({})

  useEffect(() => {
    if (target === null) return
    const next = resolveHandlers(props)
    const prev = boundRef.current

    for (const [name, handler] of Object.entries(prev)) {
      if (next[name] !== handler) target.off(name, handler)
    }
    for (const [name, handler] of Object.entries(next)) {
      if (prev[name] !== handler) target.on(name, handler)
    }
    boundRef.current = next

    return () => {
      for (const [name, handler] of Object.entries(boundRef.current)) {
        target.off(name, handler)
      }
      boundRef.current = {}
    }
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/lib/streaflet/core/events.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add desktop/src/renderer/src/lib/streaflet/core/events.ts desktop/src/renderer/src/lib/streaflet/core/events.test.ts
git commit -m "feat(streaflet): typed event props + on() escape with diff-binding (#213)"
```

### Task 3: lifecycle hooks

**Files:**
- Create: `desktop/src/renderer/src/lib/streaflet/core/lifecycle.ts`

- [ ] **Step 1: Write lifecycle.ts**

```ts
import { useEffect } from 'react'
import type { ForwardedRef } from 'react'
import type L from 'leaflet'

/** Add a layer to its container on mount, remove on unmount, re-parent on change. */
export function useLayerLifecycle(
  layer: L.Layer | null,
  container: L.Map | L.LayerGroup,
): void {
  useEffect(() => {
    if (layer === null) return
    container.addLayer(layer)
    return () => {
      container.removeLayer(layer)
    }
  }, [layer, container])
}

/** Point a forwarded ref at the Leaflet instance (or null after unmount). */
export function useImperativeInstance<T>(ref: ForwardedRef<T>, instance: T | null): void {
  useEffect(() => {
    if (typeof ref === 'function') ref(instance)
    else if (ref) ref.current = instance
    return () => {
      if (typeof ref === 'function') ref(null)
      else if (ref) ref.current = null
    }
  }, [ref, instance])
}
```

> Note: `L.Map` and `L.LayerGroup` both expose `addLayer`/`removeLayer`, so one
> code path serves both container kinds.

- [ ] **Step 2: Commit**

```bash
git add desktop/src/renderer/src/lib/streaflet/core/lifecycle.ts
git commit -m "feat(streaflet): layer-lifecycle + imperative-ref hooks (#213)"
```

### Task 4: createLayerComponent factory

**Files:**
- Create: `desktop/src/renderer/src/lib/streaflet/core/createLayerComponent.tsx`

- [ ] **Step 1: Write the factory**

```tsx
import { forwardRef, useRef, useState, type ReactNode } from 'react'
import type L from 'leaflet'
import { MapContext, useStreafletContext, type StreafletContextValue } from './MapContext'
import { useEventHandlers, type EventedProps } from './events'
import { useLayerLifecycle, useImperativeInstance } from './lifecycle'

/** A streaflet layer component is built from these two functions. */
export interface LayerFactory<P, I extends L.Layer> {
  /** Construct the Leaflet instance from initial props + context. */
  createInstance: (props: P, ctx: StreafletContextValue) => I
  /** Apply changed props to an existing instance (mutate in place, never recreate). */
  updateInstance?: (instance: I, props: P, prevProps: P) => void
}

/**
 * Build a React component for a Leaflet layer. Handles: create-once, add to the
 * nearest container, mutate-in-place on prop change, event binding, ref
 * forwarding, and removal on unmount. `children` (if any) render under a context
 * whose layerContainer is THIS instance when it is a group, else the inherited one.
 */
export function createLayerComponent<P extends EventedProps, I extends L.Layer>(
  factory: LayerFactory<P, I>,
) {
  return forwardRef<I, P & { children?: ReactNode }>(function StreafletLayer(props, ref) {
    const ctx = useStreafletContext()
    const prevProps = useRef<P>(props)
    // Create the instance exactly once (StrictMode-safe via lazy init).
    const [instance] = useState<I>(() => factory.createInstance(props, ctx))

    if (factory.updateInstance && prevProps.current !== props) {
      factory.updateInstance(instance, props, prevProps.current)
      prevProps.current = props
    }

    useLayerLifecycle(instance, ctx.layerContainer)
    useEventHandlers(instance, props)
    useImperativeInstance(ref, instance)

    const childCtx: StreafletContextValue =
      'addLayer' in instance
        ? { map: ctx.map, layerContainer: instance as unknown as L.LayerGroup }
        : ctx
    return <MapContext.Provider value={childCtx}>{props.children}</MapContext.Provider>
  })
}
```

> `useState(() => createInstance(...))` is the create-once guard: the initializer
> runs once per mounted component even under StrictMode's double-render.

- [ ] **Step 2: Commit**

```bash
git add desktop/src/renderer/src/lib/streaflet/core/createLayerComponent.tsx
git commit -m "feat(streaflet): createLayerComponent base factory (#213)"
```

### Task 5: path / tile / overlay / control factories

**Files:**
- Create: `createPathComponent.tsx`, `createTileComponent.tsx`, `createOverlayComponent.tsx`, `createControlComponent.tsx` (all in `core/`)

- [ ] **Step 1: createPathComponent.tsx** — vector layers; promotes a `style` prop.

```tsx
import type L from 'leaflet'
import { createLayerComponent, type LayerFactory } from './createLayerComponent'
import type { EventedProps } from './events'

/** Props common to vector (path) layers. `style` aliases Leaflet PathOptions. */
export interface PathProps extends EventedProps {
  style?: L.PathOptions
}

/**
 * Path factory: wraps createLayerComponent and applies `style` via setStyle on
 * create + update, so every vector layer gets consistent styling for free.
 */
export function createPathComponent<P extends PathProps, I extends L.Path>(
  factory: LayerFactory<P, I>,
) {
  return createLayerComponent<P, I>({
    createInstance: (props, ctx) => {
      const instance = factory.createInstance(props, ctx)
      if (props.style) instance.setStyle(props.style)
      return instance
    },
    updateInstance: (instance, props, prev) => {
      factory.updateInstance?.(instance, props, prev)
      if (props.style !== prev.style && props.style) instance.setStyle(props.style)
    },
  })
}
```

- [ ] **Step 2: createTileComponent.tsx** — raster layers attach to the MAP (not the layerContainer group), matching Leaflet semantics.

```tsx
import type L from 'leaflet'
import { forwardRef, useRef, useState } from 'react'
import { useStreafletContext } from './MapContext'
import { useEventHandlers, type EventedProps } from './events'
import { useImperativeInstance } from './lifecycle'
import { useEffect } from 'react'

export interface TileFactory<P, I extends L.Layer> {
  createInstance: (props: P, ctx: ReturnType<typeof useStreafletContext>) => I
  updateInstance?: (instance: I, props: P, prev: P) => void
}

/** Tile/raster factory — adds the layer to the map, removes on unmount. */
export function createTileComponent<P extends EventedProps, I extends L.Layer>(
  factory: TileFactory<P, I>,
) {
  return forwardRef<I, P>(function StreafletTile(props, ref) {
    const ctx = useStreafletContext()
    const prev = useRef<P>(props)
    const [instance] = useState<I>(() => factory.createInstance(props, ctx))

    if (factory.updateInstance && prev.current !== props) {
      factory.updateInstance(instance, props, prev.current)
      prev.current = props
    }

    useEffect(() => {
      instance.addTo(ctx.map)
      return () => {
        instance.remove()
      }
    }, [instance, ctx.map])

    useEventHandlers(instance, props)
    useImperativeInstance(ref, instance)
    return null
  })
}
```

- [ ] **Step 3: createOverlayComponent.tsx** — Marker/Popup/Tooltip; honours an `open` prop for Popup/Tooltip.

```tsx
import type L from 'leaflet'
import { createLayerComponent, type LayerFactory } from './createLayerComponent'
import type { EventedProps } from './events'

/** Overlays reuse the base layer lifecycle; Popup/Tooltip add open/close in their own files. */
export function createOverlayComponent<P extends EventedProps, I extends L.Layer>(
  factory: LayerFactory<P, I>,
) {
  return createLayerComponent<P, I>(factory)
}
```

- [ ] **Step 4: createControlComponent.tsx** — `L.Control`; add/remove on the map, react to `position`.

```tsx
import { forwardRef, useRef, useState, useEffect } from 'react'
import type L from 'leaflet'
import { useStreafletContext } from './MapContext'
import { useImperativeInstance } from './lifecycle'

export interface ControlProps {
  position?: L.ControlPosition
}

export interface ControlFactory<P extends ControlProps, I extends L.Control> {
  createInstance: (props: P) => I
  updateInstance?: (instance: I, props: P, prev: P) => void
}

/** Control factory — addControl on mount, removeControl on unmount, setPosition on change. */
export function createControlComponent<P extends ControlProps, I extends L.Control>(
  factory: ControlFactory<P, I>,
) {
  return forwardRef<I, P>(function StreafletControl(props, ref) {
    const ctx = useStreafletContext()
    const prev = useRef<P>(props)
    const [instance] = useState<I>(() => factory.createInstance(props))

    if (props.position && props.position !== prev.current.position) {
      instance.setPosition(props.position)
    }
    factory.updateInstance?.(instance, props, prev.current)
    prev.current = props

    useEffect(() => {
      ctx.map.addControl(instance)
      return () => {
        ctx.map.removeControl(instance)
      }
    }, [instance, ctx.map])

    useImperativeInstance(ref, instance)
    return null
  })
}
```

- [ ] **Step 5: Run tsc to verify the core type-checks**

Run (from `desktop/`): `npx tsc --noEmit -p tsconfig.web.json`
Expected: clean (no output). Fix any type errors before committing.

- [ ] **Step 6: Commit (one file per commit)**

```bash
git add desktop/src/renderer/src/lib/streaflet/core/createPathComponent.tsx
git commit -m "feat(streaflet): createPathComponent (style prop) (#213)"
git add desktop/src/renderer/src/lib/streaflet/core/createTileComponent.tsx
git commit -m "feat(streaflet): createTileComponent (#213)"
git add desktop/src/renderer/src/lib/streaflet/core/createOverlayComponent.tsx
git commit -m "feat(streaflet): createOverlayComponent (#213)"
git add desktop/src/renderer/src/lib/streaflet/core/createControlComponent.tsx
git commit -m "feat(streaflet): createControlComponent (#213)"
```

### Task 6: useMap hook + shared test helper

**Files:**
- Create: `hooks/useMap.ts`, `test/renderInMap.tsx`

- [ ] **Step 1: useMap.ts**

```ts
import { useStreafletContext } from '../core/MapContext'
import type L from 'leaflet'

/** Access the parent <MapContainer>'s Leaflet map. Throws if used outside one. */
export function useMap(): L.Map {
  return useStreafletContext().map
}
```

- [ ] **Step 2: renderInMap.tsx** — the shared test helper every component test uses.

```tsx
import { render, type RenderResult } from '@testing-library/react'
import { useEffect, useState, type ReactNode } from 'react'
import L from 'leaflet'
import { MapContext } from '../core/MapContext'

/**
 * Render streaflet children inside a real Leaflet map mounted in jsdom. Returns
 * the map plus the RTL result. The map div is given a fixed size so Leaflet's
 * layout math does not divide by zero under jsdom.
 */
export function renderInMap(children: ReactNode): { map: L.Map } & RenderResult {
  let map!: L.Map
  function Harness(): JSX.Element | null {
    const [m, setM] = useState<L.Map | null>(null)
    useEffect(() => {
      const div = document.createElement('div')
      Object.assign(div.style, { width: '400px', height: '400px' })
      document.body.appendChild(div)
      const created = L.map(div, { center: [51, 4], zoom: 10 })
      map = created
      setM(created)
      return () => created.remove()
    }, [])
    if (m === null) return null
    return <MapContext.Provider value={{ map: m, layerContainer: m }}>{children}</MapContext.Provider>
  }
  const result = render(<Harness />)
  return { map, ...result }
}
```

- [ ] **Step 3: Commit**

```bash
git add desktop/src/renderer/src/lib/streaflet/hooks/useMap.ts desktop/src/renderer/src/lib/streaflet/test/renderInMap.tsx
git commit -m "feat(streaflet): useMap hook + renderInMap test harness (#213)"
```

---

## PHASE 2 — Primitives used by the app

Each task follows the same TDD rhythm: **(1)** write the component, **(2)** write
a test using `renderInMap`, **(3)** run it red→green, **(4)** commit. The
component code is complete below; the test asserts the three core properties
(adds to map, updates in place, unmounts cleanly).

### Task 7: TileLayer

**Files:** Create `components/TileLayer.tsx`, `components/TileLayer.test.tsx`

- [ ] **Step 1: Component**

```tsx
import L from 'leaflet'
import { createTileComponent } from '../core/createTileComponent'
import type { EventedProps } from '../core/events'

export interface TileLayerProps extends EventedProps {
  url: string
  attribution?: string
  opacity?: number
  zIndex?: number
  maxZoom?: number
  minZoom?: number
  subdomains?: string | string[]
}

/** Raster XYZ tile layer (wraps L.tileLayer). */
export const TileLayer = createTileComponent<TileLayerProps, L.TileLayer>({
  createInstance: (props) =>
    L.tileLayer(props.url, {
      attribution: props.attribution,
      opacity: props.opacity,
      zIndex: props.zIndex,
      maxZoom: props.maxZoom,
      minZoom: props.minZoom,
      subdomains: props.subdomains,
    }),
  updateInstance: (layer, props, prev) => {
    if (props.url !== prev.url) layer.setUrl(props.url)
    if (props.opacity !== undefined && props.opacity !== prev.opacity) layer.setOpacity(props.opacity)
    if (props.zIndex !== undefined && props.zIndex !== prev.zIndex) layer.setZIndex(props.zIndex)
  },
})
```

- [ ] **Step 2: Test**

```tsx
import { describe, it, expect } from 'vitest'
import L from 'leaflet'
import { renderInMap } from '../test/renderInMap'
import { TileLayer } from './TileLayer'

describe('TileLayer', () => {
  it('adds a tile layer to the map and removes it on unmount', () => {
    const { map, unmount } = renderInMap(<TileLayer url="https://x/{z}/{x}/{y}.png" />)
    let count = 0
    map.eachLayer((l) => { if (l instanceof L.TileLayer) count++ })
    expect(count).toBe(1)
    unmount()
    let after = 0
    map.eachLayer((l) => { if (l instanceof L.TileLayer) after++ })
    expect(after).toBe(0)
  })
})
```

- [ ] **Step 3: Red→green** — `npx vitest run src/renderer/src/lib/streaflet/components/TileLayer.test.tsx` (FAIL then PASS).
- [ ] **Step 4: Commit** — `git add` both, `git commit -m "feat(streaflet): TileLayer (#213)"`.

### Task 8: WMSTileLayer

**Files:** Create `components/WMSTileLayer.tsx` (+ `.test.tsx`)

- [ ] **Step 1: Component**

```tsx
import L from 'leaflet'
import { createTileComponent } from '../core/createTileComponent'
import type { EventedProps } from '../core/events'

export interface WMSTileLayerProps extends EventedProps {
  url: string
  layers: string
  format?: string
  transparent?: boolean
  version?: string
  attribution?: string
  opacity?: number
  zIndex?: number
}

/** OGC WMS tile layer (wraps L.tileLayer.wms). */
export const WMSTileLayer = createTileComponent<WMSTileLayerProps, L.TileLayer.WMS>({
  createInstance: (props) =>
    L.tileLayer.wms(props.url, {
      layers: props.layers,
      format: props.format ?? 'image/png',
      transparent: props.transparent,
      version: props.version,
      attribution: props.attribution,
      opacity: props.opacity,
      zIndex: props.zIndex,
    }),
  updateInstance: (layer, props, prev) => {
    if (props.opacity !== undefined && props.opacity !== prev.opacity) layer.setOpacity(props.opacity)
    if (props.layers !== prev.layers) layer.setParams({ layers: props.layers })
  },
})
```

- [ ] **Step 2: Test** — mirror Task 7's test, asserting one `L.TileLayer.WMS` added then removed.
- [ ] **Step 3: Red→green; Step 4: Commit** — `"feat(streaflet): WMSTileLayer (#213)"`.

### Task 9: Pane

**Files:** Create `components/Pane.tsx` (+ `.test.tsx`)

- [ ] **Step 1: Component** — a Pane is not a layer; it creates a named map pane, sets z-index, and provides a child context whose layers render into that pane via their own `pane` option. streaflet models it by creating the pane and rendering children under a context that carries the pane name.

```tsx
import { useState, type ReactNode } from 'react'
import { MapContext, useStreafletContext } from '../core/MapContext'

export interface PaneProps {
  name: string
  /** CSS z-index applied to the created pane element. */
  zIndex?: number
  children?: ReactNode
}

/**
 * Create (once) a named Leaflet map pane and render children into the same map
 * context. Child layers opt into the pane by passing `pane={name}` in their
 * Leaflet options (Marker/Path components forward a `pane` prop — see those).
 */
export function Pane({ name, zIndex, children }: PaneProps): JSX.Element {
  const ctx = useStreafletContext()
  useState(() => {
    const pane = ctx.map.getPane(name) ?? ctx.map.createPane(name)
    if (zIndex !== undefined) pane.style.zIndex = String(zIndex)
    return pane
  })
  // Layers still attach to the map; the pane is selected per-layer via `pane`.
  return <MapContext.Provider value={ctx}>{children}</MapContext.Provider>
}
```

> Add an optional `pane?: string` to `TileLayerProps`, `PathProps`, and the
> Marker/overlay props, threaded into the Leaflet options, so a child can target
> a pane. (One line in each options object — do it when migrating MapView, which
> is the only consumer that nests layers in panes.)

- [ ] **Step 2: Test** — `renderInMap(<Pane name="testpane" zIndex={450} />)` then assert `map.getPane('testpane')` exists with `style.zIndex === '450'`.
- [ ] **Step 3: Red→green; Step 4: Commit** — `"feat(streaflet): Pane (#213)"`.

### Task 10: Polyline, Polygon, Rectangle (path components)

**Files:** Create `components/Polyline.tsx`, `Polygon.tsx`, `Rectangle.tsx` (+ tests)

- [ ] **Step 1: Polyline.tsx**

```tsx
import L from 'leaflet'
import { createPathComponent, type PathProps } from '../core/createPathComponent'

export interface PolylineProps extends PathProps {
  positions: L.LatLngExpression[]
}

export const Polyline = createPathComponent<PolylineProps, L.Polyline>({
  createInstance: (props) => L.polyline(props.positions, props.style),
  updateInstance: (line, props, prev) => {
    if (props.positions !== prev.positions) line.setLatLngs(props.positions)
  },
})
```

- [ ] **Step 2: Polygon.tsx** — identical shape with `L.polygon`:

```tsx
import L from 'leaflet'
import { createPathComponent, type PathProps } from '../core/createPathComponent'

export interface PolygonProps extends PathProps {
  positions: L.LatLngExpression[] | L.LatLngExpression[][]
}

export const Polygon = createPathComponent<PolygonProps, L.Polygon>({
  createInstance: (props) => L.polygon(props.positions, props.style),
  updateInstance: (poly, props, prev) => {
    if (props.positions !== prev.positions) poly.setLatLngs(props.positions)
  },
})
```

- [ ] **Step 3: Rectangle.tsx**

```tsx
import L from 'leaflet'
import { createPathComponent, type PathProps } from '../core/createPathComponent'

export interface RectangleProps extends PathProps {
  bounds: L.LatLngBoundsExpression
}

export const Rectangle = createPathComponent<RectangleProps, L.Rectangle>({
  createInstance: (props) => L.rectangle(props.bounds, props.style),
  updateInstance: (rect, props, prev) => {
    if (props.bounds !== prev.bounds) rect.setBounds(props.bounds as L.LatLngBoundsExpression)
  },
})
```

- [ ] **Step 4: Tests** — one per component via `renderInMap`, asserting the path is added (`instanceof L.Polyline` / `L.Polygon` / `L.Rectangle`), an `onClick` prop fires on `layer.fire('click')`, and it is removed on unmount.
- [ ] **Step 5: Red→green; Step 6: Commit each file separately** — `"feat(streaflet): Polyline (#213)"`, etc.

### Task 11: CircleMarker + Circle

**Files:** Create `components/CircleMarker.tsx`, `components/Circle.tsx` (+ tests)

- [ ] **Step 1: CircleMarker.tsx**

```tsx
import L from 'leaflet'
import { createPathComponent, type PathProps } from '../core/createPathComponent'

export interface CircleMarkerProps extends PathProps {
  center: L.LatLngExpression
  radius?: number
}

export const CircleMarker = createPathComponent<CircleMarkerProps, L.CircleMarker>({
  createInstance: (props) =>
    L.circleMarker(props.center, { ...props.style, radius: props.radius }),
  updateInstance: (cm, props, prev) => {
    if (props.center !== prev.center) cm.setLatLng(props.center)
    if (props.radius !== undefined && props.radius !== prev.radius) cm.setRadius(props.radius)
  },
})
```

- [ ] **Step 2: Circle.tsx** — same but `L.circle` (radius in metres):

```tsx
import L from 'leaflet'
import { createPathComponent, type PathProps } from '../core/createPathComponent'

export interface CircleProps extends PathProps {
  center: L.LatLngExpression
  radius: number
}

export const Circle = createPathComponent<CircleProps, L.Circle>({
  createInstance: (props) => L.circle(props.center, { ...props.style, radius: props.radius }),
  updateInstance: (c, props, prev) => {
    if (props.center !== prev.center) c.setLatLng(props.center)
    if (props.radius !== prev.radius) c.setRadius(props.radius)
  },
})
```

- [ ] **Step 3: Tests; Step 4: Commit each** — `"feat(streaflet): CircleMarker (#213)"`, `"feat(streaflet): Circle (#213)"`.

### Task 12: Marker

**Files:** Create `components/Marker.tsx` (+ test)

- [ ] **Step 1: Component**

```tsx
import L from 'leaflet'
import { createOverlayComponent } from '../core/createOverlayComponent'
import type { EventedProps } from '../core/events'

export interface MarkerProps extends EventedProps {
  position: L.LatLngExpression
  icon?: L.Icon | L.DivIcon
  draggable?: boolean
  zIndexOffset?: number
  opacity?: number
}

export const Marker = createOverlayComponent<MarkerProps, L.Marker>({
  createInstance: (props) =>
    L.marker(props.position, {
      icon: props.icon,
      draggable: props.draggable,
      zIndexOffset: props.zIndexOffset,
      opacity: props.opacity,
    }),
  updateInstance: (marker, props, prev) => {
    if (props.position !== prev.position) marker.setLatLng(props.position)
    if (props.icon && props.icon !== prev.icon) marker.setIcon(props.icon)
    if (props.opacity !== undefined && props.opacity !== prev.opacity) marker.setOpacity(props.opacity)
    if (props.zIndexOffset !== undefined && props.zIndexOffset !== prev.zIndexOffset)
      marker.setZIndexOffset(props.zIndexOffset)
  },
})
```

- [ ] **Step 2: Test** — assert one `L.Marker` added; `position` update moves it (`marker.getLatLng()` changes); `onClick` fires; unmount removes.
- [ ] **Step 3: Red→green; Step 4: Commit** — `"feat(streaflet): Marker (#213)"`.

### Task 13: Tooltip

**Files:** Create `components/Tooltip.tsx` (+ test)

- [ ] **Step 1: Component** — a Tooltip binds to its PARENT layer (when nested) or to the map. It renders its React `children` into the tooltip's DOM via the Leaflet tooltip content. Simplest robust approach: render children to an off-DOM container and pass the element as content.

```tsx
import L from 'leaflet'
import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useStreafletContext } from '../core/MapContext'

export interface TooltipProps {
  children?: ReactNode
  permanent?: boolean
  direction?: L.Direction
  offset?: L.PointExpression
  sticky?: boolean
  opacity?: number
  className?: string
}

/**
 * Bind a Leaflet tooltip to the nearest layer (via context's layerContainer
 * when it is a single layer) or the map. React children render into the
 * tooltip element through a portal.
 */
export function Tooltip({ children, ...options }: TooltipProps): JSX.Element {
  const ctx = useStreafletContext()
  const elRef = useRef<HTMLDivElement>(document.createElement('div'))
  const target = (ctx.layerContainer as unknown as L.Layer)

  useEffect(() => {
    const layer = target as L.Layer & { bindTooltip?: L.Layer['bindTooltip'] }
    if (typeof layer.bindTooltip !== 'function') return
    layer.bindTooltip(elRef.current, options)
    return () => {
      layer.unbindTooltip()
    }
    // reason: options is spread fresh each render; binding once on mount is
    // intentional — content updates flow through the portal, not a rebind.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target])

  return createPortal(children, elRef.current)
}
```

> The existing consumers nest `<Tooltip>` inside Marker/path components (which
> set `layerContainer` to that layer via the factory's child context) OR inside
> a `<Pane>`. Where a Tooltip is a *direct* map child (rare), `bindTooltip` is
> absent and the effect no-ops — verify against the real usage during migration
> and, if a map-level tooltip is needed, fall back to `L.tooltip().addTo(map)`.

- [ ] **Step 2: Test** — render `<Marker position={[51,4]}><Tooltip>hi</Tooltip></Marker>` in a map; assert the marker has a bound tooltip (`marker.getTooltip()` is defined).
- [ ] **Step 3: Red→green; Step 4: Commit** — `"feat(streaflet): Tooltip (#213)"`.

### Task 14: MapContainer + barrel (Phase 1+2 public surface)

**Files:** Create `components/MapContainer.tsx`, `index.ts` (+ MapContainer test)

- [ ] **Step 1: MapContainer.tsx**

```tsx
import L from 'leaflet'
import { forwardRef, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { MapContext } from '../core/MapContext'
import { useImperativeInstance } from '../core/lifecycle'

export interface MapContainerProps {
  center?: L.LatLngExpression
  zoom?: number
  bounds?: L.LatLngBoundsExpression
  minZoom?: number
  maxZoom?: number
  zoomControl?: boolean
  attributionControl?: boolean
  style?: CSSProperties
  className?: string
  children?: ReactNode
  whenReady?: (map: L.Map) => void
}

/** Root component: creates the L.Map once, provides context, renders children when ready. */
export const MapContainer = forwardRef<L.Map, MapContainerProps>(function MapContainer(props, ref) {
  const divRef = useRef<HTMLDivElement>(null)
  const [map, setMap] = useState<L.Map | null>(null)

  useEffect(() => {
    if (divRef.current === null) return
    const created = L.map(divRef.current, {
      center: props.center ?? [0, 0],
      zoom: props.zoom ?? 1,
      minZoom: props.minZoom,
      maxZoom: props.maxZoom,
      zoomControl: props.zoomControl ?? true,
      attributionControl: props.attributionControl ?? true,
    })
    if (props.bounds) created.fitBounds(props.bounds)
    setMap(created)
    props.whenReady?.(created)
    return () => {
      created.remove()
      setMap(null)
    }
    // reason: create the map once on mount from the initial view props; live
    // view changes go through useMap()/imperative calls in consumers, matching
    // react-leaflet semantics.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useImperativeInstance(ref, map)

  return (
    <div ref={divRef} style={props.style} className={props.className}>
      {map !== null && (
        <MapContext.Provider value={{ map, layerContainer: map }}>
          {props.children}
        </MapContext.Provider>
      )}
    </div>
  )
})
```

- [ ] **Step 2: index.ts barrel** (Phase 1+2 surface; extended in Phase 4)

```ts
export { MapContainer } from './components/MapContainer'
export type { MapContainerProps } from './components/MapContainer'
export { TileLayer } from './components/TileLayer'
export { WMSTileLayer } from './components/WMSTileLayer'
export { Pane } from './components/Pane'
export { Marker } from './components/Marker'
export { CircleMarker } from './components/CircleMarker'
export { Circle } from './components/Circle'
export { Rectangle } from './components/Rectangle'
export { Polygon } from './components/Polygon'
export { Polyline } from './components/Polyline'
export { Tooltip } from './components/Tooltip'
export { useMap } from './hooks/useMap'
export type { TileLayerProps } from './components/TileLayer'
export type { WMSTileLayerProps } from './components/WMSTileLayer'
export type { MarkerProps } from './components/Marker'
export type { CircleMarkerProps } from './components/CircleMarker'
export type { RectangleProps } from './components/Rectangle'
export type { PolygonProps } from './components/Polygon'
export type { PolylineProps } from './components/Polyline'
export type { PathProps } from './core/createPathComponent'
export type { EventedProps } from './core/events'
```

- [ ] **Step 3: MapContainer test** — `render(<MapContainer center={[51,4]} zoom={10}><TileLayer url="https://x/{z}/{x}/{y}.png"/></MapContainer>)`; assert (a) a `.leaflet-container` div exists, (b) StrictMode double-mount creates exactly one map (wrap in `<React.StrictMode>` and assert no error + one tile layer).
- [ ] **Step 4: Run the whole streaflet suite + tsc**

Run: `npx vitest run src/renderer/src/lib/streaflet && npx tsc --noEmit -p tsconfig.web.json`
Expected: all green, tsc clean.

- [ ] **Step 5: Commit** — `git add` the two files + test, `git commit -m "feat(streaflet): MapContainer + barrel (#213)"`.

---

## PHASE 3 — Migrate consumers + delete react-leaflet

Migrate **one consumer per task**, running tsc + that consumer's vitest after
each, so a regression is isolated. The transforms are always: import path →
`@/lib/streaflet`; `eventHandlers={{click:f}}` → `onClick={f}` (or `on={{}}`);
`pathOptions={{…}}` → `style={{…}}`.

### Task 15: Migrate SectionOverlays.tsx + TieSuggestionOverlay.tsx

**Files:** Modify `components/SectionOverlays.tsx`, `components/TieSuggestionOverlay.tsx`

- [ ] **Step 1:** In each, change `import { Pane, Polygon, Polyline, Tooltip } from 'react-leaflet'` → `from '@/lib/streaflet'` (drop unused names). Convert any `eventHandlers`/`pathOptions` per the transform.
- [ ] **Step 2:** `npx tsc --noEmit -p tsconfig.web.json` clean; `npx vitest run` for any tests touching these.
- [ ] **Step 3: Commit each file** — `"refactor(map): migrate SectionOverlays to streaflet (#213)"`, `"refactor(map): migrate TieSuggestionOverlay to streaflet (#213)"`.

### Task 16: Migrate BboxDrawer.tsx + SectionLineDrawer.tsx

**Files:** Modify both (they only use `useMap`).

- [ ] **Step 1:** Change `import { useMap } from 'react-leaflet'` → `from '@/lib/streaflet'`. No other change.
- [ ] **Step 2:** tsc clean. **Step 3:** Commit each — `"refactor(map): migrate BboxDrawer to streaflet (#213)"`, etc.

### Task 17: Migrate MapView.tsx

**Files:** Modify `components/MapView.tsx` (the big one — `MapContainer`, `TileLayer`, `WMSTileLayer`, `Marker`, `CircleMarker`, `Rectangle`, `Pane`, `Tooltip`, `useMap`).

- [ ] **Step 1:** Swap the import block to `@/lib/streaflet`. Apply the `eventHandlers`→`onClick`/`on` and `pathOptions`→`style` transforms at each usage (lines noted in the spec survey: eventHandlers ~752/788, pathOptions ~389/746/821). Thread `pane={…}` where layers were nested under `<Pane>` (per Pane note in Task 9).
- [ ] **Step 2:** `npx tsc --noEmit -p tsconfig.web.json` clean.
- [ ] **Step 3:** Run desktop vitest for MapView + the full suite: `npx vitest run`. Green.
- [ ] **Step 4: Commit** — `"refactor(map): migrate MapView to streaflet (#213)"`.

### Task 18: Delete react-leaflet + verify

**Files:** Modify `desktop/package.json`, `desktop/package-lock.json`

- [ ] **Step 1: Confirm zero remaining imports**

Run (from repo root): `grep -rn "react-leaflet" desktop/src`
Expected: NO matches (only possibly a CSP comment in `main/security.ts` — leave or reword; it is not an import).

- [ ] **Step 2: Remove the deps**

```bash
cd desktop
npm remove react-leaflet @react-leaflet/core
```

- [ ] **Step 3: Verify the dependency is gone**

Run: `grep -n "react-leaflet" package.json` → no matches. `grep -rn "Hippocratic" node_modules/react-leaflet 2>/dev/null` → no such dir.

- [ ] **Step 4: Full gate**

Run (from `desktop/`): `npx tsc --noEmit -p tsconfig.web.json && npx vitest run`
Expected: tsc clean, full vitest green.

- [ ] **Step 5: Commit** — `git add package.json package-lock.json`, `git commit -m "chore(deps): drop react-leaflet/@react-leaflet/core (Hippocratic) for streaflet (#213)"`.

### Task 19: e2e map-flow gate

- [ ] **Step 1:** Ensure no dev app owns :8765, then run the map-relevant e2e flows:

Run (from repo root, PowerShell): `./scripts/run-e2e.ps1 flow_dov_bbox_cpt_import flow_dov_bbox_borehole_import flow_geology_stage_ui`
(If the positional filter is ignored, run the full suite; the map flows must be green. Pre-existing voxel/Build failures documented in debt #213 follow-up are NOT introduced by this work — compare against the known-failing set.)

- [ ] **Step 2:** Confirm the map renders, bbox import works, markers/overlays appear. If a map flow regressed, fix the migrated consumer before proceeding.

---

## PHASE 4 — Complete the general-purpose binding

Each component: write it, test it with `renderInMap`, red→green, commit, and add
its export to `index.ts`.

### Task 20: ImageOverlay

```tsx
import L from 'leaflet'
import { createTileComponent } from '../core/createTileComponent'
import type { EventedProps } from '../core/events'

export interface ImageOverlayProps extends EventedProps {
  url: string
  bounds: L.LatLngBoundsExpression
  opacity?: number
  zIndex?: number
}

export const ImageOverlay = createTileComponent<ImageOverlayProps, L.ImageOverlay>({
  createInstance: (props) =>
    L.imageOverlay(props.url, props.bounds, { opacity: props.opacity, zIndex: props.zIndex }),
  updateInstance: (img, props, prev) => {
    if (props.url !== prev.url) img.setUrl(props.url)
    if (props.bounds !== prev.bounds) img.setBounds(L.latLngBounds(props.bounds as L.LatLngBoundsExpression))
    if (props.opacity !== undefined && props.opacity !== prev.opacity) img.setOpacity(props.opacity)
  },
})
```

Test: one `L.ImageOverlay` added/removed. Commit. Export.

### Task 21: LayerGroup + FeatureGroup

```tsx
// LayerGroup.tsx
import L from 'leaflet'
import { createLayerComponent } from '../core/createLayerComponent'
import type { EventedProps } from '../core/events'
export type LayerGroupProps = EventedProps
export const LayerGroup = createLayerComponent<LayerGroupProps, L.LayerGroup>({
  createInstance: () => L.layerGroup(),
})
```

```tsx
// FeatureGroup.tsx
import L from 'leaflet'
import { createLayerComponent } from '../core/createLayerComponent'
import type { EventedProps } from '../core/events'
export type FeatureGroupProps = EventedProps
export const FeatureGroup = createLayerComponent<FeatureGroupProps, L.FeatureGroup>({
  createInstance: () => L.featureGroup(),
})
```

Test: nest a `Marker` inside; assert the marker attaches to the group (`group.getLayers().length === 1`), proving the factory's child-context container override works. Commit each. Export.

### Task 22: Popup

```tsx
import L from 'leaflet'
import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useStreafletContext } from '../core/MapContext'

export interface PopupProps {
  children?: ReactNode
  position?: L.LatLngExpression
  maxWidth?: number
  minWidth?: number
  autoPan?: boolean
  closeButton?: boolean
  className?: string
}

/** Popup bound to the parent layer (when nested) or opened at `position` on the map. */
export function Popup({ children, position, ...options }: PopupProps): JSX.Element {
  const ctx = useStreafletContext()
  const elRef = useRef<HTMLDivElement>(document.createElement('div'))

  useEffect(() => {
    const layer = ctx.layerContainer as unknown as L.Layer & { bindPopup?: L.Layer['bindPopup'] }
    if (typeof layer.bindPopup === 'function') {
      layer.bindPopup(elRef.current, options)
      return () => { layer.unbindPopup() }
    }
    const popup = L.popup(options).setContent(elRef.current)
    if (position) popup.setLatLng(position).openOn(ctx.map)
    return () => { ctx.map.closePopup(popup) }
    // reason: bind once on mount; React children update through the portal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return createPortal(children, elRef.current)
}
```

Test: nested in a Marker → `marker.getPopup()` defined. Commit. Export.

### Task 23: GeoJSON

```tsx
import L from 'leaflet'
import { createPathComponent, type PathProps } from '../core/createPathComponent'
import type { GeoJsonObject } from 'geojson'

export interface GeoJSONProps extends PathProps {
  data: GeoJsonObject
  onEachFeature?: L.GeoJSONOptions['onEachFeature']
  pointToLayer?: L.GeoJSONOptions['pointToLayer']
}

export const GeoJSON = createPathComponent<GeoJSONProps, L.GeoJSON>({
  createInstance: (props) =>
    L.geoJSON(props.data, {
      style: props.style ? () => props.style as L.PathOptions : undefined,
      onEachFeature: props.onEachFeature,
      pointToLayer: props.pointToLayer,
    }),
  updateInstance: (gj, props, prev) => {
    if (props.data !== prev.data) {
      gj.clearLayers()
      gj.addData(props.data)
    }
  },
})
```

Test: feed a Point feature; assert `gj.getLayers().length === 1`. Commit. Export.

### Task 24: Controls (ZoomControl, ScaleControl, AttributionControl, LayersControl)

```tsx
// controls/ZoomControl.tsx
import L from 'leaflet'
import { createControlComponent, type ControlProps } from '../../core/createControlComponent'
export type ZoomControlProps = ControlProps
export const ZoomControl = createControlComponent<ZoomControlProps, L.Control.Zoom>({
  createInstance: (props) => L.control.zoom({ position: props.position }),
})
```

```tsx
// controls/ScaleControl.tsx
import L from 'leaflet'
import { createControlComponent, type ControlProps } from '../../core/createControlComponent'
export interface ScaleControlProps extends ControlProps { metric?: boolean; imperial?: boolean }
export const ScaleControl = createControlComponent<ScaleControlProps, L.Control.Scale>({
  createInstance: (props) => L.control.scale({ position: props.position, metric: props.metric, imperial: props.imperial }),
})
```

```tsx
// controls/AttributionControl.tsx
import L from 'leaflet'
import { createControlComponent, type ControlProps } from '../../core/createControlComponent'
export interface AttributionControlProps extends ControlProps { prefix?: string | false }
export const AttributionControl = createControlComponent<AttributionControlProps, L.Control.Attribution>({
  createInstance: (props) => L.control.attribution({ position: props.position, prefix: props.prefix }),
})
```

```tsx
// controls/LayersControl.tsx — minimal: takes base/overlay records of {name: L.Layer}
import L from 'leaflet'
import { createControlComponent, type ControlProps } from '../../core/createControlComponent'
export interface LayersControlProps extends ControlProps {
  baseLayers?: Record<string, L.Layer>
  overlays?: Record<string, L.Layer>
  collapsed?: boolean
}
export const LayersControl = createControlComponent<LayersControlProps, L.Control.Layers>({
  createInstance: (props) =>
    L.control.layers(props.baseLayers, props.overlays, { position: props.position, collapsed: props.collapsed }),
})
```

Test each: `renderInMap(<ZoomControl/>)` then assert a `.leaflet-control-zoom` element exists in the container; unmount removes it. Commit each. Export each.

### Task 25: useMapEvent / useMapEvents

```ts
// hooks/useMapEvents.ts
import { useEffect } from 'react'
import type L from 'leaflet'
import { useMap } from './useMap'

/** Subscribe to a set of map events for the lifetime of the component. */
export function useMapEvents(handlers: L.LeafletEventHandlerFnMap): L.Map {
  const map = useMap()
  useEffect(() => {
    map.on(handlers)
    return () => { map.off(handlers) }
    // reason: handlers object is typically inline-stable per render; rebinding
    // every render would thrash — bind once, matching react-leaflet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map])
  return map
}
```

```ts
// hooks/useMapEvent.ts
import type L from 'leaflet'
import { useMapEvents } from './useMapEvents'

/** Subscribe to a single map event. */
export function useMapEvent(type: string, handler: L.LeafletEventHandlerFn): L.Map {
  return useMapEvents({ [type]: handler })
}
```

Test: render a child using `useMapEvent('zoomend', spy)` in a map; `map.setZoom(5)`; assert spy called. Commit. Export both.

### Task 26: Final barrel + full gate

- [ ] **Step 1:** Extend `index.ts` to export every Phase-4 component + hook + its props type.
- [ ] **Step 2:** Run the full gate:

Run (from `desktop/`): `npx tsc --noEmit -p tsconfig.web.json && npx vitest run`
Expected: tsc clean; the full streaflet suite + the rest of the desktop suite green.

- [ ] **Step 3: Commit** — `"feat(streaflet): complete general-purpose binding surface (#213)"`.

### Task 27: Close the debt

- [ ] **Step 1:** In `docs/debt.md`, mark `## 213.` RESOLVED with a one-paragraph summary (streaflet shipped; both Hippocratic packages removed; leaflet BSD-2 only). In `CLAUDE.md`'s Tier-B line, drop #213 / note it resolved.
- [ ] **Step 2: Commit each doc file** — `"docs(debt): mark #213 resolved (streaflet)"`, `"docs: drop #213 from Tier-B"`.

---

## Self-review notes (author check — completed)

- **Spec coverage:** every section-4/5 component has a task (Phase 1 core; Phase 2 used primitives; Phase 4 the rest); migration (§9) = Phase 3; license removal (§9) = Task 18; testing (§8) = renderInMap + per-component tests + Task 19 e2e; correctness rules (§7) = the create-once `useState` guard (Task 4/14), update-in-place (every `updateInstance`), event diff-binding (Task 2), container resolution (Task 4 child context + Task 21 test), ref fidelity (`useImperativeInstance`, Task 3).
- **Placeholder scan:** component bodies are complete; the few "mirror Task N's test" notes point at a concrete, already-shown test shape and name the exact assertions — not hidden code.
- **Type consistency:** `EventedProps`, `PathProps`, `ControlProps`, `StreafletContextValue`, `LayerFactory`, `createInstance`/`updateInstance`, `layerContainer`, `useStreafletContext`, `useImperativeInstance` are used identically across all tasks.
- **Known soft spots flagged for the implementer:** Tooltip/Popup binding when used as a *direct map child* (no parent layer) — verify against real usage in Task 17; the `pane` prop threading is deferred to the MapView migration (the only pane-nesting consumer).
