Methods and correlations
========================

This chapter documents **how StrixGeo computes every derived value**. For each
method you will find the equation, its symbols and units, the published
reference, and the plain condition under which the method applies. A short worked
example is given for each, as an illustration of the numbers involved.

Everything in this chapter is **characterisation**: the soil-behaviour
classification, the relative density and the packing class. The characteristic
soil parameters (dry and wet unit weight, effective friction angle, effective
cohesion, undrained shear strength) are not computed by a correlation here; they
are read straight from the Belgian NAD table for a unit's class, and are covered
in the NAD section. The design checks that consume any of this run in your
downstream tool.

.. admonition:: Correlations can carry errors

   Every correlation below is empirical and soil-dependent. StrixGeo has taken
   care with each, but a correlation can still be a poor fit for a particular
   soil, and mistakes in an implementation are always possible. If a value looks
   wrong for the ground you know, treat your judgement as the authority, and let
   us know so we can check it.

.. admonition:: A note on qc against qt

   The published Robertson expressions are written with the pore-pressure
   corrected cone resistance qt. StrixGeo uses the recorded cone resistance qc
   directly in the unit-weight, normalised-parameter and index expressions, and
   does not substitute qt even when a piezocone records the pore pressure. For
   sands, and for cones without reliable pore pressure, the two are practically
   equal; in soft fine soils with high excess pore pressure they differ. Using
   raw qc is a deliberate decision for this version, and it matches how the NAD
   classes are assigned for shallow soils. Using qt where the pore pressure is
   measured is future work.

.. contents:: On this page
   :local:
   :depth: 1


Unit weight from CPT
--------------------

StrixGeo estimates the bulk unit weight of the soil at each cone reading, which
it then integrates into the stress profile.

.. math::

   \gamma = 9.81 \left( 0.27 \, \log_{10} R_f + 0.36 \, \log_{10}\!\frac{q_c}{0.1} + 1.236 \right)

where

.. math::

   R_f = \frac{f_s}{q_c} \times 100 .

Symbols and units:

* :math:`\gamma`, bulk unit weight (kN/m³);
* :math:`q_c`, cone resistance (MPa);
* :math:`f_s`, sleeve friction (MPa);
* :math:`R_f`, friction ratio (%).

The constant 0.1 is atmospheric pressure in MPa, so :math:`q_c/0.1` is
dimensionless, and 9.81 is the unit weight of water in kN/m³.

**Reference.** Robertson & Cabal (2015). The value applies where qc, fs and Rf
are all positive; where a reading is not, its unit weight is left out and filled
from the next valid reading below, so a short gap never breaks the integration.

*Example.* For qc = 12 MPa and fs = 0.08 MPa (so Rf = 0.667 %), the unit weight is
about 19.0 kN/m³.


The stress profile
------------------

From the per-reading unit weights StrixGeo integrates the vertical stress down
the column. The step is the actual depth increment between successive readings,
using the trapezoidal average of the two bounding unit weights.

.. math::

   \sigma_{v,k} = \sigma_{v,k-1} + \tfrac{1}{2}\left( \gamma_{k-1} + \gamma_k \right)\,\Delta z_k

The pore water pressure below the water table is

.. math::

   u_k = \gamma_w \, (z_{w} - z_k)

and the effective vertical stress is the total stress less the pore pressure,
floored just above zero:

.. math::

   \sigma'_{v,k} = \max\!\left( \sigma_{v,k} - u_k,\; 0.001 \right).

Symbols and units:

* :math:`\sigma_v`, total vertical stress (kPa);
* :math:`\sigma'_v`, effective vertical stress (kPa);
* :math:`u`, pore water pressure (kPa);
* :math:`\gamma_k`, bulk unit weight at reading k (kN/m³);
* :math:`\gamma_w`, unit weight of water (default 9.81 kN/m³);
* :math:`\Delta z_k`, depth increment (m);
* :math:`z_w`, water-table elevation, and :math:`z_k`, reading elevation (m TAW).

