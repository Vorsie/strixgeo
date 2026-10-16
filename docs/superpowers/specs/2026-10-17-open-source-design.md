# StrixGeo goes open source: design

Date: 2026-10-17. Every decision below was taken by the owner in the brainstorming session of 2026-10-17; nothing here is a guess.

## Goal

StrixGeo becomes a free, open-source project. Nobody pays, nothing is gated, and the code can never be turned into a closed product. Reasons: trust and adoption (engineers, firms, VITO and academics can read and verify what the model does) and contributions (parsers, exporters, regional stratigraphies).

## Decisions

| Topic | Decision |
|---|---|
| Licence | GNU AGPL-3.0-or-later. No contributor licence agreement; contributions under the DCO (`Signed-off-by`). Contributors keep their copyright, so the project can never be relicensed to closed terms. |
| Name | StrixGeo stays. GeoStrix (geostrix.com, MIT, mineral exploration, by Matt Mendes) is an unrelated project; the README says so in one sentence. The name and logo stay the owner's trademark; forks use another name. |
| History | The full private history (16,149 commits) goes public as is. A gitleaks scan over all commits found three false positives and no secret; the filename scan found five DOV GEF files committed once (open data) and the bundled worked example. |
| Paid machinery | Removed, not switched off (section 2). |
| CI | Fast gates on every PR, blocking the merge: lint and types, python unit, desktop, integration with a PostGIS service, DCO (section 4). Walker and Playwright stay local, before a release. |
| Repository | One public repo: Vorsie/Strix renamed to `strixgeo`, releases and updater feed inside it; strixgeo-releases bridges one release, then is archived. |
| Sequence | Approach 1: 0.1.6 ships from the current draft first; then `feat/open-source` lands as PRs on develop; then the flip and 0.2.0 on one day. |
| Site | strixgeo-site (Astro, Combell) updated on flip day (section 5). |
| Funding | GitHub Sponsors on the owner's account (decision 2026-10-17). `.github/FUNDING.yml`, a "Support the project" block in the README and on the site, a "Thanks" list of sponsors by name. No logo tiers at the start (keeps the income on the gift side for Belgian tax; the owner asks an accountant before the first firm wants an invoice). |

## 1. Licence and legal

- `LICENSE`: the full AGPL-3.0 text. `pyproject.toml` and `desktop/package.json` carry `license = "AGPL-3.0-or-later"`. No per-file SPDX headers.
- `NOTICE`: bundled third parties and their licences: PostgreSQL, PostGIS, Electron, CesiumJS, PyMuPDF (AGPL-3.0), d-geolib, rapidocr, the DOV codelists (Flemish open data licence), Numba, Polars, FastAPI.
- DCO: `CONTRIBUTING.md` explains `git commit -s`; a DCO check runs in CI (section 4).
- README trademark line: the StrixGeo name and logo belong to the owner; a modified distribution must use another name.
- Open legal item, the owner's, not blocking: `docs/reference/nad_reference_manifest.json` transcribes NBN EN 1997-1 ANB Tabel 2.1. Default: keep it; the doc cites the standard and no longer names the private workbook file.

## 2. Strip the paid-product machinery

Removed on `feat/open-source`:

- The packaged start-screen licence gate, the activation client, the activation store (format 1), the key entry dialog, the 30-day offline grace, device binding, the deactivate/transfer flow, the beta expiry stamp (`MAIN_VITE_STRIX_BETA_EXPIRES_AT`) and the build-stamp expiry primitive. The app starts the engine directly in every build. The tests that pinned these go with them; one new test pins "a packaged start reaches the welcome screen with no licence step".
- `server/activation` (the PHP and Python server code; history keeps it).
- `docs/design/activation-api-contract.md`, `activation-decision-memo.md`, `beta-expiry.md`, `onboarding-activation-updater-proto.md`. CLAUDE.md sections that describe activation, the protection tier and the paid model are rewritten to the new state. Debt #3 (activation) and #5 (tamper protection) close; #6 (code signing) stays as a nice-to-have for the SmartScreen warning.
- The Nuitka compile: `scripts/compile-backend-natives.ps1`, `scripts/verify-staged-natives.ps1`, the compiled manifest, the `compile` dependency group, the natives-gate step in `build-embedded-python.ps1`. The installer ships the engine as plain Python source.

Stays:

- Consent-based diagnostics (off by default). The upload endpoint becomes a setting with no default; nothing is sent until a server exists.
- The auto-updater (github provider), now pointed at the public repo.
- `/docs` and `/redoc` off in packaged builds.

## 3. Standard repository files

