# Hosted Windows installer build: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a push of a `v<semver>` tag builds the Windows installer on a GitHub-hosted `windows-2022` runner and attaches it to a draft release of that tag; a manual dispatch builds without publishing. Spec: `docs/superpowers/specs/2026-10-18-hosted-installer-build-design.md`.

**Architecture:** one new workflow `.github/workflows/release.yml` that runs the existing `npm run release` / `npm run dist` chain unchanged; three small Node scripts in `desktop/scripts/` (pure function + thin CLI each, Vitest-tested); the release guard's "pushed" rule becomes a pure function so it can accept a GitHub Actions checkout; docs and the debt backlog updated.

**Tech Stack:** GitHub Actions (SHA-pinned actions as in `ci.yml`), Node 22 ESM scripts, Vitest, pytest for the workflow-shape test, Windows PowerShell 5.1 staging scripts (unchanged).

**Conventions:** English only; no em-dashes; every `.mjs` script has a header comment that says what it gates and why; every pure function has a JSDoc block; Vitest files sit next to the script (`<name>.test.ts`, test ids like `TV1`, `CS1`, `PC1`); commits are made by the session main, never by the builder; the builder leaves the working tree changed and reports.

---

### Task 1: `tagMatchesVersion` + `require-tag-matches-version.mjs`

**Files:**
- Create: `desktop/scripts/tagVersion.mjs`
- Create: `desktop/scripts/tagVersion.test.ts`
- Create: `desktop/scripts/require-tag-matches-version.mjs`

- [ ] **Step 1: Write the failing test**

```ts
// Unit tests for the tag/version guard of the hosted installer build. The
// rule: a release tag v<semver> must name exactly the version in
// desktop/package.json, so a tag pushed on the wrong tree fails before any
// staging starts. Pure: tag and version are arguments.
import { describe, expect, it } from 'vitest'

import { tagMatchesVersion } from './tagVersion.mjs'

describe('tagMatchesVersion', () => {
  it('TV1: v0.2.1 matches package version 0.2.1', () => {
    expect(tagMatchesVersion('v0.2.1', '0.2.1')).toEqual({ ok: true, message: 'tag v0.2.1 matches package version 0.2.1' })
  })

  it('TV2: a tag of another version fails and names both', () => {
    const verdict = tagMatchesVersion('v0.2.1', '0.2.0')
    expect(verdict.ok).toBe(false)
    expect(verdict.message).toContain('v0.2.1')
    expect(verdict.message).toContain('0.2.0')
  })

  it('TV3: a tag without the v prefix fails', () => {
    expect(tagMatchesVersion('0.2.1', '0.2.1').ok).toBe(false)
  })

  it('TV4: a prerelease tag matches a prerelease version exactly', () => {
    expect(tagMatchesVersion('v0.3.0-beta.1', '0.3.0-beta.1').ok).toBe(true)
    expect(tagMatchesVersion('v0.3.0-beta.1', '0.3.0').ok).toBe(false)
  })

  it('TV5: an empty tag fails', () => {
    expect(tagMatchesVersion('', '0.2.1').ok).toBe(false)
  })
})
```

- [ ] **Step 2: Run it, expect a module-not-found failure**

Run (from `desktop/`): `npx vitest run scripts/tagVersion.test.ts`
Expected: FAIL, cannot find `./tagVersion.mjs`.

- [ ] **Step 3: Write the module**

```js
// Tag/version rule of the hosted installer build (.github/workflows/release.yml).
//
// A release tag is the ONLY trigger of a published build, so the tag and the
// package version must agree: electron-builder names the release v<version>
// from desktop/package.json, and a tag v0.2.1 pushed on a tree that still says
// 0.2.0 would build 0.2.0 again and attach it to the wrong release. The check
// is pure so it is unit tested; require-tag-matches-version.mjs is the CLI.

/**
 * Decide whether a release tag names the package version.
 *
 * @param {string} tag - The pushed tag, e.g. ``v0.2.1`` (GITHUB_REF_NAME).
 * @param {string} version - The ``version`` field of desktop/package.json.
 * @returns {{ ok: boolean, message: string }}
 */
export function tagMatchesVersion(tag, version) {
  const expected = `v${version}`
  if (tag === expected) {
    return { ok: true, message: `tag ${tag} matches package version ${version}` }
  }
  return {
    ok: false,
    message:
      `tag ${JSON.stringify(tag)} does not match package version ${version} (expected ${expected}); ` +
      'bump desktop/package.json on a branch, land it, then tag that commit',
  }
}
```

