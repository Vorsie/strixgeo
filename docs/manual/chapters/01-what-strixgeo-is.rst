What StrixGeo is, and is not
============================

StrixGeo is a **ground model platform**. Its job is to deliver a clean,
validated ground model together with the derived classification, the
characteristic soil parameters, and the statistics that describe it. Everything
in the program serves that one job: get the field data in cleanly, let you
interpret it into a consistent three-level model, describe it, and hand it to the
design tool that runs the engineering checks.

What it is
----------

* A place to **import and store** your investigations: CPT (GEF files or a DOV
  bounding-box download), boreholes, and lab data, with the raw values kept
  faithfully as the source recorded them. Lab data today means the
  **characterisation tests** that arrive with a borehole (water content, grain
  size, Atterberg limits, and the like). Mechanical laboratory tests (triaxial,
  oedometer), pressuremeter, dilatometer and monitoring data are future work,
  added when there is demand for them.
* A place to **interpret** that data into a three-level ground model:

  #. a **stratigraphic model**, the formations and the surfaces that separate
     them (Boom Formation, Diest Formation, the Quaternary cover, and so on),
     named after the Belgian stratigraphic nomenclature;
  #. a **lithological model**, each formation refined into lithology and
     admixture units (ZAND, KLEI, SILT, GRIND, VEEN, silt-bearing, sand-bearing,
     and so on). This level describes soil type only, no packing and no firmness;
  #. a **geotechnical model**, each lithology unit subdivided by packing density
     or consistency into a Belgian **NAD** class (1 to 31).

* A place to **visualise** the model: depth-series charts, a map, cross-section
  panels, a 3-D voxel view and a fence diagram.
* A place to **describe** the model: the soil-behaviour type, the relative
  density of sands, the NAD class, a unit-weight estimate, per-unit descriptive
  statistics of qc, fs and Rf, and the **characteristic soil parameters**
  (dry and wet unit weight, effective friction angle, effective cohesion, and
  undrained shear strength for fine soils) read from the NAD table, one general
  value per body.
* A place to **export** the finished model to the tools that run the design: a
  Plaxis 2D or 3D script, a D-Stability ``.stix``, a D-Sheet Piling ``.shi``, and
  DXF (section and fence).

What it is not
--------------

StrixGeo stops at the boundary where **geotechnical design** begins. It does not
run any of the following calculations:

* bearing capacity, ULS or SLS verifications, settlement;
* slope stability, pile capacity, retaining-wall design;
* any value produced by a design check itself.

Those calculations belong in the downstream tool (Plaxis, D-Stability, D-Sheet,
GeoStudio), which consumes StrixGeo's export as its input.

.. admonition:: A note on the exports

   The Plaxis and D-Series exports are complete and runnable, but they have not
   yet been validated inside the target software against a hand-checked
   benchmark. Treat an exported model as a strong starting point to inspect in
   Plaxis, D-Stability or D-Sheet Piling, not as a finished, verified input.

Where the line sits: characterisation and characteristic parameters
-------------------------------------------------------------------

StrixGeo does derive parameters. From the ground model it produces a
**characterisation** (the model geometry, the soil-behaviour classification, the
packing class, a unit-weight estimate, and descriptive statistics of the measured
channels) and it reads the **characteristic soil parameters** (dry and wet unit
weight, effective friction angle, effective cohesion, undrained shear strength)
from the Belgian NAD table, one general value per body.

What StrixGeo hands you is therefore a **characteristic value**. Turning a
characteristic value into a **design value** means applying the partial safety
factors, and that, together with the design checks that consume it, happens in
your downstream tool. You remain the engineer who chooses and signs off the
characteristic value.

Two lines of work are planned but not in this version. First, **statistical
tools**: a probability density function per parameter, so a characteristic value
can be chosen on a probabilistic basis. Second, as StrixGeo learns to read more
test types, it will let you **compare parameters side by side**: the value a
triaxial test, an oedometer, a pressuremeter, a dilatometer and a CPT correlation
each suggest, so you can pick a good value for design from all of them at once.
Both are future work.

.. admonition:: Eurocode 7, second generation

   The second generation of Eurocode 7 asks for a **ground model** to be built
   for each project and kept current: maintained and updated through the whole
   lifecycle of the project as more is learned about the ground. A ground model
   platform is built for exactly that, one living model per project rather than a
   pile of separate reports.

What the labels mean
--------------------

Wherever StrixGeo shows a value it derived from your measurements (a relative
density, a NAD class, a unit weight, a characteristic parameter), it treats it as
an estimate, and it says so on screen. Two consequences follow, and they explain
the wording you meet throughout the program.

* **"CPT-derived estimate, engineer must verify."** The value is the output of a
  published correlation or a table applied to your cone data, not a laboratory
  measurement. Correlations are empirical and soil-dependent, so the estimate is
  a starting point for your judgement, not a substitute for it.
* **The classification is your judgement, assisted, never fully automatic.**
  Where StrixGeo suggests a layer boundary or a class, it suggests, and you
  accept, adjust or reject. Nothing the machine infers is committed to the model
  until you accept it.

Two data-integrity rules underpin all of this and are worth stating up front,
because they explain behaviour you meet throughout the program.

* **Raw tokens are stored; translation happens at the screen.** The database
  keeps what the source sent (the Dutch DOV soil codes, the GEF quantities); the
  Dutch and English labels you read are a lookup applied when the value is drawn.
  Rename a token upstream and StrixGeo changes one lookup, not every stored row.
* **A derived value is never silently stored next to its inputs.** If a number
  can be recomputed from stored measurements, StrixGeo recomputes it on demand
  rather than freezing a copy that could drift when you edit an input. Where a
  derived value is stored, it carries a note of where it came from.

The rest of this manual follows the program's own workflow (the stages chapter,
one section per stage), then opens up the arithmetic behind it (the methods and
correlations chapter), and closes with the reference list.
