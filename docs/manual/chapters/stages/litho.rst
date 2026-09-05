Litho: the lithological model
=============================

The lithological model is the second level. It refines each formation of the
stratigraphic model into **lithology and admixture units**: ZAND, KLEI, SILT,
GRIND, VEEN, with admixtures (silt-bearing, sand-bearing, and so on). This level
describes **soil type only**. It carries no packing density and no firmness; those
belong to the geotechnical stage. A lithological model always has a stratigraphic
parent, and cannot exist without one.

.. admonition:: Beyond Flanders

   The lithology set (sand, clay, silt, gravel, peat) covers the soils of
   Flanders. If StrixGeo expands beyond Flanders and Belgium, other rock and soil
   types would be added to the set. That is future work.

Segmentation: turning a log into suggested layers
-------------------------------------------------

You do not draw a lithological column from scratch. StrixGeo **segments** each
investigation into suggested layers, and you work from there.

* For a **CPT**, the segmenter runs the soil-behaviour-type classifier down the
  column, smooths the result, and proposes a set of layers, each with a suggested
  **lithology** (soil type). The soil identification and description follow
  NBN EN ISO 14688.
* For a **borehole**, there is no cone reading; the segmenter maps each observed
  layer's soil code to a base lithology and proposes layers the same way.

The order of work is: **adjust, then accept.** You look at the suggested layers,
correct the boundaries and the soil types where you disagree, and only then
accept them into the model. You can still adjust an accepted layer afterwards, but
doing the tidying before you accept is the smoother path. Accepting is a verbatim
copy of what the suggestion shows: StrixGeo never quietly merges or splits a
layer at accept time, so what you see is what you commit.

The segmenter offers two classifiers, chosen per project in the settings.

* The stress-**normalised** classifier, which needs each CPT's elevation and
  water table to build a stress profile.
* The **non-normalised** classifier, which reads the cone resistance and friction
  ratio directly with no stress profile. This is the right choice at shallow
  depth, or where the groundwater level is unreliable.

Both classifiers produce the same thing here: a suggested soil type per layer.
Neither suggests a packing class or a firmness.

.. admonition:: The layer-height setting

   The segmenter has a **minimum layer thickness** (default 0.15 m) that you can
   tune per project. It sets how thin a layer the segmenter is allowed to keep
   before merging it into its neighbour. It is best not to set it too small: a
   very small minimum produces many thin layers, most of which the 3-D build
   cannot resolve anyway, because the 3-D model cannot show a layer thinner than a
   voxel. Keeping the minimum layer thickness in step with the 3-D voxel height is
   sound practice. Finer voxels resolve thinner layers but cost far more to
   compute (halving the voxel size in every direction is eight times the voxels),
   so the two settings are best tuned together.

Cleaning up admixtures from boreholes
-------------------------------------

The CPT segmenter's admixture tags are read from the cone signal, and they are
noisier than the admixtures a driller wrote in a borehole log. So StrixGeo gives
you a **strip-admixtures** control on the suggestions: you can clear the
machine-suggested admixtures from the CPT ghosts, from the borehole ghosts, or
from all of them, and you can reseed the borehole admixtures back from the
observed log. The common workflow is to strip everything, then reseed the
boreholes, so the admixtures that survive are the ones a driller actually
recorded. This works on the suggestions before you accept them; it does not touch
anything already committed.

Correlations and the Auto-correlate button
-------------------------------------------

A single unit at one test says nothing about how it extends sideways. That is
what **correlations** are for: you tie a unit's contact at one test to the
matching contact at a neighbour. Correlations are drawn **per section**, where you
can see the two columns side by side.

StrixGeo can propose correlations for you. The **Auto-correlate** button runs a
correlation function across the section and produces a set of suggested ties; you
review them, drop the ones you disagree with, and keep the rest. As everywhere in
StrixGeo, the suggestion is automatic and the acceptance is yours.

