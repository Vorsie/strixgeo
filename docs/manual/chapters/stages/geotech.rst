Geotech — NAD packing subdivision
=================================

The geotechnical model (level 3) is derived from the lithostratigraphic model. It
takes each litho unit and **subdivides it by packing density / consistency** into
a Belgian **NAD packing class** (1–31): los / matig / dicht / zeer dicht for
sand and gravel, weinig-vast → vast for the fine soils. The subdivision is driven
by the CPT cone resistance, but the lithology itself is never changed — *lithology
is hard truth: qc never promotes or demotes a unit across soil types.*

How a unit's class is chosen
----------------------------

Press "Subdivide all bodies" and StrixGeo, for each litho body, reads the CPT
cone resistances that fall inside the body, reduces them to a single
**representative qc**, and looks that value up against the NAD qc bands for the
unit's soil and admixture variant. The precise mechanics — the representative
statistic, the qc-band table, the admixture variant, and what happens where
there is no CPT — are in chapter 3. In brief:

* The representative qc is a single, selectable statistic over the body's
  readings (median by default; arithmetic, harmonic or geometric available).
  Harmonic is the conservative choice, weighted toward the low values.
* That representative qc is looked up in the NAD table for the ``(soil,
  variant)`` column, which returns the class.
* The class always belongs to the unit's own soil column — a sand unit can only
  ever carry a sand packing class.

The admixture choice
--------------------

The NAD table has a **clean** column and a **secondary** (with-admixture) column
for each soil: sand/gravel go secondary when they carry a silt or clay admixture
("silt-/kleihoudend"), and the fine soils go secondary on a sand admixture
("zandhoudend"). To keep this an explicit engineering decision rather than a
silent inference, the **first gate of the geotech Build asks you, per unit that
carries an admixture, whether it is "pure sand or sand with admixture"** (the NAD
family choice). Your answer is persisted and forces the column: a "pure" answer
classifies into the clean column, a "with admixture" answer into the secondary
column, regardless of what admixtures the unit happens to carry. This choice is
the owner's ruling of 2026-09-04 and it wins over the automatic
admixture-detection.

The fill follows the same 2 / 1 / 0 rule
----------------------------------------

The geotech stage draws its packing bands with the **same 2 / 1 / 0
contact-correlation rule** as the litho stage (see the Litho chapter): you
correlate the packing bands between tests, and the fill follows the count of
correlated contacts — two ties give a band, one an onlap, zero a lens. Where a
CPT does not read a stretch of ground (an unread head or tail of a litho segment
longer than the minimum thickness), StrixGeo leaves it as its own **needs-review**
band rather than inventing a class across columns; you correlate the packing
density and decide.

Sub-minimum slivers are handled conservatively. A thin seam is absorbed into a
neighbour only if the neighbour's class survives the merge going *looser*; where
every absorption would come out *denser*, the seam stands as its own band below
the minimum thickness and you decide with the band verbs — StrixGeo will not
silently upgrade a matig sand to a dense one.

Grouping: Join means group, never merge
----------------------------------------

Every geometrically-disconnected mass starts as its **own body** — StrixGeo does
not auto-lump. When you want several bodies treated together — silt lenses in a
sand pack with a similar packing, say — you **Join** them into a group. This is
the owner's ruling, in his words: *grouping is just for lumping things that are
similar together, so we have more data and maybe fewer export classes.*

The important property is that **Join groups, it does not merge**:

* Every body keeps its **own separate body id**. A group can span two different
  litho parents, and merging would lose that provenance; grouping instead adds a
  label.
* A grouped body shows a **"(group N)"** tag in the units pane behind each
  distinct member.
* Unit statistics for a grouped body **pool** all members, and the statistics
  header reads "group of N" with a bullet list of the source bodies.
* In an export, a group maps to **one class**.

The verbs are **Join with…** / **Un-join from {label}** (Dutch: *Voeg samen
met…* / *Ontkoppelen van {label}*). The body menu — statistics, name, Join /
Un-join, Dissolve — is available on both the geotech axis and the litho axis.

What the geotech stage produces, and what it leaves blank
---------------------------------------------------------

For each geotech unit StrixGeo shows the **CPT-derived indicators** that are in
scope: the Robertson Ic soil-behaviour zone, the relative density Dr for sand
units, the NAD packing class, and a unit-weight estimate. All are labelled
"CPT-derived estimate."

The **design-ready parameter values** — φ′, c′, cu, E50, OCR, Vs, G0, M — stay
**blank**. You fill those in your downstream design tool. That is the
characterisation-vs-design boundary from chapter 1, applied at the unit level.