- `README.md` (public): what StrixGeo is and is not (no design calculations), screenshots, download link to the latest release, build-from-source block (uv, Node 22 LTS, Docker for PostgreSQL), licence and CI badges, the trademark line, the GeoStrix sentence.
- `CONTRIBUTING.md`: branch model (PRs into `develop`; `main` is released builds only), Conventional Commits, DCO sign-off, "every PR carries tests for its behaviour, written first", the gates and how to run them locally, English-only, translate at the presentation boundary, characterisation outputs only, the release recipe. The one-file-per-commit rule is the owner's own practice, not a contributor rule.
- `CODE_OF_CONDUCT.md`: Contributor Covenant 2.1, the owner's e-mail as contact.
- `SECURITY.md`: private reports through GitHub security advisories.
- `.github/ISSUE_TEMPLATE/bug_report.md`, `feature_request.md`, `.github/PULL_REQUEST_TEMPLATE.md`, `CODEOWNERS` (the owner on everything). Templates as agreed on 2026-10-17: PR = summary, what the tests prove, checklist (conventional title, tests first and seen red, docs and both i18n catalogues, no design calculation, sign-off, local gates); bug report = description, steps, environment (version, Windows, data source), log, acceptance criteria; feature request = description, acceptance criteria, notes. Labels: type, layer, stage, `good first issue`.
- `.github/FUNDING.yml` with `github: [Vorsie]` (shows the Sponsor button once the owner's Sponsors profile is approved). README gets a "Support the project" section: one paragraph, the Sponsor link, the "Thanks" list.
- `CHANGELOG.md` in Keep a Changelog format, seeded from the 0.1.0 to 0.1.6 release notes in English.
- `docs/` stays; CLAUDE.md stays tracked; `CLAUDE.local.md` stays gitignored.

## 4. CI on every PR

`.github/workflows/ci.yml` (existing, SHA-pinned actions) grows to five parallel jobs on ubuntu runners, all required status checks on `develop` and `main`:

1. `lint-types`: `ruff check src tests`, `ruff format --check src tests`, `mypy src`. Precondition: the 576 pre-existing ruff findings are fixed on the branch, so the gate is tree-wide.
2. `python-unit`: `pytest tests/unit` (as today).
3. `desktop`: eslint-reason check, `tsc` for the web, node and e2e configs, vitest, npm audit (informational).
4. `integration`: PostgreSQL 16 + PostGIS 3.6 service container, `alembic upgrade head`, `pytest tests/integration`; the real-data tests skip themselves without `data/cpt`.
5. `dco`: sign-off check on every commit of the PR.

Branch rules on `develop` and `main`: PR required (self-merge allowed), all five checks required, linear history, rebase merge only, no force-push. Concurrency cancels superseded runs. uv and npm caches keyed on the lock files; target under 20 min per PR. Walker and Playwright stay local before a release; a GitHub-hosted Windows installer build is a debt item.

## 5. Flip, release 0.2.0, site

- 0.1.6 publishes from the current draft after the owner's test.
- `feat/open-source` lands on develop as PRs, each gated by the CI it introduces.
- Flip day: rename Vorsie/Strix to `strixgeo`, set public, enable branch rules, bump 0.2.0, release chain (walker 0 findings; no natives gate), publish 0.2.0 in the repo and once in strixgeo-releases (installed 0.1.x builds read that feed), updater config points at the main repo from 0.2.0 on, archive strixgeo-releases after 0.2.1. Dutch release notes: no licence key, the app opens directly, the source is public.
- Site (`strixgeo-site`, Astro, SSH deploy to Combell), deployed on flip day: `download.astro` loses the key-by-mail form and gets the GitHub release button, the build-from-source link and the licence line; `index.astro` loses the paid-plan wording and gains "free and open source, AGPL-3.0, source on GitHub"; `beta-eula.astro` and `terms.astro` become the AGPL text plus short terms (no warranty); `privacy.astro` drops the activation-server processing and keeps the consent-based diagnostics paragraph; Nav and Footer get the GitHub link and a "Support the project" link to GitHub Sponsors.
- CLAUDE.md "Commercial Direction", the pricing block in CLAUDE.local.md and the memory files on the paid model are rewritten to "free and open source, AGPL-3.0-or-later".

## Testing the change itself

- Removal: the activation and compile code paths leave with their tests; a new boot test (main process) proves no licence step; the walker's first deep run on the stripped tree must report 0 findings before 0.2.0.
- CI: the five jobs prove themselves on the PRs of `feat/open-source` while the repo is still private; the DCO job is tested with one unsigned commit on a throwaway branch (it must fail).
- Site: the Astro build passes; a link check on the download page points at an existing release asset.

## Out of scope

Signing the installer, a hosted Windows build, a GitHub organisation, any product feature.
