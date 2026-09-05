Geotech: NAD packing subdivision
================================

The geotechnical model is the third and last level. It takes each unit of the
lithological model and subdivides it by **packing density or consistency**,
assigning a Belgian **NAD** class (1 to 31): a packing from los to zeer dicht for
the coarse soils, and a consistency from weinig-vast to vast for the fine soils.
The subdivision is driven by the CPT cone resistance, but the soil type itself is
never touched: lithology is hard truth, and the cone resistance never promotes or
demotes a unit from one soil to another.

How a unit's class is chosen
----------------------------

Press "Subdivide", and StrixGeo, for each litho body, reads the CPT cone
resistances that fall inside the body, reduces them to a single **representative
qc**, and looks that value up against the NAD bands for the unit's soil and
admixture variant.

* The representative qc is a single, selectable statistic over the body's
  readings. The default is the **median**, which is robust to spikes; the
  arithmetic, harmonic and geometric means are also available. The harmonic mean
  is the conservative choice, weighted toward the low readings.
* The lookup is on **raw qc**, in megapascals, with no normalisation. This is the
  NAD table's own method.
* The class always belongs to the unit's own soil column. A sand unit can only
  carry a sand class; a clay at a sand-like qc stays a clay and takes its densest
  clay class.

The geotech stage has its own **minimum depth interval** (default 0.35 m,
tunable per project), coarser than the litho segmenter's, so coarsening the
packing bands never disturbs the lithology layering. A sliver thinner than that
is treated conservatively: StrixGeo absorbs it into a neighbour only if the
neighbour's class survives the merge going *looser*. Where every absorption would
come out denser, the sliver stands as its own thin band and you decide. StrixGeo
will not silently upgrade a matig sand to a dense one.

The admixture choice
--------------------

The NAD table has a **clean** column and a **with-admixture** column for each
soil. What counts as an admixture here is specific: a **clayey or silty**
admixture in a sand or gravel ("silt- or kleihoudend"), or a **sand** admixture
in a fine soil ("zandhoudend"). A gravel admixture in a sand does not count; a
gravelly sand is treated as plain sand and classified in the clean column.

To keep the choice an explicit engineering decision rather than a silent guess,
StrixGeo asks you at the start of the geotech build, but **only for a unit that
actually carries a clayey or silty admixture**, whether it is pure sand or sand
with admixture. A unit with no such admixture is not asked about. Your answer is
remembered and forces the column: "pure" classifies into the clean column, "with
admixture" into the with-admixture column.

How boreholes are subdivided
----------------------------

A borehole records no cone resistance, so its packing cannot be read from its own
data. StrixGeo classifies a borehole layer from the CPTs around it: it takes the
packing of the same soil from the CPTs on either side of the borehole on the
section, and carries it onto the borehole layer. Where no CPT of that soil is
near enough to speak, it falls back to the **loosest** class of that soil's own
column, a conservative floor, and marks the result low-confidence. It never
borrows a class from a different soil.

.. admonition:: A borehole between two CPTs

   When a borehole sits between two CPTs on a section, its packing bands come
   from those two flanks. If you have drawn a packing correlation across the
   borehole (tying the two CPTs' bands together), StrixGeo blends the two flanks'
   packing across the borehole in proportion to the distance, so the borehole
   reads as a smooth transition between them. Where the two flanks disagree on a
   band's class, the nearer CPT names it. A drawn tie is preferred over a bare
   left-and-right blend, because the tie is your explicit statement that the two
   packings belong together.

How a CPTM is subdivided
------------------------

A mechanical Begemann cone (a CPTM) still records a cone resistance, and the NAD
lookup is a raw-qc lookup, so a CPTM is subdivided from its qc exactly like any
other CPT. It needs no friction ratio for the packing class, which is why a CPTM
that recorded no sleeve friction still classifies for packing. The soil-behaviour
index and the relative density, which do need the friction, are simply not part
of the packing lookup.

The fill follows the same 2 / 1 / 0 rule
----------------------------------------

The geotech stage draws its packing bands with the **same 2 / 1 / 0
contact-correlation rule** as the litho stage: you correlate the packing bands
between tests, and the fill follows the count of correlated contacts, two ties a
band, one an onlap, none a lens. Where a CPT does not read a stretch of ground
(an unread head or tail longer than the minimum thickness), StrixGeo leaves it as
its own needs-review band rather than inventing a class across columns; you
correlate the packing and decide.

Grouping: Join means group, never merge
----------------------------------------

Every geometrically-disconnected mass starts as its own body; StrixGeo does not
auto-lump. When you want several bodies treated together, silt lenses in a sand
pack with a similar packing, say, you **Join** them into a group, so you pool
their data and end up with fewer export classes. Join **groups**, it does not
merge:

* Every body keeps its own separate body identity. A group can span two different
  litho parents, and merging would lose that provenance, so grouping adds a label
  instead.
* A grouped body shows a "(group N)" tag against each member.
* An export maps the whole group to one class.

The verbs are **Join with…** and **Un-join from {label}** (in Dutch, *Voeg samen
met…* and *Ontkoppelen van {label}*). The body menu is available on both the
geotech axis and the litho axis.

What the geotech stage produces
-------------------------------

For each geotech unit StrixGeo shows the **CPT-derived indicators** in scope: the
soil-behaviour zone, the relative density for sand units, the NAD packing class,
and a unit-weight estimate. It also reads the **NAD characteristic parameters**
from the table, one general value per body: the dry and wet unit weight, the
effective friction angle, the effective cohesion, and, for fine soils, the
undrained shear strength. These characteristic values are shown in the Parameters
stage, kept separate from the measured statistics. All of them are estimates the
engineer must verify.

The more advanced design-ready values (a stiffness E50, an over-consolidation
ratio OCR, a shear-wave velocity Vs, and the like) are not produced in this
version; they are future work.

The 3-D geotech model
---------------------

The 3-D build works on the geotech axis exactly as it does on the litho axis: the
same voxel labelling (explained in the Litho chapter) fills the space between the
sections, colouring each voxel by its packing class instead of its lithology. The
fence diagram and a **split viewport**, which shows two axes side by side (the
litho and the geotech model, say), let you compare the lithological and
geotechnical pictures of the same ground.