- [ ] **Step 4: Run the test, expect PASS**

Run: `npx vitest run scripts/tagVersion.test.ts`
Expected: 5 passed.

- [ ] **Step 5: Write the CLI**

```js
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
```

- [ ] **Step 6: Check the CLI by hand**

Run (from `desktop/`): `node scripts/require-tag-matches-version.mjs v0.2.0` then `node scripts/require-tag-matches-version.mjs v9.9.9; echo $?`
Expected: first prints the match and exits 0; second prints the mismatch and exits 1.

---

### Task 2: `changelogSection` + `release-notes-from-changelog.mjs`

**Files:**
- Create: `desktop/scripts/changelogSection.mjs`
- Create: `desktop/scripts/changelogSection.test.ts`
- Create: `desktop/scripts/release-notes-from-changelog.mjs`

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run it, expect a module-not-found failure**

Run: `npx vitest run scripts/changelogSection.test.ts`
Expected: FAIL, cannot find `./changelogSection.mjs`.

- [ ] **Step 3: Write the module**

```js
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
```

- [ ] **Step 4: Run the test, expect PASS**

Run: `npx vitest run scripts/changelogSection.test.ts`
Expected: 5 passed.

- [ ] **Step 5: Write the CLI**

```js
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
```

- [ ] **Step 6: Check the CLI by hand**

Run (from `desktop/`): `node scripts/release-notes-from-changelog.mjs 0.2.0 ../scratch-notes.md && cat ../scratch-notes.md && rm ../scratch-notes.md` then `node scripts/release-notes-from-changelog.mjs 9.9.9 x.md; echo $?`
Expected: the 0.2.0 section printed; the second exits 1.

---

### Task 3: the pushed rule as a pure function, CI-aware

**Files:**
- Create: `desktop/scripts/pushedCheck.mjs`
- Create: `desktop/scripts/pushedCheck.test.ts`
- Modify: `desktop/scripts/require-clean-release.mjs` (the `let upstream ... console.log(...)` block of checks 1 + 2)

- [ ] **Step 1: Write the failing test**

```ts
// Unit tests for the "is this tree pushed?" rule of the release guard. The
// rule: locally, an upstream must exist and HEAD must not be ahead of it; on
// GitHub Actions the checkout is detached, so the proof is HEAD == GITHUB_SHA
// (the commit the runner checked out is the one GitHub has). Pure: the git
// facts and the environment facts are arguments.
import { describe, expect, it } from 'vitest'

import { decidePushed } from './pushedCheck.mjs'

const SHA = 'a'.repeat(40)

describe('decidePushed', () => {
  it('PC1: locally, an upstream with zero commits ahead is pushed', () => {
    expect(decidePushed({ upstream: 'origin/develop', ahead: 0 })).toEqual({ ok: true, message: 'tree level with origin/develop' })
  })

  it('PC2: locally, commits ahead of the upstream fail with the count', () => {
    const verdict = decidePushed({ upstream: 'origin/develop', ahead: 2 })
    expect(verdict.ok).toBe(false)
    expect(verdict.message).toContain('2 commit(s)')
  })

  it('PC3: locally, no upstream fails', () => {
    expect(decidePushed({ upstream: null, ahead: null }).ok).toBe(false)
  })

  it('PC4: on GitHub Actions, HEAD equal to GITHUB_SHA is pushed even without an upstream', () => {
    const verdict = decidePushed({ upstream: null, ahead: null, githubSha: SHA, headSha: SHA })
    expect(verdict.ok).toBe(true)
    expect(verdict.message).toContain('GITHUB_SHA')
  })

  it('PC5: on GitHub Actions, HEAD different from GITHUB_SHA fails', () => {
    const verdict = decidePushed({ upstream: null, ahead: null, githubSha: SHA, headSha: 'b'.repeat(40) })
    expect(verdict.ok).toBe(false)
  })
})
```

