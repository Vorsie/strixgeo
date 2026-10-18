# Hosted Windows installer build: design

Date: 2026-10-18. Debt #288. Owner decision of 2026-10-18 ("ok go ahead") on the
proposal: keep making installers, build on demand instead of per change, and let
GitHub Actions make them so a release costs one tag push and the build runs on a
healthy machine that contributors can read.

## Goal

A push of a `v<semver>` tag builds the Windows installer on a GitHub-hosted
Windows runner, the same way `npm run release` builds it locally, and attaches it
to a DRAFT release of that tag on `Vorsie/strixgeo`. The owner publishes the draft
after a download check. The local chain (`npm run release`) stays as the fallback.

## Decisions

| Topic | Decision |
|---|---|
| Trigger | `push` of tags `v*`, plus `workflow_dispatch` for a test build of any ref. A tag push publishes a draft; a dispatch only builds and keeps the installer as a one-day workflow artifact, so the pipeline can be tested without a version bump. |
| Runner | `windows-2022` (pinned, not `windows-latest`). Windows PowerShell 5.1, `System32\tar.exe`, `gh` and `git` are present on it. |
| Gate before the tag | The deep walker stays a LOCAL gate (0 findings, app closed) before the tag is pushed; it needs Electron with a display and the integration DB. The CI gates (ruff, mypy, unit, desktop, integration) ran on every PR of the tree. The workflow does not re-run them. |
| Release guard in CI | `require-clean-release.mjs` keeps its three checks. The "pushed" check (an upstream must exist and HEAD must not be ahead of it) cannot work on a detached checkout; under GitHub Actions it is satisfied by `HEAD == GITHUB_SHA`: the commit the runner checked out is by definition the one GitHub has. The clean-tree check and the version check (feed via `gh`, tags as fallback) run unchanged. `STRIX_ALLOW_DIRTY_DIST` is never set in CI. |
| Tag must match the version | A tag `v0.2.1` on a tree whose `desktop/package.json` says `0.2.0` fails the job before any staging. |
| Release notes | The draft's body is the `## [<version>]` section of `CHANGELOG.md`. A missing section fails the job before any staging, so the changelog is written before the tag. The owner may still edit the draft by hand (Dutch notes) before publishing. |
| Token | `GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}` with `permissions: contents: write`. No personal token in the repository. |
| Embedded stack | The two staging scripts run unchanged. `uv sync --group dev` on the runner creates the `.venv` whose `pyvenv.cfg` names the uv-managed CPython 3.11 that `build-embedded-python.ps1` clones. The PostgreSQL and PostGIS zips (pinned URL + SHA-256) are cached with `actions/cache` keyed on the staging script's hash; everything else is staged fresh each run. |
| Signing | Unsigned, as today (debt #6). |
| Bridge feed | None. 0.2.0 was the last bridge to `strixgeo-releases`; that repository is archived after 0.2.1 as decided. |
| After the build | The owner (or the session main) fast-forwards `main` to the built commit after the download check, then publishes the draft. The order "tag, build, verify, main, publish" is written in the docs. |

## Workflow shape (`.github/workflows/release.yml`)

One job, `installer`, on `windows-2022`, `timeout-minutes: 90`, concurrency group
`release-<ref>` without cancel (a second tag never cancels a running build).

Steps, in order:

1. Checkout (SHA-pinned `actions/checkout`, `fetch-depth: 0` so the version
   guard can read the `v*` tags when the feed is unreachable).
2. Tag/version guard (tag pushes only): `node desktop/scripts/require-tag-matches-version.mjs`
   reads `desktop/package.json` and `GITHUB_REF_NAME`.
3. Release notes: `node desktop/scripts/release-notes-from-changelog.mjs <version> <out>`
   writes the section to a file; fails when the section is missing.
4. Node 22 (SHA-pinned `actions/setup-node`, npm cache on `desktop/package-lock.json`).
5. uv 0.13.1 (SHA-pinned `astral-sh/setup-uv`, cache on `uv.lock`), `uv python install 3.11`,
   `uv sync --group dev`.
6. Restore the PostgreSQL download cache (`actions/cache`, SHA-pinned, key =
   hash of `scripts/build-embedded-postgres.ps1`, path = the script's download
   directory).
7. `npm ci` in `desktop`.
8. Tag push: `npm run release` (guard in CI mode, staging, package, publish as
   draft). Dispatch: `npm run dist` (guard, staging, package, no publish), then
   upload `desktop/dist/StrixGeo-Setup-*.exe` as an artifact with `retention-days: 1`.
9. Tag push: `gh release edit v<version> --draft --title "StrixGeo <version>" --notes-file <out>`.
10. Always: upload the electron-builder and staging logs on failure (the
    `desktop/dist/*.yml`, `desktop/embedded/*.txt`, and the step logs are in the
    job log already; this step only keeps `desktop/dist/builder-debug.yml`).

The actions reuse the SHA pins of `ci.yml`. The workflow is documented in
`docs/distribution-build.md` ("Releasing") and `CONTRIBUTING.md` (release recipe).

## Code changes

- `desktop/scripts/require-clean-release.mjs`: the pushed check becomes a pure
  function in `desktop/scripts/pushedCheck.mjs` (`decidePushed({ upstream, ahead, githubSha, headSha })`
  returning `{ ok, reason }`), tested; the script calls it. Under GitHub Actions
  (`GITHUB_ACTIONS === 'true'`), `githubSha` is read from `GITHUB_SHA`; locally it
  is undefined and the upstream rule applies as before.
- `desktop/scripts/require-tag-matches-version.mjs` + a pure `tagMatchesVersion(tag, version)` with tests.
- `desktop/scripts/release-notes-from-changelog.mjs` + a pure `changelogSection(markdown, version)` with tests
  (returns the body between `## [<version>]` and the next `## [` heading; `null` when absent).
- `tests/unit/docs/test_release_workflow.py`: the workflow file exists, triggers on `v*` tags and
  `workflow_dispatch`, runs on `windows-2022`, has `permissions: contents: write`, has a
  `timeout-minutes`, uses only SHA-pinned actions (every `uses:` carries a 40-hex ref), passes
  `GH_TOKEN` from `secrets.GITHUB_TOKEN`, and never sets `STRIX_ALLOW_DIRTY_DIST`.
- Docs: `docs/distribution-build.md` "Releasing" rewritten around the hosted path (local chain
  as fallback); `CONTRIBUTING.md` release recipe; `docs/debt.md` #288 RESOLVED; `CHANGELOG.md`
  Unreleased line; `CLAUDE.md` Distribution build pointer gains one sentence.

## Testing the change itself

- The three pure functions and the guard decision are unit tested (Vitest) red first.
- The workflow is pinned by the Python docs test.
- The first real proof is a `workflow_dispatch` run on the branch (a test build, no
  publish, one-day artifact) before the PR merges; its duration and the artifact
  size go into the PR description. The first tag build is 0.2.1.

## Out of scope

Signing, the walker in CI, a Linux or macOS build, moving the integration DB out
of the local walker, a GitHub organisation.
