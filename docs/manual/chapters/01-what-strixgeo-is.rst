What StrixGeo is, and is not
============================

StrixGeo is a **ground model platform**. Its job is to deliver a clean,
validated ground model together with the derived classification and statistics
that characterise it. Everything in the program serves that one job: get the
field data in cleanly, let you interpret it into a consistent three-level model,
describe that model, and hand it to the design tool that does the engineering
checks.

What it is
----------

* A place to **import and store** your investigations — CPT (GEF files or a DOV
  bounding-box download), boreholes, and lab data — with the raw values kept
  faithfully as the source recorded them.
* A place to **interpret** that data into a three-level ground model:

  #. a **geological model** — the formations and their surfaces (Boom Klei,
     Diest Zand, Quaternary cover, …);
  #. a **lithostratigraphic model** — each formation refined into lithology and
     admixture units (ZAND / KLEI / SILT / GRIND / VEEN, silt-bearing,
     sand-bearing, …);
  #. a **geotechnical model** — each lithology unit subdivided by packing
     density / consistency into a Belgian **NAD** packing class (1–31).

* A place to **visualise** the model — depth-series charts, a map, cross-section
  panels, a 3-D voxel view and a fence diagram.
* A place to **describe** the model — the soil-behaviour type, relative density
  of sands, the NAD class, and per-unit descriptive statistics of qc, fs and Rf.
* A place to **export** the finished model to the tools that perform the design:
  a Plaxis 2D/3D script, a D-Stability ``.stix``, a D-Sheet Piling ``.shi``, and
  DXF (section and fence).

What it is not
--------------

StrixGeo deliberately stops at the boundary where **geotechnical design**
begins. It does **not** compute — and will never compute — any of the following:

* bearing capacity, ULS / SLS verifications, settlement;
* slope stability, pile capacity, retaining-wall design;
* any value that goes directly into a design check.

Those calculations belong in the downstream tool (Plaxis, D-Stability, D-Sheet,
GeoStudio, …), which consumes StrixGeo's export as its input. StrixGeo does not
target EC7 / Eurocode design conformance, because it does not perform design.

Where the line sits: characterisation vs. design
-------------------------------------------------

The distinction that runs through the whole program is between a
**characterisation output** and a **design-ready parameter value**.

A *characterisation output* describes what the ground is: its soil-behaviour
type (Robertson Ic zone), the relative density of a sand, the NAD packing class,
a unit-weight estimate, and descriptive statistics of the measured channels.
These are produced and shown to you.

A *design-ready parameter value* is a number you would paste into a design
calculation without further judgement: an effective friction angle φ′, cohesion
c′, undrained shear strength cu, a stiffness E50, an over-consolidation ratio
OCR, a shear-wave velocity Vs. **StrixGeo leaves these blank.** They are
produced in your design tool.

The test for which side of the line a number falls on: *if the engineer pastes
it into a design check without intermediate judgement, it stays out of
StrixGeo.*

What the labels mean
--------------------

Wherever StrixGeo shows a value it derived from your measurements — a relative
density, a NAD class, a unit weight — it is a **CPT-derived estimate**, and the
program treats it as one. Two consequences follow, and they are the reason for
the wording you see on screen:

* **"CPT-derived estimate — engineer must verify."** The value is the output of
  a published correlation applied to your cone data, not a laboratory
  measurement. Correlations are empirical and soil-dependent; the estimate is a
  starting point for your judgement, not a substitute for it. You remain the
  engineer of record.
* **The classification is your judgement, assisted — never automatic.** Where
  StrixGeo suggests a layer boundary or a class, it suggests; you accept, adjust,
  or reject. The soil-behaviour zone drives *suggestions* for the segmenter, and
  nothing the machine infers is committed to the model until you accept it.

Two data-integrity rules underpin all of this and are worth stating up front,
because they explain behaviour you will meet throughout the program:

* **Raw tokens are stored; translation happens at the screen.** The database
  keeps what the source sent (the Dutch DOV soil codes, the GEF quantities); the
  Dutch/English labels you read are a lookup applied at the presentation
  boundary. Rename a token upstream and StrixGeo changes one lookup, not every
  stored row.
* **A derived value is never silently stored next to its inputs.** If a number
  can be recomputed from stored measurements, StrixGeo recomputes it on demand
  rather than freezing a copy that could drift when you edit an input; where a
  derived value is stored, it carries a provenance tag.

The rest of this manual follows the program's own workflow (chapter 2, one
section per stage), then opens up the arithmetic behind it (chapter 3, the
methods and correlations), and closes with the reference list (chapter 4).
