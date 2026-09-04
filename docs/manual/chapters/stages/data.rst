Data — importing and storing investigations
===========================================

The Data stage is where field investigations enter the project. StrixGeo
supports three import paths today: CPT files in the Dutch GEF format, CPTs pulled
from the public DOV database over a bounding box, and boreholes (also from DOV).

Import a GEF file
-----------------

Point StrixGeo at one or more ``.gef`` files. The parser reads the header, the
data block, and detects the cone type (CPTU with pore-pressure, CPTE electric,
CPTM mechanical, or unknown). It normalises every resistance channel to
**megapascals (MPa)** regardless of the unit the file declared (bar, kPa,
tf/m², kgf/cm² all convert), masks the ``-9999`` void sentinel, and builds the
depth column.

Two GEF details matter for how your data reads later:

* **Depth vs. length.** GEF quantity 11 is the *inclination-corrected vertical
  depth*; quantity 1 is the *penetration length measured along the rod*, which
  is always at least as large. StrixGeo prefers the corrected depth. If a file
  offers only the along-rod length, StrixGeo falls back to it **and raises a
  warning** (``UNCORRECTED_DEPTH``) so you know the depths are along-rod.
* **Two "qt" columns are kept separate.** GEF quantity 15 (``qt``, the
  pore-pressure-corrected cone resistance of a CPTU) and quantity 128
  (``totaalweerstand``, the combined tip+sleeve reading of a mechanical Begemann
  cone) share the historic "qt" symbol but are physically different quantities.
  StrixGeo stores them in separate columns and never derives one from the other.

The parser validates the file and reports issues at three levels — ERROR
(e.g. non-monotonic depth, negative qc/fs, missing required column), WARNING
(e.g. uncorrected depth, an out-of-range Rf, a qc spike, a hybrid electric →
mechanical test), and INFO. A CPT with no coordinate or no coordinate system is
refused, because it cannot be placed on the map.

Coordinate systems are translated at import: the GEF ``#XYID`` / ``#ZID`` codes
are *GEF codes, not EPSG codes*. StrixGeo maps GEF 32000 → EPSG 31370 (Belgian
Lambert 72), GEF 31000 → EPSG 28992 (Dutch RD), and the vertical GEF 32001 →
EPSG 5710 (mTAW). An unrecognised code translates to nothing rather than a guess,
and the file is refused rather than stored with a wrong coordinate system.

Import from DOV over a bounding box
-----------------------------------

Click "Import from DOV" and draw a rectangle on the map. StrixGeo queries the
DOV WFS index for every CPT in the box, downloads and parses each record's XML,
and persists them in one transaction. The DOV records are converted into the
same internal shape as a GEF file, so all the validation and de-duplication
logic is shared.

Practical bounds protect the import from a runaway box: a box larger than
**625 km²** (25 km × 25 km) is refused, and a box that would discover more than
**2000 CPTs** is refused before any download starts, naming the count and the
limit. Downloaded XML is cached on disk (``~/.groundmodel/dov_cache/``) so a
re-import of the same area never re-hits the network. Re-importing a CPT already
in the project does not duplicate it.

What is stored raw, and what is translated at display
-----------------------------------------------------

StrixGeo keeps a clean separation between what it *stores* and what it *shows*:

* **Stored raw.** The measured series (depth, qc, fs, u2, Rf), the coordinates
  and their EPSG code, and the source's own tokens — the DOV Dutch soil codes,
  the GEF quantities. A value the source provided directly (the depth, the
  drill method, the total depth) is treated as a measurement, not a derivation,
  and is stored as-is.
* **Translated at the screen.** The human-readable labels — a soil name, a
  packing-class name, a Dutch/English UI string — are produced by a lookup
  applied when the value is drawn, not baked into the stored row. This is why
  the raw upstream token is always available as a tooltip: you can verify a
  mapping without leaving the program.

Two derived-value rules apply here and are visible in the data:

* The friction ratio ``Rf`` may be stored with a provenance flag saying whether
  the source *measured* it or StrixGeo *computed* it from ``(fs/qc)·100``, because
  some cones report a slightly corrected Rf. The CPTU corrected resistance
  ``qt = qc + u2·(1 − a)``, by contrast, is a fixed formula and is recomputed on
  read rather than stored.
* Denormalised summary columns (a CPT's maximum depth, its row count) exist only
  as a query convenience; they are written in the same transaction as the series
  and are always recomputable from it.

The project itself is a portable file (``.gmproj`` / ``.strix``). It carries the
whole model, so sharing a project is emailing the file; open it on a blank
database and everything rehydrates. Because the database is the live store and
the file is the save artefact, an interruption never loses interpreted data —
the file is written from the database, not the other way round.