The principle behind this is Terzaghi's effective-stress principle: the effective
stress that governs soil behaviour is the total stress carried by the soil
skeleton, less the pore water pressure. The profile handles the water table at or
above the surface (saturated from the top), between the surface and the first
reading (an unsaturated unit weight, default 16 kN/m³, above the water table), or
below the first reading. The effective stress is floored just above zero because
the normalisation that consumes it divides by it, and near-surface points above
the water table can otherwise reach zero. Where a CPT records no water table,
StrixGeo assumes water at the ground surface, which is the conservative choice and
is applied to every consumer of the profile identically.

**Reference.** Terzaghi, Peck & Mesri (1996); Verruijt (2001).

*Example.* At 8 m depth in a sand column (ground at 10 m TAW, water table 2 m
deep) the total vertical stress is about 147 kPa, the pore pressure about 59 kPa,
so the effective vertical stress is about 88 kPa.


Normalised cone parameters and the stress exponent
--------------------------------------------------

This is the normalised soil-behaviour-type index. It iterates, because the stress
exponent depends on the very index it helps compute.

.. math::

   Q_{tn} = \frac{q_c \cdot 1000 - \sigma_v}{100}\left(\frac{100}{\sigma'_v}\right)^{\! n}

.. math::

   F_r = \frac{f_s \cdot 100000}{q_c \cdot 1000 - \sigma_v}

.. math::

   I_c = \sqrt{\left(3.47 - \log_{10} Q_{tn}\right)^2 + \left(\log_{10} F_r + 1.22\right)^2}

.. math::

   n = \operatorname{clamp}\!\left(0.381\,I_c + 0.05\,\frac{\sigma'_v}{100} - 0.15,\; 0,\; 1\right)

Symbols and units:

* :math:`Q_{tn}`, normalised cone resistance (dimensionless);
* :math:`F_r`, normalised friction ratio (%);
* :math:`I_c`, soil-behaviour-type index (dimensionless);
* :math:`n`, stress exponent (between 0 and 1);
* :math:`q_c`, :math:`f_s` (MPa); :math:`\sigma_v`, :math:`\sigma'_v` (kPa).

The factors 1000 convert MPa to kPa; the 100 values are atmospheric pressure in
kPa; the net cone resistance is :math:`q_c\cdot1000 - \sigma_v` in kPa. StrixGeo
starts from n = 1, computes the index, updates n, and repeats until n changes by
less than 0.002 between passes (a handful of passes for any real CPT).

**Reference.** Robertson (2009). A reading is skipped very near the surface, where
the overburden exceeds the cone resistance (which would make the logarithm
undefined), or where the friction ratio is not positive.

*Example.* At the 8 m sand reading above, :math:`Q_{tn} \approx 127`,
:math:`F_r \approx 0.67\,\%`, :math:`I_c \approx 1.72`, with n converging near
0.55.


Soil-behaviour-type zones and the peat boundary
-----------------------------------------------

The converged normalised pair is placed on the Robertson soil-behaviour-type
chart, which is divided into nine zones by boundary lines. StrixGeo stores each
boundary and reads off the zone by interpolation:

.. math::

   Z_i(F_r) = 10^{\,\operatorname{interp}\left(\log_{10} F_r,\; X_i,\; Y_i\right)}

A reading whose normalised resistance exceeds a boundary sits in the
higher-numbered zone. The nine zones run from 1 (sensitive fine-grained) through
6 (clean sand to silty sand) to 9 (very stiff fine-grained), with 2 for organic
soil and peat. The organic and peat boundary is an extension of the chart:

.. math::

   Z_8 = \begin{cases} 0 & F_r \le 5.2 \\ 8\,(F_r - 5.2)^{0.5} & F_r > 5.2 \end{cases}

Symbols and units:

* :math:`Z_i`, the boundary value of the normalised resistance for zone i
  (dimensionless);
* :math:`F_r`, normalised friction ratio (%);
* :math:`X_i, Y_i`, the stored knots of boundary i.

The zone drives a **lithology suggestion** through a fixed lookup: zones 1, 3 and
9 give clay, zone 2 gives peat, zones 4 and 5 give silt, zones 6, 7 and 8 give
sand. Gravel is deliberately not read from the CPT, because the standard chart
cannot separate gravel from dense sand reliably; gravel is confirmed from a
borehole.

**Reference.** Robertson (2009) and Robertson & Cabal (2015) for the chart and its
zones; the peat boundary is Lengkeek & Brinkgreve (2022).

*Example.* The 8 m sand reading lands in zone 6 (clean sand to silty sand), which
maps to sand.


The non-normalised index
------------------------

When the effective-stress profile is unreliable (shallow depth, made ground, an
unknown water table), the normalised index is unreliable too, because it depends
on that profile. StrixGeo then offers the **non-normalised** index, which reads
the cone resistance and friction ratio directly with no stress profile and no
iteration:

.. math::

   I_{SBT} = \sqrt{\left(3.47 - \log_{10}\frac{q_c}{p_a}\right)^2 + \left(\log_{10} R_f + 1.22\right)^2}

Symbols and units:

* :math:`I_{SBT}`, non-normalised index (dimensionless);
* :math:`q_c`, cone resistance (MPa);
* :math:`p_a`, atmospheric reference pressure (0.1 MPa);
* :math:`R_f`, friction ratio (%).

The index is banded into the same zones the normalised index uses:
below 1.31 is zone 7, 1.31 to 2.05 is zone 6, 2.05 to 2.60 is zone 5, 2.60 to
2.95 is zone 4, 2.95 to 3.60 is zone 3, and 3.60 and above is zone 2.

**Reference.** Robertson & Cabal (2015). The value applies where qc, fs and Rf are
all positive.

*Example.* For qc = 12 MPa and fs = 0.08 MPa, :math:`I_{SBT} \approx 1.74`, which
is zone 6 (clean sand to silty sand), the same zone the normalised path gives.


Relative density of clean sand
------------------------------

For clean sands StrixGeo estimates the relative density from the cone resistance
and the effective stress.

.. math::

   D_r = 100 \left( 0.268 \, \ln\!\frac{q_c/0.1}{\left(\sigma'_v/100\right)^{0.5}} - C \right)

Symbols and units:

* :math:`D_r`, relative density (%);
* :math:`q_c`, cone resistance (MPa);
* :math:`\sigma'_v`, effective vertical stress (kPa);
* :math:`C`, the compressibility factor (default 0.675 for quartz sand; 0.525 for
  high-compressibility calcareous sand; 0.825 for low-compressibility quartz
  sand).

The 0.1 is atmospheric pressure in MPa and the 100 under the root is atmospheric
pressure in kPa, so both ratios are dimensionless.

**Reference.** Jamiolkowski, lo Presti & Manassero (2003), as tabulated in
Robertson & Cabal (2015). This applies only to clean sand, defined as :math:`I_c`
below 2.45 and :math:`R_f` below 1.2; other soils get no relative density. The
relative density is banded into a descriptor for sand, loose below 35 %, medium
dense from 35 to 65 %, dense from 65 to 85 %, and very dense above 85 %.

*Example.* For qc = 12 MPa and an effective stress of about 88 kPa, with the
default compressibility factor, :math:`D_r \approx 63\,\%`.


NAD packing classes
-------------------

The geotechnical stage assigns each unit a **Belgian NAD class** by looking up a
representative cone resistance against the class's qc band for the unit's soil and
admixture variant. The lookup is on raw qc, in megapascals, with no
normalisation, which is the NAD table's own method.

The readings inside a body are reduced to one **representative qc** by a
selectable statistic: the median (the default, robust to spikes), or the
arithmetic, harmonic or geometric mean. For the same positive readings these order
as harmonic, then geometric, then arithmetic, so the choice shifts the class
systematically; the harmonic mean is the conservative choice. That representative
qc is walked against the bands for the unit's soil column, and the first band it
falls in gives the class.

.. list-table:: NAD qc bands (classes 1 to 31), qc in MPa
   :header-rows: 1
   :widths: 24 20 16 40

   * - Soil and variant
     - Band (qc)
     - Class
     - Packing
   * - gravel, clean
     - < 20 / ≥ 20
     - 1 / 2
     - matig / dicht
   * - gravel, with admixture
     - < 20 / ≥ 20
     - 3 / 4
     - matig / dicht
   * - sand, clean
     - < 4 / 4 to 10 / 10 to 15 / ≥ 15
     - 5 / 6 / 7 / 8
     - los / matig / dicht / zeer dicht
   * - sand, with admixture
     - < 4 / 4 to 10 / 10 to 15 / ≥ 15
     - 9 / 10 / 11 / 12
     - los / matig / dicht / zeer dicht
   * - silt, clean
     - < 1 / 1 to 2 / 2 to 4 / ≥ 4
     - 13 / 14 / 15 / 16
     - weinig-vast / matig-vast / vrij-vast / vast
   * - silt, with admixture
     - < 1 / 1 to 2 / 2 to 4 / ≥ 4
     - 17 / 18 / 19 / 20
     - weinig-vast / matig-vast / vrij-vast / vast
   * - clay, clean
     - < 1 / 1 to 2 / 2 to 4 / ≥ 4
     - 21 / 22 / 23 / 24
     - weinig-vast / matig-vast / vrij-vast / vast
   * - clay, with admixture
     - < 1 / 1 to 2 / 2 to 4 / ≥ 4
     - 25 / 26 / 27 / 28
     - weinig-vast / matig-vast / vrij-vast / vast
   * - peat
     - < 0.5 / 0.5 to 1 / ≥ 1
     - 29 / 30 / 31
     - weinig-vast / matig-vast / vast

The band bottoms are open: because the soil type is already fixed by the litho
model, a reading below the printed floor still belongs to that soil and takes its
loosest class. The clean column is for a pure soil; the with-admixture column is
for a soil carrying its one NAD admixture variant (a clay or silt admixture in a
sand or gravel, a sand admixture in a fine soil). A gravel admixture in a sand is
not a NAD variant, so a gravelly sand classifies as clean sand.

Besides the packing class, the NAD table also carries the **characteristic soil
parameters** for each class: the dry and wet unit weight, the effective friction
angle, the effective cohesion, and, for the fine soils, the undrained shear
strength. StrixGeo reads these straight from the table, one general value per
body, and shows them in the Parameters stage.

**Reference.** The NAD packing-class table of NBN EN 1997-1 ANB (the Belgian
national annex to Eurocode 7), Tabel 2.1. A missing, non-numeric or negative qc is
rejected rather than mapped to a class; a genuine measured 0.0 is valid and takes
the loosest class. A unit with no cone reading gets no machine class from qc
alone; a borehole is instead classified from the surrounding CPTs, as the Geotech
chapter describes.

*Example.* Clean sand at a representative qc of 12 MPa is class 7 (dicht); at 8
MPa it is class 6 (matig). Clean clay at 1.5 MPa is class 22 (matig-vast).


Litho segmentation
------------------

The litho segmenter is **StrixGeo's own algorithm**, built on the
soil-behaviour-type zones above. It turns a per-reading zone sequence into a small
set of suggested layers in five steps:

#. classify each reading into a zone (the normalised path, or the non-normalised
   path where the stress profile is unreliable);
#. smooth the zone sequence with a rolling median whose half-window is sized to
   the minimum layer thickness;
#. group the smoothed sequence into runs of one zone;
#. merge any run thinner than the minimum layer thickness into its neighbour,
   rescanning until every run meets the threshold;
#. emit one layer per surviving run, mapping its dominant zone to a lithology.

The half-window of the smoothing median is

.. math::

   \text{half-window} = \max\!\left(1,\; \operatorname{round}\!\left(\frac{t_{\min}/2}{\Delta z}\right)\right)

readings above and below each point, for a total window of twice that plus one.

Symbols and units:

* :math:`t_{\min}`, minimum layer thickness (m, default 0.15, tunable per
  project);
* :math:`\Delta z`, the mean depth increment of the series (m).

The median is robust to single-reading spikes (thin interbeds) and preserves sharp
transitions better than a mean. Each suggested layer carries a confidence: high
when it is at least twice the minimum thickness, medium when it just meets it, low
when it survived only by a merge. For a borehole there is no cone reading, so each
observed layer's soil code maps to a base lithology and the same merge is applied.
The layer partition is contiguous: each layer's base is the next layer's top, so
a set of accepted contacts leaves no gap.


The 2 / 1 / 0 fill rule
-----------------------

The interpreted geometry of a section is a **partition** of bands, onlaps and
lenses produced by one rule (introduced in the Litho chapter). A unit's shape
toward a neighbour depends purely on how many of its two bounding contacts are
correlated to that neighbour:

* **two correlated**, a band: the unit is a continuous band between the two
  tests;
* **one correlated**, an onlap: the unit is flat on the correlated bracket and
  pinches to a tip toward the neighbour (up if the top is tied, down if the base);
* **none correlated**, a lens: the unit is a lens with a horizontal apex at its
  own elevation, closing off between the tests.

The rule is applied per gap and per side (a unit can band one way and pinch the
other), and there is no automatic facies inference: two mismatched units meet at a
straight seam unless you draw the facies contact yourself. Below a shallow test's
total depth, the deeper stratigraphy runs as straight deep-to-deep bands, so the
deep model stays continuous even where a shallow test does not reach it. In the
geotech stage the same rule draws the packing bands. This partition is the single
source of truth for the interpreted geometry: the 2-D drawing, the 3-D build and
every geometry export all derive from it.


Bodies: identity is geometry
----------------------------

A **body** is the maximal set of same-lithology layers joined, directly or
through their neighbours, by approved correlations and observed adjacencies.
StrixGeo stamps each connected mass with one body identity. The identity says
which mass, not what shape; the shape comes from the partition above. A body's
user state (its name, colour and hand-drawn boundary) follows the mass across a
renumber. When you Join bodies into a group, every body keeps its own identity and
the group is a label carried on each member, because a group can span two litho
parents and merging would lose that provenance. A group exports as one class.


The voxel labelling
-------------------

The 3-D build does not create new geometry; it **labels space** from the 2-D
partition. StrixGeo lays a grid of small boxes over the modelled volume (bounded
by the formation surfaces and floored at the deepest investigation) and decides
each box's unit by mapping its position back onto the section partitions, using
the same fraction-to-metres mapping the 2-D fill and the closed-geometry export
use, so the solid, the sections and the export describe the same ground. Between
two sections the box takes a distance-weighted blend of the two nearest sections'
stacks, a body present on both carrying across and a body present on only one
pinching out; beyond the nearest pair the nearest section that has material is
carried outward. At an investigation the box is labelled from that investigation's
own accepted log. A meshing step then extracts a renderable surface from the grid.


Unit statistics
---------------

The Parameters stage describes each unit's measured spread. For a unit, StrixGeo
pools **every finite CPT reading that falls inside the unit's bands**, across all
the CPTs the unit stands on, in the depth frame metres below the collar. It
summarises three channels independently, each on its own axis: cone resistance qc
(MPa), sleeve friction fs (MPa) and friction ratio Rf (%). For each channel it
reports the count of finite samples and, when the count supports them, the
five-number summary (minimum, 5th percentile, first quartile, median, third
quartile, 95th percentile, maximum), the arithmetic mean, and the sample standard
deviation (n minus 1). Any statistic the sample count cannot support is reported
blank, never zero: an empty unit has no median, and a single reading has no
standard deviation. These are descriptive statistics of measurements, with no
correlation, conversion or calibration into a design value.


Export mapping
--------------

Every export identifies a unit by a token built from its NAD class and soil code
(for example a class-6 sand becomes ``NAD-06_ZAND``, a formation gets no token).
Because a group is a set of separate bodies sharing a label, the export maps the
whole group to one class. The class is zero-padded so that text-sorting material
lists keep the classes in order, and it leads the token so a wildcard selects
every instance of a class. The D-Series exporters attach the characteristic unit
weight, friction angle and cohesion only where the NAD table has a row for the
class, and write no other design parameter.
