# Changelog

All notable changes are listed here. The format follows Keep a Changelog (https://keepachangelog.com/en/1.1.0/); versions follow semver from 0.2.0 on.

Releases up to 0.1.6 were closed-beta builds; their notes are translated from the Dutch release notes.

## [Unreleased]

Free and open source under AGPL-3.0-or-later; the licence screen, activation and the compiled engine are gone.

## [0.1.6] - 2026-10-17

An installed 0.1.5 shows an update prompt at start. The project database is upgraded automatically on the first start, after a backup.

### Added

- Boreholes from a PDF report (Data > Import > Borehole > From a PDF report). The report is screened first (which pages are borehole logs, which are continuation pages, which are repeats); you pick the boreholes and confirm what the page does not print: the coordinate system and the unit of the groundwater level. Layers keep their literal description, samples keep their number and S-number, and the drilling technique stays a layer without lithology. Scanned borehole logs are recognised; reading them follows later.
- CPTs from reports that print their readings as tables (depth, elevation, qc, fs, Rf). The values are read row by row from the table, with no digitising. The graph stays as a visual check and can be read too: "Check axes" opens the graph page with the detected axes, and you choose the source per CPT, printed table (default) or read graph. A scanned copy of such a report is digitised, also when the graph has no grid.
- Override the header of a CPT page. In "Check axes" the values read from the page show in grey; type over them when the page prints an error. A coordinate outside the range of its coordinate system gets a note in the list.
- Setting "Check for updates at start" (on by default). The check runs only at start; a downloaded update installs from the button, now or at the next start, never on quit.

### Fixed

- StrixGeo now starts when another program holds port 8765: the engine takes a free port. When no port is free, the dialog names the busy port.
- The update prompt now also shows when the engine cannot start.
- A project written by a newer version of StrixGeo is refused with its own message and a button to the update.
- A model that another model refines (a lithostratigraphic model with a geotechnical model on it) can no longer be deleted by accident: the button is disabled and says why.
- A contact dragged across columns and released outside the cross-section does nothing. Redo of a copy-and-move step works; a step that would duplicate a contact gives a warning instead of an error.
- After opening another project no model of the previous project stays active, and a save or export of the previous project that was still running stops instead of continuing in the new project.
- Stratigraphy: a unit present in one CPT and absent in the next now pinches out under the base of the unit above it; the uncoloured triangle between them is gone.
- CPTs from a printed table: the graph pages are read in the background right after the screening (progress in the list), so "Check axes" opens at once; the page strip shows only graph pages, no longer the table pages.

## [0.1.5] - 2026-10-08

An installed 0.1.4 shows an update prompt at start. The project database is upgraded automatically on the first start, after a backup.

### Added

- CPTs from a PDF report (Data > Import > CPT > From a PDF report). The report is screened first (which pages are CPTs, which are repeats), then you check the axes and the header per page and import the CPTs you choose. Scanned reports without a text layer are read with OCR. A pre-drilled or drilled-through stretch stays a gap in the curve, never a straight line.
- Boreholes from DOV XML files (Data > Import > Borehole > DOV XML files, Ctrl+Shift+B). Every borehole in the file, with samples and quality flags in Dutch. A second import of the same borehole asks for confirmation first.
- Borehole description editor: add, change or delete tracks with coded lithology from the DOV code lists (soil type, colour, moisture, consistency, formal stratigraphy), at most three admixtures per interval. "Reset to DOV" restores the original description. Manual edits survive a new DOV import.
- Raw lab exports of oedometer and triaxial tests, shown per sample in the sample panel (with the strain Δh/h0), with a flask marker on the map and in the borehole log.
- Stratigraphic and lithological boundaries switch on and off separately in the Data stage.
- Help > Open log folder shows the engine's log file.

### Changed

- The import menu has one CPT button and one borehole button, each with a submenu per source (.gef, DOV, PDF, DOV XML), also in the File menu.
- A lithological band exists only through a tie you draw yourself; there is no automatic band below a shallow end depth any more.
- Body identity follows the drawing: a tie that is not drawn as a band joins nothing.
- Lithology variants never weld (sand and sand, moderately silty stay two bodies). Joining is by hand only.
- DXF: a fixed CPT band of 4 m and one number per body.
- The installer is larger (523 MB) because of the OCR package.

### Fixed

- The "stale" badge disappears after the bodies are recalculated.
- Virtual-borehole predictions stay when DOV does not answer for a moment.
- The geotechnical preparation dialog scrolls when there are many units.
- A dialog no longer closes when you drag text out of the window.

## [0.1.4] - 2026-09-28

### Added

- Cross-section DXF export carries the fill the section draws and the CPT curves, with touching regions of one unit merged.
- Ctrl+drag on a boundary absorbs every band it passes, on the lithostratigraphic and on the geotechnical axis.

### Changed

- The light and dark basemaps are Esri's gray canvases (they replace CARTO). The Geopunt basemaps stop at zoom level 21.

### Fixed

- "Build model" is offered only after the list of cross-sections has loaded.
- An update prompt that arrived while the window was still loading is shown once the window is ready.
- Lithostratigraphic fill: inside a comb of interfingering units, each tied piece ends on its own ties.

## [0.1.3] - 2026-09-25

### Added

- The installer creates a desktop shortcut by default.
- Ctrl+drag on a suggestion handle absorbs every unit it passes.

### Fixed

- GEF files with rows without a cone resistance (qc) import: such rows are dropped at parse time, and CPTs already stored with them load cleanly.
- The OpenStreetMap basemap stops at zoom 19, and the Geopunt basemaps show only inside Flanders, so the map no longer shows missing tiles.
- A suggestion's base can be dragged down to the end depth of the test.
- DOV lithology code G (disturbed ground) counts as made ground.
- Reloading after discarding a recovered project closes the project first.

## [0.1.2] - 2026-09-23

### Fixed

- Licence activation and diagnostics work behind a company proxy: their requests go through the same network stack as the browser.

## [0.1.1] - 2026-09-21

### Fixed

- A slow first start keeps waiting for an engine that is alive and explains the wait; a start that never begins ends on the error screen instead of waiting forever.
- The paper height of a section sheet follows the drawing: no white band under a lower vertical exaggeration.
- Copying a suggestion is refused only when the target holds a pending suggestion.

## [0.1.0] - 2026-09-16

First closed beta.

### Added

- Windows installer with its own PostgreSQL + PostGIS database and an auto-updater.
- Projects saved as portable `.strix` files.
- CPT import from GEF files; CPT, borehole, sample and lab import from DOV by drawing a box on the map.
- Map with basemaps and markers per source; CPT depth charts (qc, fs, Rf) and borehole logs.
- The three-level model: geological, lithostratigraphic and geotechnical (NAD packing class from CPT indicators), edited on cross-sections.
- 3-D voxel model of the lithostratigraphic model, with a fence diagram.
- Exports to DXF, Plaxis 2D and 3D, D-Stability and D-Sheet Piling.
- Dutch and English interface, with an in-app tutorial and a worked example project.
