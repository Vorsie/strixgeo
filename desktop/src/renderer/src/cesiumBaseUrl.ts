// Cesium base-URL bootstrap — MUST be imported before any module that
// imports `cesium` (it is the first import in main.tsx).
//
// Why this exists: Cesium resolves its Workers/ + Assets/ tree from
// `window.CESIUM_BASE_URL` (read by buildModuleUrl.js the first time a
// Cesium module evaluates). The electron-vite config wires it via a
// build-only rollup `intro` and a Vite `define`, but in DEV neither
// reliably reaches Cesium: `define` is not applied to the raw-served
// `optimizeDeps.exclude: ['cesium']` module, and the rollup `intro`
// only runs in production builds. With no base, Cesium falls back to
// its own module URL (`.vite/deps/`) and every Workers/Assets fetch
// 404s — surfacing as "Workers/createVerticesFromHeightmap.js does not
// exist" and a `<!DOCTYPE … is not valid JSON` crash from an Assets
// JSON fetch returning the SPA index.html. Setting the global here,
// for both dev and prod, makes the resolution deterministic regardless
// of the define/exclude interplay.
//
// Dev: the cesiumDevServerPlugin serves CesiumUnminified at `/cesium/`.
// Prod: electron-vite base = './', file:// — `./cesium/` is copied by
// scripts/copy-cesium.mjs next to index.html.

declare global {
  interface Window {
    CESIUM_BASE_URL?: string
  }
  // Vite injects ``import.meta.env`` at build time. The Vite-provided
  // ambient types live in `vite/client`, but the renderer tsconfig
  // doesn't pull them in (and adding the dependency for one access
  // is overkill). Local augmentation is enough — tsc otherwise flags
  // ``Property 'env' does not exist on type 'ImportMeta'``.
  interface ImportMeta {
    env: { PROD: boolean }
  }
}

window.CESIUM_BASE_URL = import.meta.env.PROD ? './cesium/' : '/cesium/'

export {}
