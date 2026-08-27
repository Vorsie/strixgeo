// electron-vite configuration.
//
// Cesium integration (G5 — 3D viewer):
//
// Cesium is imported as an ESM module (``import * as Cesium from 'cesium'``)
// and bundled directly by Vite from ``cesium/Source/Cesium.js``.
//
// Cesium static assets (Workers, Assets, ThirdParty, Widgets) are copied to
// ``out/renderer/cesium/`` by ``scripts/copy-cesium.mjs``, which the
// ``build`` npm script chains after ``electron-vite build``.
//
// ``CESIUM_BASE_URL`` is defined via Vite's ``define`` and as a rollup output
// ``intro`` (window-global preamble) so Cesium's worker resolver finds the
// right base at runtime.  In production Electron uses ``file://`` and
// electron-vite sets ``base = './'``, so ``'./cesium/'`` is the correct
// relative path.  In dev the dev-server middleware (``cesiumDevServerPlugin``)
// serves the CesiumUnminified assets at ``/cesium/``.

import { resolve } from 'path'
import serveStatic from 'serve-static'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

const CESIUM_UNMINIFIED_PATH = resolve(
  __dirname,
  'node_modules/cesium/Build/CesiumUnminified',
)

/**
 * Dev-only Vite plugin that serves Cesium static assets at ``/cesium/``.
 *
 * Required because Cesium's worker scripts resolve via ``CESIUM_BASE_URL``
 * at runtime.  In dev the renderer loads from the Vite dev server
 * (``http://localhost:PORT``), so the workers must be served from the same
 * origin at ``/cesium/Workers/``.  This middleware satisfies those fetches.
 *
 * Production assets are copied by ``scripts/copy-cesium.mjs`` (chained in
 * the ``build`` npm script).
 *
 * Returns
 * -------
 * Plugin
 *     The dev-server middleware plugin.
 */
function cesiumDevServerPlugin(): Plugin {
  return {
    name: 'cesium-dev-server',
    apply: 'serve',
    configureServer({ middlewares }) {
      middlewares.use(
        '/cesium/',
        serveStatic(CESIUM_UNMINIFIED_PATH, {
          setHeaders: res => {
            res.setHeader('Access-Control-Allow-Origin', '*')
          },
        }) as ReturnType<typeof serveStatic>,
      )
    },
  }
}

// Beta-expiry stamp: no configuration needed here. electron-vite already
// exposes ``MAIN_VITE_``-prefixed environment variables to the main bundle
// through ``import.meta.env``, which is what src/main/buildStamp.ts reads.
// Do NOT add a ``main.define`` entry for it — the main bundle is an SSR build
// and Vite's define substitution does not reach one, so it would fail
// silently (see src/main/buildStampGlobals.d.ts).

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts')
        },
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    // CESIUM_BASE_URL is consumed by cesium's buildModuleUrl.js to locate
    // worker scripts.  electron-vite sets base = './' for production builds
    // so './cesium/' resolves relative to index.html — correct for file://.
    // In dev, the cesiumDevServerPlugin serves workers at /cesium/.
    define: {
      CESIUM_BASE_URL: JSON.stringify(
        process.env.NODE_ENV_ELECTRON_VITE === 'production'
          ? './cesium/'
          : '/cesium/',
      ),
    },
    // Cesium's worker scripts (Workers/transferTypedArrayTest.js,
    // createVerticesFromHeightmap.js, ...) are not static ESM — they are
    // resolved at runtime via CESIUM_BASE_URL and loaded by the browser as
    // plain JS.  Vite's dep-optimizer cannot crawl them and breaks with
    // "file not found" during pre-bundling.  Excluding cesium from
    // optimizeDeps lets the dev server serve it raw; production is
    // unaffected (rollup bundles cesium directly from Source/Cesium.js).
    //
    // force: true — required so the dev optimizer actually re-runs when the
    // exclude list changes.  Without it a stale node_modules/.vite/deps cache
    // (from before the exclude was added) continues pre-bundling cesium and
    // the Workers/ resolution fails at runtime.  This ensures every dev start
    // produces a cache that genuinely lacks a cesium.js pre-bundle entry.
    //
    // INTENTIONALLY PERMANENT — do not remove during tidy passes.
    // Cesium's runtime Workers/ tree is fragile enough that a stale-cache
    // reintroduction on every `npm install` outweighs the ~2-5 s cold-boot
    // cost.  Removing force: true causes silent runtime failures that are
    // hard to diagnose (workers 404 on first launch after a clean install).
    optimizeDeps: {
      exclude: ['cesium'],
      force: true,
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html')
        },
        output: {
          // Window-global preamble — ensures CESIUM_BASE_URL is available
          // before any Cesium module code runs (IIFE fallback path in
          // buildModuleUrl.js reads it via typeof CESIUM_BASE_URL).
          intro: `window.CESIUM_BASE_URL = './cesium/';`,
        },
      }
    },
    plugins: [react(), cesiumDevServerPlugin()]
  }
})
