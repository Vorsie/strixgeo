// Inert Cesium stub for jsdom component-mount smoke tests (debt #41b).
//
// `Cesium.CesiumWidget` constructs a real WebGL2 context, which jsdom does
// not provide, so a component that does `import * as Cesium from 'cesium'`
// cannot mount under vitest without a stub. Rather than hand-stub the dozens
// of Cesium symbols a viewer touches (CesiumWidget, Scene, Camera, Primitive,
// Cartesian3, Color, …), this module auto-vivifies EVERY symbol: any property
// access yields a stub that is itself callable, constructable, assignable, and
// recursively property-accessible. The component mounts; its mount/rebuild
// effects run their Cesium calls as no-ops.
//
// This is a *shell* harness — it does NOT exercise real Cesium math. The pure
// coordinate math the viewer relies on lives in `cesiumGeometry.ts` and is
// unit-tested there against real inputs (debt #41 part a). The smoke's job is
// the component shell: effect wiring, the `widgetRef.current == null` guards,
// and rebuilds across prop changes — the `flyToCutFace`-ReferenceError bug
// class that pure-math tests cannot reach.

/**
 * Build one inert stub: callable, constructable, assignable, and recursively
 * property-accessible. Every access returns another stub so deep chains like
 * `widget.scene.postProcessStages.fxaa.enabled = true` never throw.
 */
function makeStub(): unknown {
  const target = function stub(): void {}
  // Property bag for this stub — keyed access on the function object itself.
  const store = target as unknown as Record<string | symbol, unknown>
  return new Proxy(target, {
    get(_t, prop) {
      // Coerce cleanly to 0 / "0" if a stub leaks into arithmetic or a
      // template string, so numeric code paths degrade instead of throwing.
      if (prop === Symbol.toPrimitive) return () => 0
      // Never look like a thenable — an awaited stub must not hang.
      if (prop === 'then') return undefined
      if (!(prop in store)) store[prop] = makeStub()
      return store[prop]
    },
    set(_t, prop, value) {
      store[prop] = value
      return true
    },
    construct() {
      return makeStub() as object
    },
    apply() {
      return makeStub()
    },
  })
}

/**
 * Module-namespace stub returned to `vi.mock('cesium', …)`. Property access
 * (`Cesium.CesiumWidget`, `Cesium.Ion`, `Cesium.Cartesian3`, …) auto-vivifies
 * an inert stub; `default` points back at the namespace for interop.
 */
export const cesiumNamespaceMock: Record<string, unknown> = new Proxy(
  {} as Record<string, unknown>,
  {
    get(t, prop) {
      if (prop === '__esModule') return true
      if (prop === 'default') return cesiumNamespaceMock
      if (prop === 'then') return undefined
      if (!(prop in t)) t[prop as string] = makeStub()
      return t[prop as string]
    },
  },
)
