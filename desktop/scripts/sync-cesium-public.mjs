/**
 * sync-cesium-public.mjs — copy Cesium's runtime static tree into the
 * renderer's Vite public/ dir so the dev server serves it natively at
 * ``/cesium/`` (before the SPA HTML fallback, with correct JS MIME).
 *
 * Why public/ instead of a dev middleware: a configureServer
 * serve-static middleware kept losing to Vite's history/HTML fallback
 * for ``/cesium/Workers/*.js`` (the response came back as text/html →
 * "Failed to load module script" → Cesium half-initialises → broken
 * 3D camera/basemap/split). Vite serves ``public/`` deterministically
 * ahead of the fallback in BOTH dev and the production build, so this
 * removes the ordering fragility entirely.
 *
 * Idempotent: skips the copy when the destination Workers/ dir already
 * exists, so ``predev`` stays fast (only the first run after a clean
 * install pays the copy cost).
 */
import { existsSync, cpSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const SRC = resolve(here, '../node_modules/cesium/Build/CesiumUnminified')
const DEST = resolve(here, '../src/renderer/public/cesium')

const SUBDIRS = ['Workers', 'Assets', 'ThirdParty', 'Widgets']

if (existsSync(resolve(DEST, 'Workers'))) {
  console.log('[sync-cesium-public] up to date — skipping copy')
  process.exit(0)
}

mkdirSync(DEST, { recursive: true })
for (const sub of SUBDIRS) {
  const from = resolve(SRC, sub)
  if (!existsSync(from)) {
    console.warn(`[sync-cesium-public] missing ${sub} in CesiumUnminified`)
    continue
  }
  cpSync(from, resolve(DEST, sub), { recursive: true })
  console.log(`[sync-cesium-public] ✓ ${sub}`)
}
console.log(`[sync-cesium-public] Cesium assets synced to ${DEST}`)
