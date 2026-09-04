Litho — the lithostratigraphic model
====================================

The lithostratigraphic model (level 2) refines each geological formation into
**lithology and admixture units**: ZAND, KLEI, SILT, GRIND, VEEN, with admixtures
(silt-bearing, sand-bearing, …). A litho model always has a geological parent —
it cannot exist without one.

The assisted-manual flow: suggest → accept
------------------------------------------

StrixGeo does **not** auto-correlate a lithostratigraphic model into existence.
It offers *suggestions*; you accept them. The flow is:

#. **Segmentation.** For a CPT, the segmenter runs the Robertson soil-behaviour
   classifier down the column, smooths the result, and proposes a list of layers
   with a suggested lithology (and, for clean sand, a suggested packing class).
   For a borehole it maps each observed layer's DOV soil code to a base
   lithology. The exact segmentation arithmetic — the classifier, the smoothing
   window, the minimum-thickness merge — is in chapter 3.
#. **Accept.** You accept a suggested boundary through the normal contact-create
   flow. **Accept is a verbatim copy of the suggestion's shape** — StrixGeo never
   merges or splits a suggestion at accept time. What you saw is what you get.
#. **Adjust.** You drag boundaries, merge or split units by hand. The segmenter's
   ghost columns are a scaffold; the accepted layers are yours.

The segmenter offers two classifiers, chosen per project in Settings → Litho
segmenter → "Normalise qc (Robertson 2015)":

* the stress-**normalised** Robertson 2015 pipeline (needs each CPT's elevation
  and water table to build a stress profile and iterate the stress exponent);
* the **non-normalised** Robertson 2010 index (``qc`` and Rf directly, no stress
  profile), the right choice at shallow depth or when the groundwater table is
  unreliable. In non-normalised mode the relative density and NAD packing suggestion
  are left blank, because relative density needs effective stress.

Correlations and the 2/1/0 rule
-------------------------------

A single litho unit at one test tells you nothing about how it extends laterally.
That is what **correlations** are for: you draw a correlation between a unit's
contact at one test and the matching contact at a neighbour. Correlations are
**section-scoped** — you build them per section, where you can see the two
columns side by side.

How a unit's shape toward a neighbour is drawn is decided by one rule — **the
skeletal framework of the whole interpolation mechanism** — counting how many of
the unit's **two** bounding contacts (top and base) are correlated to that
neighbour:

.. list-table:: The 2 / 1 / 0 contact-correlation rule
   :header-rows: 1
   :widths: 20 20 60

   * - Correlated contacts
     - Shape
     - Meaning
   * - **2**
     - **BAND**
     - both contacts tie across, so the unit is a continuous band between the two
       tests.
   * - **1**
     - **ONLAP**
     - one contact ties, the other does not — the unit laps onto the tied
       bracket and pinches out toward the neighbour (laps up if the top is tied,
       down if the base is tied).
   * - **0**
     - **LENS**
     - neither contact ties — the unit is a lens with a horizontal apex at its
       own elevation, closing off between the tests.

The rule is applied **per gap and per side**: a unit can band toward one
neighbour and pinch toward the other. Delete a correlation and the band un-bands.
There is no automatic facies inference — where two mismatched units meet in a
data void they meet at a straight seam; a facies contact is your explicit call,
never a geometric guess.

This partition — the set of bands, onlaps and lenses across a section — is the
**single source of truth for the interpreted geometry**. The 3-D voxel build and
every export derive from the same partition, so what you see filled on a section
is the model.

Bodies — identity is geometry
-----------------------------

A **body** is a geometrically-connected mass of one lithology: the set of layers
joined, directly or transitively, by approved correlations and observed
adjacencies. StrixGeo stamps each connected component with a body id. A body's
*shape* comes entirely from the partition fill above; the body id is *identity,
not shape*.

Two behaviours are worth knowing:

* **Lens detection is an explicit verb.** No action auto-detects lenses; the
  "Detect lenses" toolbar verb (and its endpoint) are the only triggers. A
  candidate must pinch out toward at least two distinct tests to count as a lens
  — a single-sided closure is not one.
* **User state follows the body, not the row.** When bodies are recomputed and
  renumbered, a surviving body adopts the name, colour and hand-drawn boundary of
  its previous self, so your naming and styling are not lost to a renumber.
