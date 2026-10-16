// electron-vite reads THIS filename (dot-separated). The repo carried a
// hyphenated ``electron-vite.config.ts`` for months that electron-vite never
// loaded, so every dev run and build ran on the defaults — and worked, because
// ``src/renderer/src/main.tsx`` sets ``window.CESIUM_BASE_URL`` itself and
// ``scripts/copy-cesium.mjs`` ships the Cesium assets. This config therefore
// stays MINIMAL on purpose: the defaults that were proven in production, plus
// the one thing they cannot express — a second renderer entry, ``sheet.html``,
// the cross-section PDF sheet (docs/superpowers/specs/2026-09-02-section-pdf-sheet-design.md).
// Activating the old file's Cesium ``define`` / ``intro`` / dev-server plugin
// would be a first-ever behaviour change; it is recorded in docs/debt.md and is
// not folded in here.
import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import { resolveBuildSha, resolveBuildTime } from './scripts/buildProvenance.mjs'

// Build provenance (production-readiness audit 2026-09-02, C4: the artifact
// carried no git SHA). electron-vite inlines ``import.meta.env.MAIN_VITE_*`` into
// the main bundle (its main-build envPrefix is ``MAIN_VITE_``). Set the two vars
// into the environment HERE, at config load (before Vite resolves env for any
// build), rather than via Vite ``define``
// (which does not reach the SSR main bundle; see src/main/buildStampGlobals.d.ts).
// The resolvers no-op when the vars are already set, so a CI-pinned SHA wins.
// ``require-build-sha.mjs`` greps out/main/index.js for the SHA, so if this
// injection ever silently fails the package fails instead of shipping blind.
process.env.MAIN_VITE_STRIX_BUILD_SHA = resolveBuildSha()
process.env.MAIN_VITE_STRIX_BUILD_TIME = resolveBuildTime()

export default defineConfig({
  // main + preload: the defaults electron-vite applied when NO config was loaded.
  // Spelled out because a config file with only a ``renderer`` section made
  // electron-vite skip the other two builds, leaving stale out/main + out/preload
  // (found 2026-09-02: a preload bridge missing at runtime after a clean build).
  main: {
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/main/index.ts') } } },
  },
  preload: {
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/preload/index.ts') } } },
  },
  renderer: {
    build: {
      // Emit renderer sourcemaps ONLY for the e2e build (scripts/run-e2e.ps1
      // sets E2E_SOURCEMAP=1), so a walker page error can be resolved from
      // ``assets/<chunk>.js:line:col`` back to ``src/...`` via the .map. The
      // production installer build (``npm run dist``) never sets it, so shipped
      // bundles carry no maps.
      sourcemap: process.env.E2E_SOURCEMAP === '1',
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          sheet: resolve(__dirname, 'src/renderer/sheet.html'),
        },
      },
    },
  },
})