The 2 / 1 / 0 rule
------------------

How a unit's shape toward a neighbour is drawn is decided by one rule, the
skeletal framework of the whole interpolation mechanism. It counts how many of
the unit's **two** bounding contacts (top and base) are correlated to that
neighbour.

.. list-table:: The 2 / 1 / 0 contact-correlation rule
   :header-rows: 1
   :widths: 20 20 60

   * - Correlated contacts
     - Shape
     - Meaning
   * - **2**
     - band
     - both contacts tie across, so the unit is a continuous band between the two
       tests.
   * - **1**
     - onlap
     - one contact ties, the other does not, so the unit laps onto the tied
       bracket and pinches out toward the neighbour (up if the top is tied, down
       if the base is tied).
   * - **0**
     - lens
     - neither contact ties, so the unit is a lens with a horizontal apex at its
       own elevation, closing off between the tests.

The rule is applied **per gap and per side**: a unit can band toward one
neighbour and pinch toward the other. Delete a correlation and the band un-bands.
There is no automatic facies inference; where two mismatched units meet in a data
void they meet at a straight seam, and a facies contact is your explicit call,
never a geometric guess.

This partition, the set of bands, onlaps and lenses across a section, is the
**single source of truth for the interpreted geometry**. The 3-D build and every
export derive from the same partition, so what you see filled on a section is the
model.

Bodies: identity is geometry
----------------------------

A **body** is a geometrically-connected mass of one lithology: the set of layers
joined, directly or through their neighbours, by approved correlations and
observed adjacencies. StrixGeo stamps each connected mass with a body identity.
The body's *shape* comes entirely from the partition fill above; the body
identity says *which mass*, not *what shape*. When bodies are recomputed and
renumbered, a surviving body keeps the name, colour and hand-drawn boundary of its
previous self, so your naming and styling are not lost to a renumber.

The 3-D model: from sections to a solid
---------------------------------------

Pressing **Build** turns the interpreted sections into a solid, three-dimensional
model. It does not invent geometry; it **labels space** from the same 2 / 1 / 0
partition you drew. StrixGeo lays a grid of small boxes (voxels) over the modelled
volume, bounded above and below by the formation surfaces and floored at the
deepest investigation, and decides which unit each voxel belongs to.

At an investigation, the voxel column is the **interpreted** stack, not the raw
record. At a CPT it is the accepted, segmented layers; at a borehole it is the
accepted layers positioned at the borehole's true location. This is why the owner
question is worth answering plainly: a voxel at a column is the interpreted
stratigraphy you accepted, not necessarily the raw observation, and where a
borehole and a CPT fall in the same place the CPT wins, because the cone resolves
the contact depths more finely.

Between the sections, StrixGeo fills each voxel like this. It finds the two
sections nearest to the voxel. If the voxel lies between them, it **blends** the
two sections' stacks by distance: a body present on both sections carries across,
its thickness weighted toward the nearer section, while a body present on only one
section **pinches out** toward the other, closing off in the space between. Beyond
the nearest pair of sections, StrixGeo carries the nearest section that still has
material horizontally outward. A voxel that no section can speak for is left as a
gap and counted, because the model is meant to be gap-free and a silent hole would
hide a mistake. This is how the 2 / 1 / 0 partition you drew in two dimensions
becomes a three-dimensional solid: the same bands, onlaps and lenses are projected
into the labelling of the space between the lines.

A finer voxel grid resolves thinner layers but multiplies the work, so the build
runs as a **background job** with a progress indicator and a Cancel button. After
labelling, a meshing step extracts a renderable surface from the grid so the solid
draws efficiently.

The fence diagram
-----------------

The **fence diagram** stands the section walls up in world space: each drawn
section becomes a vertical panel, and the panels together form a 3-D fence you can
view and export. It is built from the same section partition, one panel per body
per section, and carries the on-screen unit name and colour, so the fence you
export matches the fence you see.
