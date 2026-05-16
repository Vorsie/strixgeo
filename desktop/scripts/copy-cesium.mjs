/**
 * copy-cesium.mjs — post-build script that copies Cesium static assets to
 * the Electron renderer output directory.
 *
 * Run automatically as part of ``npm run build`` (chained after
 * ``electron-vite build``).  This script is NOT a Vite plugin — it avoids
 * the vite-plugin-cesium ``closeBundle`` Windows path-join bug where
 * ``path.join(absoluteRoot, absoluteOutDir)`` produces a mangled path on
 * Windows, silently skipping the copy.
 *
 * Assets copied from ``node_modules/cesium/Build/Cesium/`` to
 * ``out/renderer/cesium/``:
 *   Assets/       — imagery textures, fonts, stars
 *   Workers/      — web worker scripts (required for geometry processing)
 *   ThirdParty/   — third-party shaders/assets Cesium bundles
 *   Widgets/      — CSS for the default Cesium widget UI elements
 */

import { copySync, ensureDirSync } from 'fs-extra/esm'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CESIUM_BUILD = resolve(__dirname, '..', 'node_modules', 'cesium', 'Build', 'Cesium')
const CESIUM_OUT = resolve(__dirname, '..', 'out', 'renderer', 'cesium')

const ASSET_DIRS = ['Assets', 'Workers', 'ThirdParty', 'Widgets']

ensureDirSync(CESIUM_OUT)

let ok = true
for (const dir of ASSET_DIRS) {
  const src = resolve(CESIUM_BUILD, dir)
  const dest = resolve(CESIUM_OUT, dir)
  try {
    copySync(src, dest, { overwrite: true })
    console.log(`[copy-cesium] ✓ ${dir}`)
  } catch (err) {
    console.error(`[copy-cesium] ✗ ${dir}: ${err.message}`)
    ok = false
  }
}

if (ok) {
  console.log(`[copy-cesium] Cesium assets copied to ${CESIUM_OUT}`)
} else {
  process.exit(1)
}
