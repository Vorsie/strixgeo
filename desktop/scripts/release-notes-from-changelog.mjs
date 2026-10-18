// CLI of the release-notes rule for .github/workflows/release.yml:
//   node scripts/release-notes-from-changelog.mjs <version> <out-file>
// writes the CHANGELOG.md section of <version> to <out-file>, or exits 1 when
// the section is missing (write the changelog before the tag).
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { changelogSection } from './changelogSection.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const [version, outFile] = process.argv.slice(2)
if (!version || !outFile) {
  console.error('[release-notes] usage: release-notes-from-changelog.mjs <version> <out-file>')
  process.exit(2)
}
const markdown = readFileSync(resolve(repoRoot, 'CHANGELOG.md'), 'utf8')
const section = changelogSection(markdown, version)
if (section === null) {
  console.error(`[release-notes] CHANGELOG.md has no "## [${version}]" section; write it before tagging`)
  process.exit(1)
}
writeFileSync(outFile, `${section}\n`, 'utf8')
console.log(`[release-notes] wrote ${section.split('\n').length} line(s) of notes for ${version} to ${outFile}`)
