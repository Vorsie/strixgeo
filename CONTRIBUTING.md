# Contributing to StrixGeo

Thank you for helping. This page tells you how a change gets from your machine into a release. The full map of the code and its conventions is [CLAUDE.md](CLAUDE.md); read it before your first non-trivial change.

## Branches

- Open every pull request against `develop`. `develop` is the integration branch and is always green.
- `main` holds released builds only: every commit on it shipped in an installer, and each release is tagged.
- Name your branch `feat/<slug>` or `fix/<slug>`.
- Pull requests land by rebase merge. History stays linear: no merge commits, no squash. Rebase your branch on `develop` when it moves.

## Commits

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/):

```text
<type>(<scope>): <description>
```

| Type | Use |
|---|---|
| `feat` | new feature |
| `fix` | bug fix |
| `docs` | documentation |
| `refactor` | restructure, no behaviour change |
| `test` | tests |
| `chore` | config, dependencies, build |
| `perf` | performance |

Present tense, lowercase, no trailing period, at most 72 characters on the first line.

Sign off every commit with `git commit -s`. This adds a `Signed-off-by: Your Name <you@example.com>` line, which certifies the [Developer Certificate of Origin](https://developercertificate.org/): you wrote the change, or you have the right to submit it under the project's licence (AGPL-3.0-or-later). There is no contributor licence agreement; you keep the copyright of your contribution. A commit without the sign-off fails the DCO check.

## Tests first

When you change behaviour, the first thing you write is a failing test that states the rule in the rule's own words ("a drilled interval stays a gap", not "`gap_m > 0`"). Run it and see it fail. Then write the smallest change that makes it pass, then clean up. A test that passes on the first run against the old code either tests nothing or describes behaviour that already exists; find out which before you continue.

Every pull request says, in its "What the tests prove" section, which behaviour each test pins.

Unit tests (`tests/unit/`) use no database, no network and no file outside the fixtures. A domain test that needs a database means the architecture is leaking.

## Gates

Five CI jobs run on every pull request, and all five must pass before a merge:

| Job | What it runs |
|---|---|
| Ruff + mypy | lint, format check and type check of the Python code |
| Python unit tests | `pytest tests/unit` |
| Desktop eslint-reason + tsc + tests | the `eslint-disable` reason check, the TypeScript type check and the Vitest suite |
| Integration tests (PostGIS service) | `alembic upgrade head` and `pytest tests/integration` against PostgreSQL + PostGIS |
| DCO sign-off | every commit of the pull request carries `Signed-off-by` |

Run the same checks locally before you push:

```text
uv run ruff check src tests
uv run ruff format --check src tests
uv run mypy src
uv run pytest tests/unit
.\scripts\run-integration-tests.ps1
cd desktop
npm test
npx tsc --noEmit -p tsconfig.web.json
npx tsc --noEmit -p tsconfig.node.json
npx tsc --noEmit -p tsconfig.e2e.json
```

CI runs on an ubuntu runner, so on Windows also run `uv run mypy --platform linux src` before pushing: the first mypy-blocking run caught Windows-only ctypes code.

Run the `npx tsc` lines and `npm test` from `desktop/`. Run Vitest only from `desktop/`; from the repository root it also collects the Playwright specs.

Run the integration tests only through `.\scripts\run-integration-tests.ps1`. It points `DATABASE_URL` at a separate test database and migrates it first. A bare `pytest tests/integration` is refused unless `DATABASE_URL` names a `_integration` or `_test` database (the conftest guard). One integration run at a time: the script takes a lock and stops if another run holds it.

The `groundmodel_integration` database needs a one-time bootstrap; [docs/testing-integration.md](docs/testing-integration.md) has the steps. Address the database container through Compose, for example `docker compose exec db psql -U groundmodel -d groundmodel -c "CREATE DATABASE groundmodel_integration;"` and `docker compose exec db psql -U groundmodel -d groundmodel_integration -c "CREATE EXTENSION IF NOT EXISTS postgis;"`.

The wrapper is a PowerShell script (Windows; `pwsh` elsewhere). On Linux or macOS you can also do what CI does: set `DATABASE_URL` to the `_integration` database (`postgresql+asyncpg://groundmodel:groundmodel@127.0.0.1:5433/groundmodel_integration`), then run `uv run alembic upgrade head` and `uv run pytest tests/integration`.

Use Node 22 LTS. Node 24 crashes the Vitest runner today.

## Rules of the domain

- **English only** in identifiers, comments and docstrings, in Python and TypeScript. A Dutch field name from a data specification may appear in a comment next to its English translation.
- **Translate at the presentation boundary, never at ingest.** The database stores the raw tokens the source sent (a DOV code, a GEF quantity number). Translation tables live in the desktop app, and every visible text exists in both catalogues, Dutch and English.
- **Characterisation outputs only.** StrixGeo produces the ground model and characterisation values (soil behaviour zone, relative density, NAD packing class, unit weight estimate). It produces no value that goes straight into a design check, and no design calculation: bearing capacity, settlement, slope stability, piles and retaining walls stay out of scope. See the "Scope" section of [CLAUDE.md](CLAUDE.md).
- **Backwards compatibility.** A `.strix` project file written by any released build must open in every later build. Schema, API and project-bundle changes are additive only: new fields are optional, and a format version bump comes with an upgrade step. See [docs/backwards-compat.md](docs/backwards-compat.md).
- **Logging.** Every public method logs what it received and how it ended, following the Definition of Done in [CLAUDE.md](CLAUDE.md): phase summaries at INFO, per-item decisions at DEBUG, and what was NOT found next to what was. Service classes inherit `GroundModelLogger`.
- **Docstrings.** Every public module, class, method and function has a numpy-style docstring with parameters, return value and raised exceptions.
- **Structure.** One class per Python file; module constants in a `*_constants.py` file next to the class that uses them; dependencies flow API > Application > Domain < Infrastructure.

## Releasing

Releases are made by the maintainer only. The recipe: the Electron walker (`.\scripts\run-e2e.ps1 walker`) reports 0 findings, `npm run release` in `desktop/` builds the installer and a draft release, the version is tagged after the build, and `main` is fast-forwarded to the released commit. See [docs/distribution-build.md](docs/distribution-build.md).

## Where to read

- [CLAUDE.md](CLAUDE.md): architecture, conventions, the Definition of Done and pointers to every subsystem note.
- [docs/](docs/): reference pages per subsystem (parsers, exports, API, desktop, UX, data integrity, testing).
- [docs/design/](docs/design/): the current design of the interpretation subsystems (section fill, bodies, geotechnical stage).
