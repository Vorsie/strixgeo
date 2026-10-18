// Release-notes source of the hosted installer build: the "## [<version>]"
// section of CHANGELOG.md (Keep a Changelog). The workflow writes it into the
// draft release so the changelog is written BEFORE the tag; a missing section
// is a build failure, not an empty release. Pure so it is unit tested;
// release-notes-from-changelog.mjs is the CLI.

/**
 * Extract the body of one version's section from a Keep a Changelog file.
 *
 * @param {string} markdown - The whole CHANGELOG.md text (LF or CRLF).
 * @param {string} version - A released semver such as ``0.2.1``; ``Unreleased``
 *   is refused because it is not a release.
 * @returns {string | null} The trimmed body between ``## [<version>]`` and the
 *   next ``## [`` heading or the link-reference block, or ``null`` when the
 *   section is absent.
 */
export function changelogSection(markdown, version) {
  if (version === 'Unreleased') return null
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const heading = `## [${version}]`
  const start = lines.findIndex(line => line.startsWith(heading))
  if (start === -1) return null
  const body = []
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('## [')) break
    if (/^\[[^\]]+\]:\s/.test(line)) break
    body.push(line)
  }
  const text = body.join('\n').trim()
  return text === '' ? null : text
}