- [ ] **Step 2: Run it, expect a module-not-found failure**

Run: `npx vitest run scripts/pushedCheck.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write the module**

```js
// The "is this tree pushed?" rule of the release guard
// (require-clean-release.mjs). A publish must carry a tree CI could verify:
// locally that means an upstream exists and HEAD is not ahead of it. On
// GitHub Actions the checkout is detached (no upstream), and the proof is
// that HEAD is the commit GitHub handed the runner (GITHUB_SHA). Pure so it
// is unit tested; the guard gathers the facts and calls it.

/**
 * Decide whether HEAD is a pushed commit.
 *
 * @param {{ upstream: string | null, ahead: number | null, githubSha?: string, headSha?: string }} facts
 *   ``upstream`` is ``@{u}`` or null when none is configured; ``ahead`` is the
 *   count of commits in ``upstream..HEAD``; ``githubSha`` is GITHUB_SHA when
 *   running under GitHub Actions; ``headSha`` is ``git rev-parse HEAD``.
 * @returns {{ ok: boolean, message: string }}
 */
export function decidePushed({ upstream, ahead, githubSha, headSha }) {
  if (githubSha !== undefined) {
    if (githubSha === headSha) {
      return { ok: true, message: `HEAD ${headSha.slice(0, 9)} is the commit GitHub Actions checked out (GITHUB_SHA)` }
    }
    return {
      ok: false,
      message: `HEAD ${String(headSha).slice(0, 9)} differs from GITHUB_SHA ${githubSha.slice(0, 9)}; the workflow must build the checked-out commit`,
    }
  }
  if (upstream === null) {
    return {
      ok: false,
      message:
        'no upstream is configured for the current branch, so "is this pushed?" cannot be answered. ' +
        'Set one (git push -u origin <branch>) so CI can verify this tree, or STRIX_ALLOW_DIRTY_DIST=1 for a local-only test build.',
    }
  }
  if (ahead > 0) {
    return {
      ok: false,
      message:
        `${ahead} commit(s) ahead of ${upstream} are unpushed and unverified by CI. ` +
        'Push before building a release, or STRIX_ALLOW_DIRTY_DIST=1 for a local-only test build.',
    }
  }
  return { ok: true, message: `tree level with ${upstream}` }
}
```

- [ ] **Step 4: Run the test, expect PASS**

- [ ] **Step 5: Wire the guard**

In `require-clean-release.mjs`, import `decidePushed` and replace the block from `let upstream` to `console.log(\`[release-guard] tree clean and level with ${upstream}\`)` with:

```js
  let upstream = null
  try {
    upstream = git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])
  } catch {
    upstream = null
  }
  const ahead = upstream === null ? null : Number(git(['rev-list', '--count', `${upstream}..HEAD`]))
  // Under GitHub Actions the checkout is detached: the proof of "pushed" is
  // HEAD == GITHUB_SHA (the commit GitHub handed the runner).
  const githubSha = process.env.GITHUB_ACTIONS === 'true' ? process.env.GITHUB_SHA : undefined
  const headSha = git(['rev-parse', 'HEAD'])
  const pushed = decidePushed({ upstream, ahead, githubSha, headSha })
  if (!pushed.ok) fail(pushed.message)
  console.log(`[release-guard] tree clean; ${pushed.message}`)
```

Update the header comment's check 2 to say both rules. Keep check 1 and check 3 unchanged.

- [ ] **Step 6: Check by hand**

Run (from `desktop/`, on the branch with its upstream set): `node scripts/require-clean-release.mjs` → prints "tree clean; tree level with origin/feat/..." when the tree is committed and pushed, else the ahead message. Then `GITHUB_ACTIONS=true GITHUB_SHA=$(git rev-parse HEAD) node scripts/require-clean-release.mjs` → prints the GITHUB_SHA message.

---

### Task 4: the workflow

**Files:**
- Create: `.github/workflows/release.yml`
- Create: `tests/unit/docs/test_release_workflow.py`

- [ ] **Step 1: Write the failing Python test**

```python
"""The hosted installer workflow (debt #288) keeps the shape the design fixed.

A tag push builds the Windows installer on a pinned Windows runner and
attaches it to a draft release with the repository token; a manual dispatch
only builds. Every action is SHA-pinned (#219), the job has a timeout, and the
local-only escape hatch STRIX_ALLOW_DIRTY_DIST is never set in CI.
"""

from __future__ import annotations

import re
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[3]
WORKFLOW = ROOT / ".github" / "workflows" / "release.yml"
SHA_PINNED = re.compile(r"^[^@\s]+@[0-9a-f]{40}\b")


def _workflow() -> dict:
    """Parse the workflow file."""
    return yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))


def test_release_workflow_triggers_on_version_tags_and_dispatch() -> None:
    """A v* tag push and a manual dispatch are the only triggers."""
    on = _workflow()[True] if True in _workflow() else _workflow()["on"]
    assert set(on) == {"push", "workflow_dispatch"}
    assert on["push"] == {"tags": ["v*"]}


def test_release_workflow_runs_on_a_pinned_windows_runner_with_a_timeout() -> None:
    """One job on windows-2022 (never windows-latest) with a timeout."""
    jobs = _workflow()["jobs"]
    assert list(jobs) == ["installer"]
    job = jobs["installer"]
    assert job["runs-on"] == "windows-2022"
    assert isinstance(job["timeout-minutes"], int)


def test_release_workflow_publishes_with_the_repository_token_only() -> None:
    """contents: write and GH_TOKEN from secrets.GITHUB_TOKEN; no personal token."""
    wf = _workflow()
    assert wf["permissions"] == {"contents": "write"}
    text = WORKFLOW.read_text(encoding="utf-8")
    assert "GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}" in text
    assert "STRIX_ALLOW_DIRTY_DIST" not in text


def test_release_workflow_pins_every_action_by_sha() -> None:
    """Every uses: carries a 40-hex ref (#219)."""
    steps = _workflow()["jobs"]["installer"]["steps"]
    uses = [step["uses"] for step in steps if "uses" in step]
    assert uses, "the workflow uses no actions at all?"
    unpinned = [u for u in uses if not SHA_PINNED.match(u)]
    assert unpinned == [], unpinned


def test_release_workflow_runs_the_guards_before_staging() -> None:
    """Tag guard and release notes run before the dependency installs."""
    steps = _workflow()["jobs"]["installer"]["steps"]
    names = [step.get("name", "") for step in steps]
    tag_guard = next(i for i, n in enumerate(names) if "tag" in n.lower() and "version" in n.lower())
    notes = next(i for i, n in enumerate(names) if "release notes" in n.lower())
    first_install = next(i for i, n in enumerate(names) if "install" in n.lower() or "set up" in n.lower())
    assert tag_guard < first_install
    assert notes < first_install
```

Note: PyYAML parses the top-level key `on` as the boolean `True`; the first test handles both.

- [ ] **Step 2: Run it, expect FAIL (file missing)**

Run (repo root): `uv run pytest tests/unit/docs/test_release_workflow.py -q`

- [ ] **Step 3: Write the workflow**

```yaml
# Hosted Windows installer build (debt #288, design 2026-10-18).
#
# A push of a v<semver> tag runs the SAME chain as `npm run release` on a
# GitHub-hosted Windows runner (stage PostgreSQL + PostGIS, stage the Python
# runtime from uv.lock, package with electron-builder) and attaches the
# installer to a DRAFT release of that tag on this repository. The owner
# publishes the draft after a download check. A manual dispatch builds the
# same way without publishing and keeps the installer as a one-day artifact,
# so the pipeline can be tested without a version bump.
#
# What runs BEFORE the tag, locally: the deep walker (0 findings, app closed)
# and the version bump + CHANGELOG section landed on develop. The CI gates
# (ruff, mypy, unit, desktop, integration) ran on every PR of the tree; this
# workflow does not repeat them.
#
# The release guard (desktop/scripts/require-clean-release.mjs) runs inside
# `npm run release`: clean tree, HEAD == GITHUB_SHA (the CI form of "pushed"),
# and a version strictly newer than the latest published release (read from
# the releases feed with GH_TOKEN, tags as fallback). STRIX_ALLOW_DIRTY_DIST is
# never set here. Every action is SHA-pinned (#219), same pins as ci.yml.

name: Release installer

on:
  push:
    tags: ["v*"]
  workflow_dispatch:

permissions:
  contents: write

# A second tag never cancels a running build.
concurrency:
  group: release-${{ github.ref }}
  cancel-in-progress: false

jobs:
  installer:
    name: Windows installer
    runs-on: windows-2022
    timeout-minutes: 90
    env:
      GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v4 (SHA-pinned, #219)
        with:
          # Full history: the release guard reads the v* tags when the
          # releases feed is unreachable, and buildProvenance reads HEAD.
          fetch-depth: 0

      - name: Tag matches the package version
        if: github.event_name == 'push'
        run: node desktop/scripts/require-tag-matches-version.mjs

      - name: Release notes from CHANGELOG.md
        if: github.event_name == 'push'
        shell: pwsh
        run: |
          $version = (Get-Content desktop/package.json | ConvertFrom-Json).version
          node desktop/scripts/release-notes-from-changelog.mjs $version "$env:RUNNER_TEMP/release-notes.md"

      - name: Set up Node 22 LTS
        uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v4 (SHA-pinned, #219)
        with:
          node-version: 22
          cache: npm
          cache-dependency-path: desktop/package-lock.json

      - name: Install uv
        uses: astral-sh/setup-uv@1c37ad07a6a961277cf70c0d37d6f313000f5884 # v3 (SHA-pinned, #219)
        with:
          version: "0.13.1"
          enable-cache: true
          cache-dependency-glob: uv.lock

      - name: Set up Python 3.11 and the dev venv
        # build-embedded-python.ps1 clones the interpreter named in
        # .venv/pyvenv.cfg, so the venv must exist before staging.
        run: |
          uv python install 3.11
          uv sync --group dev

      - name: Cache the PostgreSQL and PostGIS downloads
        uses: actions/cache@<SHA> # v4 (SHA-pinned, #219)
        with:
          path: <the download directory of build-embedded-postgres.ps1>
          key: pg-downloads-${{ hashFiles('scripts/build-embedded-postgres.ps1') }}

      - name: Install desktop dependencies
        working-directory: desktop
        run: npm ci

      - name: Build and publish the draft release
        if: github.event_name == 'push'
        working-directory: desktop
        run: npm run release

      - name: Build only (manual dispatch)
        if: github.event_name == 'workflow_dispatch'
        working-directory: desktop
        run: npm run dist

      - name: Attach the release notes to the draft
        if: github.event_name == 'push'
        shell: pwsh
        run: |
          $version = (Get-Content desktop/package.json | ConvertFrom-Json).version
          gh release edit "v$version" --repo "${{ github.repository }}" --draft --title "StrixGeo $version" --notes-file "$env:RUNNER_TEMP/release-notes.md"

      - name: Keep the installer for one day (manual dispatch)
        if: github.event_name == 'workflow_dispatch'
        uses: actions/upload-artifact@<SHA> # v4 (SHA-pinned, #219)
        with:
          name: StrixGeo-Setup-${{ github.sha }}
          path: |
            desktop/dist/StrixGeo-Setup-*.exe
            desktop/dist/latest.yml
          retention-days: 1
          if-no-files-found: error

      - name: Keep the builder debug log on failure
        if: failure()
        uses: actions/upload-artifact@<SHA> # v4 (SHA-pinned, #219)
        with:
          name: builder-debug-${{ github.sha }}
          path: desktop/dist/builder-debug.yml
          retention-days: 7
          if-no-files-found: ignore
```

Resolve the two `<SHA>` placeholders to the real 40-hex commit of the current v4 release of `actions/cache` and `actions/upload-artifact` (`gh api repos/actions/cache/git/ref/tags/v4.2.3 --jq .object.sha`, then dereference the tag object if it is annotated: `gh api repos/actions/cache/git/tags/<sha> --jq .object.sha`; write the resolved version in the comment). Resolve `<the download directory>` by reading `scripts/build-embedded-postgres.ps1` (`$DownloadDir` default); use the path relative to the repository root. Verify `gh` on the runner accepts `GH_TOKEN` for `gh release edit` (it does; no `gh auth login`).

- [ ] **Step 4: Run the Python test, expect PASS**

Run: `uv run pytest tests/unit/docs/test_release_workflow.py -q` and `uv run pytest tests/unit/docs -q` (the sibling `test_ci_workflow.py` must stay green).

- [ ] **Step 5: Lint the workflow**

Run: `uv run python -c "import yaml,sys; yaml.safe_load(open('.github/workflows/release.yml', encoding='utf-8')); print('yaml ok')"`.

---

### Task 5: docs, backlog, changelog

**Files:**
- Modify: `docs/distribution-build.md` ("Releasing: the version must be greater than the last published one" section)
- Modify: `CONTRIBUTING.md` (the release recipe paragraph)
- Modify: `docs/debt.md` (#288 to RESOLVED, with the date and the workflow path)
- Modify: `CHANGELOG.md` (Unreleased, Added)
- Modify: `CLAUDE.md` (Distribution build pointer: one sentence)

- [ ] **Step 1: Rewrite the Releasing section**

Replace the numbered "Before every release" list with the hosted path as the primary recipe:

1. Land the version bump and the `## [<version>]` CHANGELOG section on develop (branch, PR).
2. Run the deep walker locally on that commit (0 findings, app closed).
3. `git tag v<version> <commit> && git push origin v<version>`: the `Release installer` workflow builds on `windows-2022` and attaches the installer to a draft release of the tag (about 30 to 45 minutes). The guard inside it refuses a tag that does not match `package.json`, a missing changelog section, and a version not newer than the latest published release.
4. Download the draft's installer once, install over the previous version, open a project.
5. Fast-forward `main` to the built commit and push it.
6. Publish the draft (its body is the changelog section; edit by hand if wanted).

Keep the local chain (`npm run release` with `GH_TOKEN`) as the documented fallback ("when GitHub Actions is unavailable"), including the tag-after-build order that applies ONLY to the local chain. Keep the bridge paragraph as history in one sentence (0.2.0 was the last bridge; `strixgeo-releases` is archived after 0.2.1). Mention the dispatch test build (one-day artifact, no publish).

- [ ] **Step 2: CONTRIBUTING.md**

In the release recipe, point to the hosted path in two sentences and to `docs/distribution-build.md` for the detail.

- [ ] **Step 3: docs/debt.md**

Move #288 to the RESOLVED section with: resolved 2026-10-18, `.github/workflows/release.yml`, the first hosted build = 0.2.1, what stays local (walker), what stays open (signing #6). Regenerate the CLAUDE.md index: `uv run python scripts/gen_debt_index.py` (check how the script is invoked at its top; it rewrites the index block in CLAUDE.md).

- [ ] **Step 4: CHANGELOG.md**

Under `## [Unreleased]` / `### Added`: `- The Windows installer is built by GitHub Actions on a tag push (.github/workflows/release.yml) and attached to a draft release; the release notes come from this changelog.`

- [ ] **Step 5: CLAUDE.md**

In "## Distribution build (Windows installer)", add one sentence: `A push of a v<semver> tag builds the installer on GitHub Actions (release.yml) and attaches it to a draft release; the deep walker stays a local gate before the tag.` Keep the file under 40 KB (`(Get-Item CLAUDE.md).Length`).

- [ ] **Step 6: Scan**

Run: `uv run pytest tests/unit/docs -q` (the activation-reference scan and the repo-files test must stay green) and `git diff --stat`.

---

### Task 6: the gates on the final tree

- [ ] From `desktop/`: `npx vitest run scripts` (all script tests), `npx tsc --noEmit -p tsconfig.node.json`.
- [ ] From the repo root: `uv run pytest tests/unit/docs -q`, `uv run ruff check tests`, `uv run ruff format --check tests`.
- [ ] `git status -uall --short` and list every changed or new file in the report with one line each.

---

## Self-review (done at writing time)

- Spec coverage: trigger + dispatch (Task 4), runner pin (4), guards (1, 2, 3), token (4), cache (4), docs (5), debt (5), tests (1 to 4). The dispatch proof run is the session main's, after the PR is open.
- Placeholders: the two `<SHA>` and the download-directory placeholder are explicit resolve steps with the command to run.
- Types: `tagMatchesVersion(tag, version)`, `changelogSection(markdown, version)`, `decidePushed({ upstream, ahead, githubSha, headSha })` used consistently.
