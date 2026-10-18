// Unit tests for the release-notes extraction of the hosted installer build.
// The rule: the draft release body is the "## [<version>]" section of
// CHANGELOG.md (Keep a Changelog), up to the next "## [" heading; a missing
// section is null so the workflow fails before staging. Pure: the markdown is
// an argument.
import { describe, expect, it } from 'vitest'

import { changelogSection } from './changelogSection.mjs'

const CHANGELOG = [
  '# Changelog',
  '',
  '## [Unreleased]',
  '',
  '- Something pending.',
  '',
  '## [0.2.1] - 2026-10-25',
  '',
  '### Fixed',
  '',
  '- A bug.',
  '',
  '## [0.2.0] - 2026-10-17',
  '',
  '- Open source.',
  '',
  '[0.2.1]: https://example.invalid/0.2.1',
].join('\n')

describe('changelogSection', () => {
  it('CS1: returns the body of the version section without its heading', () => {
    expect(changelogSection(CHANGELOG, '0.2.1')).toBe('### Fixed\n\n- A bug.')
  })

  it('CS2: the last section ends at the link reference block or the end of file', () => {
    expect(changelogSection(CHANGELOG, '0.2.0')).toBe('- Open source.')
  })

  it('CS3: a version without a section is null', () => {
    expect(changelogSection(CHANGELOG, '0.3.0')).toBeNull()
  })

  it('CS4: Unreleased is never a release section', () => {
    expect(changelogSection(CHANGELOG, 'Unreleased')).toBeNull()
  })

  it('CS5: CRLF input yields the same body', () => {
    expect(changelogSection(CHANGELOG.replace(/\n/g, '\r\n'), '0.2.1')).toBe('### Fixed\n\n- A bug.')
  })
})
