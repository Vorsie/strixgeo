Data: importing and storing investigations
==========================================

The Data stage is where field investigations enter the project. StrixGeo reads
CPT files in the Dutch GEF format, CPTs pulled from the public DOV database over a
bounding box, and boreholes from DOV. The CPT itself follows the electrical cone
and piezocone standard (NBN EN ISO 22476-1); sampling for boreholes follows
NBN EN ISO 22475-1.

Import a GEF file
-----------------

Point StrixGeo at one or more ``.gef`` files. The parser reads the header and the
data block, detects the cone type (a piezocone CPTU with pore pressure, an
electric CPTE, or a mechanical Begemann CPTM), normalises every resistance
channel to **megapascals** whatever unit the file declared (bar, kPa, tf/m² and
kgf/cm² all convert), masks the ``-9999`` void sentinel, and builds the depth
column.

Two GEF details matter for how your data reads later.

* **Depth against length.** GEF quantity 11 is the inclination-corrected vertical
  depth; quantity 1 is the penetration length measured along the rod, which is
  always at least as large. StrixGeo prefers the corrected depth. If a file
  offers only the along-rod length, StrixGeo uses that and raises a warning, so
  you know the depths are along-rod and not corrected for the rod's deviation.
  Computing a corrected vertical depth from the along-rod length and the recorded
  inclination is future work; today the along-rod length is used as-is with the
  warning.
* **Two "qt" columns are kept apart.** GEF quantity 15 (the pore-pressure
  corrected cone resistance of a CPTU) and quantity 128 (the combined tip and
  sleeve reading of a mechanical Begemann cone) share the historic "qt" symbol
  but are physically different quantities. StrixGeo stores them in separate
  columns and never derives one from the other.

The parser validates the file and reports issues at three levels: an error (for
example a non-monotonic depth, a negative qc or fs, or a missing required
column), a warning (an uncorrected along-rod depth, an out-of-range friction
ratio), and information. A CPT with no coordinate, or with a coordinate system
StrixGeo does not recognise, is **refused**, because it cannot be placed on the
map. The refusal names the offending coordinate-system code and says why it
could not be placed. Entering the coordinates by hand at import, for a file that
arrives without them, is future work; today such a file is refused rather than
prompted for.

Coordinate systems are translated at import. The GEF coordinate-system codes are
GEF codes, not EPSG codes, so StrixGeo maps them: GEF 32000 becomes Belgian
Lambert 72 (EPSG 31370), GEF 31000 becomes Dutch RD (EPSG 28992), and the
vertical GEF 32001 becomes m TAW (EPSG 5710). A file that already declares a
supported EPSG code directly is accepted as-is. An unrecognised code is not
guessed at; the file is refused rather than stored under a wrong coordinate
system.

Import CPTs from DOV over a bounding box
----------------------------------------

Choose "Import from DOV" and draw a rectangle on the map. StrixGeo queries the
DOV index for every CPT in the box, downloads and parses each record, and stores
them in one transaction. The DOV records are converted into the same internal
shape as a GEF file, so the same validation and de-duplication apply.

Practical bounds protect the import from a runaway box: a box larger than
625 km² (25 km by 25 km) is refused, and a box that would find more than 2000
CPTs is refused before any download starts, naming the count and the limit.
Downloaded data is cached on disk, so re-importing the same area never hits the
network again, and re-importing a CPT already in the project does not duplicate
it. Drawing a free-hand outline instead of a rectangle is future work; today the
box is rectangular.

Import boreholes from DOV
-------------------------

Boreholes import the same way: choose "Import borehole from DOV" and draw a box.
A borehole arrives with **its classification tests and its laboratory tests
attached**, so importing the borehole brings in the observed soil log and the
characterisation results together.

Reading a borehole from a user-supplied XML file (rather than over DOV) is coming
soon; today the file-based paths are GEF for CPT and DOV for boreholes.

Boreholes and lab data
----------------------

A laboratory test does not exist on its own in StrixGeo: it always belongs to a
**borehole**. A borehole gives the test its place and depth, so every lab result
is anchored to an x, a y, a z and a depth. Where you have a lab result with no
real borehole behind it, you attach it to a **synthetic borehole** that carries
just those four things. This keeps every measurement locatable in the model.

Lab data in this version means **characterisation testing** (water content,
grain size, Atterberg limits, and similar). Mechanical laboratory testing
(triaxial, oedometer), pressuremeter, dilatometer and monitoring data are future
work.

What is stored raw, and what is translated at display
-----------------------------------------------------

StrixGeo keeps a clean separation between what it *stores* and what it *shows*.

* **Stored raw.** The measured series (depth, qc, fs, u2, Rf), the coordinates
  and their EPSG code, and the source's own tokens (the DOV Dutch soil codes, the
  GEF quantities). A value the source provided directly (the depth, the drill
  method, the total depth) is treated as a measurement, not a derivation, and is
  stored as it came.
* **Translated at the screen.** The human-readable labels (a soil name, a
  packing-class name, a Dutch or English interface string) come from a lookup
  applied when the value is drawn, not baked into the stored row. That is why the
  raw upstream token is always available as a tooltip: you can check a mapping
  without leaving the program.

Two rules about derived values show up in the data itself.

* The friction ratio Rf is usually **not measured**: most cones report qc and fs,
  and StrixGeo computes Rf as (fs / qc) times 100. Where a file does carry a
  measured Rf column, StrixGeo keeps that value and flags it as measured rather
  than computed, so you can tell the two apart. The CPTU corrected resistance qt,
  by contrast, follows a fixed formula and is recomputed when needed rather than
  stored.
* Denormalised summary columns (a CPT's maximum depth, its row count) exist only
  as a query convenience. They are written in the same transaction as the series
  and are always recomputable from it.

The project file
----------------

The project is a single portable file with the extension ``.strix``. It carries
the whole model, so sharing a project is emailing the file: open it on a blank
database and everything comes back. Because the database is the live store and
the file is the save artefact, an interruption never loses interpreted data. The
file is written from the database, not the other way round.
