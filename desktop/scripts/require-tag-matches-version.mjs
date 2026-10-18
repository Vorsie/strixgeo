// CLI of the tag/version rule for .github/workflows/release.yml: exits 1 with
// the reason when the pushed tag does not name desktop/package.json's version.
// Reads the tag from GITHUB_REF_NAME (or argv[2] for a local check).
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { tagMatchesVersion } from './tagVersion.mjs'

const desktopDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(resolve(desktopDir, 'package.json'), 'utf8'))
const tag = process.argv[2] ?? process.env.GITHUB_REF_NAME ?? ''
const verdict = tagMatchesVersion(tag, String(pkg.version))
console.log(`[tag-guard] ${verdict.message}`)
if (!verdict.ok) process.exit(1)
