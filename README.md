# StrixGeo

StrixGeo builds and manages the unified subsurface dataset of a project: CPT, boreholes, lab tests and reports in, a validated ground model with characterisation outputs out. It does no design calculation.

![CI](https://github.com/Vorsie/strixgeo/actions/workflows/ci.yml/badge.svg)
![Licence: AGPL-3.0-or-later](https://img.shields.io/badge/licence-AGPL--3.0--or--later-blue)

## Download

Get the Windows installer (Windows 10 and 11) from the latest release:
https://github.com/Vorsie/strixgeo/releases/latest

The installer is not code-signed yet, so Windows SmartScreen warns once on the first start. Click "More info", then "Run anyway". The installer carries its own PostgreSQL + PostGIS and Python; you do not install anything else.

## What it does

- Imports CPTs and boreholes from DOV (the Flemish subsurface database) by drawing a box on the map.
- Imports CPTs from GEF files and boreholes from DOV borehole XML files.
- Reads CPTs and boreholes from PDF reports, including scanned reports through OCR.
- Imports raw lab exports (oedometer and triaxial tests) and shows them per sample.
- Builds a three-level model: geological, then lithostratigraphic, then geotechnical (NAD packing class from CPT indicators).
- Uses cross-sections as the editing surface for all three levels.
- Builds a 3-D voxel model of the lithostratigraphic model.
- Exports to DXF (sections and fence diagrams), Plaxis 2D and 3D, D-Stability and D-Sheet Piling.
- Has a Dutch and an English interface.

## What it does not do

StrixGeo delivers the ground model, the derived characterisation values and the statistics. The design check happens in a downstream tool that takes this output as input. StrixGeo never calculates bearing capacity, settlement, slope stability, pile capacity or retaining-wall design, and it does not apply Eurocode 7 design rules. Values that go straight into a design check (for example friction angle, cohesion, undrained shear strength, stiffness moduli) are not produced today; the characterisation outputs (soil behaviour zone, relative density, NAD packing class, unit weight estimate) are.

## Build from source

Prerequisites: Python 3.11 via [uv](https://docs.astral.sh/uv/), Node 22 LTS (Node 24 crashes the test runner today), Docker Desktop for PostgreSQL + PostGIS. Windows is the only tested desktop platform today.

```text
uv sync --group dev --group docs
docker compose up -d
uv run alembic upgrade head
cd desktop
npm ci
npm run dev
```

`npm run dev` starts the engine itself. To run the API alone: `uv run python -m groundmodel.api.serve` (port 8765).

Run the unit tests with `uv run pytest tests/unit` and the desktop tests with `npm test` from `desktop/`. The integration tests need the Docker database and run only through `.\scripts\run-integration-tests.ps1`, which points them at a separate test database; a bare `pytest tests/integration` is refused unless `DATABASE_URL` names a `_integration` or `_test` database (the conftest guard).

## Architecture in one paragraph

The Python engine has four layers with dependencies in one direction: API (FastAPI) > Application (use cases) > Domain < Infrastructure (database, parsers, exporters). The domain layer holds the geotechnical logic and knows no framework, no database and no data-frame library. The desktop app (Electron + React) talks to the engine only through its HTTP API on localhost. [docs/architecture.md](docs/architecture.md) shows the package tree; [CLAUDE.md](CLAUDE.md) is the contributor's map of the conventions, the subsystems and the design notes under [docs/design/](docs/design/).

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md). In short: write the failing test first, and sign off every commit (DCO, `git commit -s`).

## Support the project

StrixGeo is free for everyone. Sponsoring funds the maintainer's time on parsers, exporters, fixes and support: https://github.com/sponsors/Vorsie

### Thanks

Sponsors are listed here by name.

## Licence

StrixGeo is licensed under the GNU Affero General Public License, version 3 or any later version (AGPL-3.0-or-later). See [LICENSE](LICENSE) for the text and [NOTICE](NOTICE) for the bundled third-party components and their licences.

The StrixGeo name and logo are a trademark of the copyright holder and are not covered by the licence. A modified distribution must use another name.

## Not related to GeoStrix

GeoStrix is an unrelated open-source project for mineral exploration.
