# streaflet — a first-party React binding for Leaflet (design)

**Date:** 2026-06-16
**Debt item:** #213 (`react-leaflet` Hippocratic-2.1 license risk)
**Status:** design approved; ready for an implementation plan

---

## 1. Problem & goal

`react-leaflet@4.2.1` and `@react-leaflet/core@2.1.0` are published under the
**Hippocratic License 2.1** — non-OSI, with activity-based use restrictions that
are a procurement/legal friction point for a commercial closed-source product
targeting BE/NL consultancies (some serving public-works clients). `leaflet`
itself is **BSD-2-Clause** (permissive).

**Goal:** replace react-leaflet with **streaflet**, a first-party React binding
over bare `leaflet`, and delete both Hippocratic packages from `package.json` +
the lockfile. The map must render and behave identically. We take the
opportunity to ship a *cleaner, fully-typed, general-purpose* binding — "the best
there is" — not a one-to-one shim.

**Non-goals:** dropping Leaflet for Cesium (explicitly out — owner chose to keep
Leaflet); SSR support (Electron only); a published npm package (internal lib).

---

## 2. Decisions (owner-confirmed 2026-06-16)

- **Cleaner custom API**, not a react-leaflet drop-in. The 5 consumers migrate.
- **Full general-purpose binding**, not only-what's-used — but built on an
  extensible core so each component stays small.
- **Events:** first-class typed props (`onClick`, `onMouseOver`, …) **plus** an
  `on={{ anyleafletevent: handler }}` escape hatch for the long tail.
- **Name:** `streaflet`.

---

## 3. Module layout

Self-contained library under the renderer:

```
desktop/src/renderer/src/lib/streaflet/
  index.ts                 # public barrel — the only import surface
  core/
    MapContext.ts          # React context { map, layerContainer }
    createLayerComponent.ts
    createPathComponent.ts
    createTileComponent.ts
    createOverlayComponent.ts
    createControlComponent.ts
    events.ts              # LEAFLET_EVENTS map + bind/diff/unbind helper
    lifecycle.ts           # useLayerLifecycle, useImperativeRef
  components/
    MapContainer.tsx
    Pane.tsx  LayerGroup.tsx  FeatureGroup.tsx
    TileLayer.tsx  WMSTileLayer.tsx  ImageOverlay.tsx
    Polyline.tsx  Polygon.tsx  Rectangle.tsx  Circle.tsx  CircleMarker.tsx
    Marker.tsx  Popup.tsx  Tooltip.tsx
    GeoJSON.tsx
    controls/ ZoomControl.tsx  ScaleControl.tsx  AttributionControl.tsx  LayersControl.tsx
  hooks/
    useMap.ts  useMapEvent.ts  useMapEvents.ts
  types.ts                 # shared prop types, event prop maps
  __tests__/               # vitest specs (one per component + core)
```

Consumers import only from the barrel: `import { MapContainer, Marker, useMap } from '@/lib/streaflet'`.

---

## 4. Core architecture

The hard problem of any React↔Leaflet binding: a Leaflet object has an
imperative lifecycle (`new L.Marker(...).addTo(map)`, `marker.setLatLng(...)`,
`marker.remove()`) that must stay in sync with React's declarative re-renders.
We solve this **once** in `core/` and build every component on it.

### 4.1 MapContext

```ts
interface StreafletContext {
  map: L.Map
  layerContainer: L.Map | L.LayerGroup  // nearest Pane/group, else the map
}
```

`MapContainer` creates the `L.Map` and provides the context. Container
components (`Pane`, `LayerGroup`, `FeatureGroup`) override `layerContainer` for
their subtree so nested layers attach to the right parent.

### 4.2 Factory functions

Each factory takes a `createInstance(props, context) → L.Layer` and an
`updateInstance(instance, props, prevProps)` and returns a finished component
that handles mount / prop-diff-update / unmount / events / ref. Variants:

- `createLayerComponent` — generic `L.Layer` (base).
- `createPathComponent` — vector layers; adds the `style` (PathOptions) prop.
- `createTileComponent` — raster layers.
- `createOverlayComponent` — `Marker`/`Popup`/`Tooltip` (position + open/close).
- `createControlComponent` — `L.Control`; adds to map, removes on unmount,
  honours the `position` prop.

**Invariant:** `updateInstance` mutates the existing Leaflet object in place; a
component **never** recreates its instance on a prop change (only on unmount).

### 4.3 Core hooks

- `useLayerLifecycle(instance)` — `addTo(layerContainer)` on mount,
  `remove()` on unmount; re-parent if the container changes.
- `useEventHandlers(instance, props)` — diff the resolved event set (direct
  props + `on`) against the previous render; `off` removed, `on` added; never
  blanket re-bind.
- `useImperativeRef(forwardedRef, instance)` — point `ref` at the `L.*` object.

---

## 5. Component catalogue

| Group | Components |
|---|---|
| Map | `MapContainer` (creates `L.Map`, forwards ref) |
| Container | `Pane`, `LayerGroup`, `FeatureGroup` |
| Raster | `TileLayer`, `WMSTileLayer`, `ImageOverlay` |
| Vector | `Polyline`, `Polygon`, `Rectangle`, `Circle`, `CircleMarker` |
| Overlay | `Marker`, `Popup`, `Tooltip` |
| Data | `GeoJSON` |
| Controls | `ZoomControl`, `ScaleControl`, `AttributionControl`, `LayersControl` |
| Hooks | `useMap`, `useMapEvent`, `useMapEvents` |

