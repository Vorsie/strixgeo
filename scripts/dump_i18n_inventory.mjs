// Dump the i18n catalogue as JSON for offline tooling (sentence authoring,
// review chunking). Reuses the same esbuild bundling as the table generator so
// the values are the real ones.
//
//   node scripts/dump_i18n_inventory.mjs > out.json

import { createRequire } from 'node:module'
import { writeFileSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const I18N = join(REPO, 'desktop/src/renderer/src/i18n')

const require = createRequire(pathToFileURL(join(REPO, 'desktop/package.json')))
const { build } = require('esbuild')

const entry = join(HERE, '.i18n-inv-entry.mjs')
const bundle = join(HERE, '.i18n-inv-bundle.mjs')

writeFileSync(
  entry,
  [
    `export { EN, EN_MODULES } from ${JSON.stringify(join(I18N, 'locales/en/index.ts'))}`,
    `export { NL } from ${JSON.stringify(join(I18N, 'locales/nl/index.ts'))}`,
  ].join('\n'),
)

await build({
  entryPoints: [entry],
  outfile: bundle,
  bundle: true,
  format: 'esm',
  platform: 'node',
  logLevel: 'warning',
})

const { EN, EN_MODULES, NL } = await import(pathToFileURL(bundle).href)

const rows = []
for (const [surface, table] of Object.entries(EN_MODULES)) {
  for (const key of Object.keys(table)) {
    rows.push({ key, surface, en: EN[key], nl: NL[key] ?? null })
  }
}

rmSync(entry, { force: true })
rmSync(bundle, { force: true })
process.stdout.write(JSON.stringify(rows, null, 1))
