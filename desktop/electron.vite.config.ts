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
// the main bundle (its main-build envPrefix is ``MAIN_VITE_``), the SAME channel
// the beta stamp rides. Set the two vars into the environment HERE, at config
// load — before Vite resolves env for any build — rather than via Vite ``define``
// (which does not reach the SSR main bundle; see src/main/buildStampGlobals.d.ts).
// The resolvers no-op when the vars are already set, so a CI-pinned SHA wins.
// ``require-beta-stamp.mjs post`` greps out/main/index.js for the SHA, so if this
// injection ever silently fails the package fails instead of shipping blind.
process.env.MAIN_VITE_STRIX_BUILD_SHA = resolveBuildSha()
process.env.MAIN_VITE_STRIX_BUILD_TIME = resolveBuildTime()
// The beta stamp needs THREE values (buildStamp.ts: a stamp without ``builtAt`` reads
// as no stamp at all — the 07:03 installer shipped unstamped that way). The
// packager only has to set the expiry; built-at and build id derive from the
// build itself so the stamp can never be half-set again.
if (process.env.MAIN_VITE_STRIX_BETA_EXPIRES_AT) {
  process.env.MAIN_VITE_STRIX_BETA_BUILT_AT ??= process.env.MAIN_VITE_STRIX_BUILD_TIME
  process.env.MAIN_VITE_STRIX_BETA_BUILD_ID ??=
    `${(process.env.MAIN_VITE_STRIX_BUILD_TIME ?? '').slice(0, 10)}-beta-${(process.env.MAIN_VITE_STRIX_BUILD_SHA ?? 'nosha').slice(0, 12)}`
}

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
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          sheet: resolve(__dirname, 'src/renderer/sheet.html'),
        },
      },
    },
  },
})