All ten components the app uses today (`MapContainer`, `TileLayer`,
`WMSTileLayer`, `Marker`, `CircleMarker`, `Rectangle`, `Polygon`, `Polyline`,
`Pane`, `Tooltip`) plus `useMap` ship in Phases 1–2; the remainder in Phase 4.

---

## 6. API conventions

- **Events** — generated from a typed `LEAFLET_EVENTS` map
  (`{ onClick: 'click', onMouseOver: 'mouseover', onDragEnd: 'dragend',
  onMoveEnd: 'moveend', … }`). Each interactive component accepts those props
  **and** `on?: Partial<Record<LeafletEventName, Handler>>` for anything not
  promoted. Handlers are diffed and rebound only on change.
- **Styling** — vector components take `style?: L.PathOptions` (clean alias;
  replaces react-leaflet's `pathOptions`). Full type coverage retained.
- **Geometry props** — `position` (Marker), `center` + `radius` (Circle/
  CircleMarker), `bounds` (Rectangle/ImageOverlay), `positions` (Polyline/
  Polygon), `url`/`attribution` (tiles), `icon` (Marker).
- **Refs** — every component forwards `ref` to its `L.*` instance;
  `MapContainer` to `L.Map`. The imperative escape is always available.
- **Children** — `Tooltip`/`Popup` nest inside `Marker`/path components;
  layers nest inside `Pane`/`FeatureGroup`/`LayerGroup`.

---

## 7. Correctness rules (each test-pinned)

1. **Create-once map** — `MapContainer` instantiates `L.Map` exactly once and
   is React-StrictMode double-mount safe; `map.remove()` on unmount.
2. **Update-in-place** — a prop change calls `updateInstance`, never a
   destroy+recreate (asserted by identity of the underlying `L.*` object).
3. **No event leaks** — every handler bound on mount/update is `off()`'d on
   unmount; changed handlers are swapped, not stacked.
4. **Container resolution** — a layer attaches to the nearest `Pane`/group via
   context, falling back to the map.
5. **Ref fidelity** — `ref.current` is the live `L.*` instance after mount and
   `null` after unmount.

---

## 8. Testing strategy

- **Unit (vitest + jsdom)** — real `leaflet` rendered into jsdom via
  `@testing-library/react`. Per component: mounts + adds to map, prop-update
  mutates in place (object identity stable), an event prop fires its handler,
  unmount removes + unbinds, `ref` resolves. The core factories are tested
  directly with a minimal fake `createInstance`. Where jsdom can't model
  Leaflet behaviour (pixel sizing, animations), assert against a thin `L` spy
  instead of the rendered result.
- **Types** — `tsc --noEmit -p tsconfig.web.json` clean; no `any` in the public
  surface; event-prop and style types check against `@types/leaflet`.
- **e2e (Playwright)** — the existing map flows are the real-browser gate: map
  render/boot, DOV bbox CPT + borehole import, the bbox drawer, the
  section-line drawer, section overlays, the tie-suggestion overlay. Green here
  = behaviourally identical to react-leaflet.

---

## 9. Migration & license removal

The 5 consumers (`MapView.tsx`, `BboxDrawer.tsx`, `SectionLineDrawer.tsx`,
`SectionOverlays.tsx`, `TieSuggestionOverlay.tsx`) migrate mechanically:

- import path: `'react-leaflet'` → `'@/lib/streaflet'`;
- `eventHandlers={{ click: f, mouseover: g }}` → `onClick={f} onMouseOver={g}`
  (or `on={{ … }}` for un-promoted events);
- `pathOptions={{ … }}` → `style={{ … }}`;
- everything else (geometry props, children, `useMap()`) is structurally
  identical.

Then remove `react-leaflet` and `@react-leaflet/core` from
`desktop/package.json`, refresh `package-lock.json`, and grep the renderer to
confirm zero remaining imports of either. `leaflet` (BSD-2) is the only map
dependency left — #213 resolved.

---

## 10. Phasing (one spec, sequenced so the license-critical path lands first)

1. **Core** — `MapContext`, the five factories, `events.ts`, `lifecycle.ts`,
   `useMap`, shared types. Unit tests for the factories + context.
2. **Used primitives** — `TileLayer`, `WMSTileLayer`, `Marker`, `CircleMarker`,
   `Rectangle`, `Polygon`, `Polyline`, `Pane`, `Tooltip`. Unit tests each.
3. **Migrate the 5 consumers + delete react-leaflet.** App is license-clean and
   green at the end of this phase (tsc + vitest + the e2e map flows).
4. **Complete the binding** — `Popup`, `GeoJSON`, `ImageOverlay`, `Circle`,
   `LayerGroup`, `FeatureGroup`, the four controls, `useMapEvent(s)`. Unit
   tests each. Delivers the full general-purpose surface.

**Definition of done:** both Hippocratic packages gone; only `leaflet` remains;
tsc clean; new vitest suite green; the e2e map flows green; the map is visually
and behaviourally identical in light + dark mode.

---

## 11. Risks & mitigations

- **StrictMode double-invoke** recreating the map → guard map creation behind a
  ref + create-once check; test it.
- **jsdom can't fully render Leaflet** → hybrid tests (real-leaflet where it
  works, `L` spy where it doesn't) + e2e as the real gate.
- **Subtle behaviour drift on a core surface** (drag, zoom-to-bounds, pane
  z-order) → the existing e2e map flows + the section drawers are the
  regression net; migrate one consumer at a time within Phase 3.
- **Event double-binding leaks** → the diff-bind/unbind helper is unit-tested
  for the add/change/remove cases explicitly.
