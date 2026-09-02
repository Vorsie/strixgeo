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

export default defineConfig({
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
