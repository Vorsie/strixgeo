Export: handing the model to the design tools
=============================================

Export is where the ground model leaves StrixGeo and enters the tool that does
the engineering. StrixGeo's job ends at a faithful, machine-usable description of
the geometry and the classification; the design checks happen downstream.

One rule governs the D-Series exporters and is the most important thing to know
about this stage: they write **no design parameter that StrixGeo invented**. They
carry the geometry and the unit identity, and the only strength and stiffness
numbers they attach are the characteristic values from the published NAD table,
where it has a row. Everything else is left for you to set downstream.
Eventually, design parameters will flow further out of StrixGeo; today they do not
beyond the NAD characteristic values, and that is future work.

The Export stage is the only place exports live
-----------------------------------------------

Every export is a **card on the Export stage**, grouped by model level:
a cross-section DXF (on any axis), the stratigraphic model to Plaxis 3D, the
lithological fence DXF, the geotechnical D-Stability ``.stix`` / D-Sheet
``.shi`` / Plaxis 2D / fence DXF, and the PDF report sheet. D-Stability and
Plaxis 2D are geotechnical only. Each card has
its own scope pickers (the cross-section, and the model level where a card offers
a choice), an Export button, and a reminder of where you last saved that export.
A card whose prerequisite is missing — no model, no cross-section — explains what
to do first instead of offering a dead button.

You never have to hunt for an export in the toolbars. On a cross-section, the
toolbar's single **Export…** verb opens this stage with that section and its axis
already selected; on the 3-D lithology and geotechnical stages, **Export…** does
the same. Whatever the toolbar built before, the Export stage builds now — a
cross-section export taken here is identical to the one the toolbar used to make.

.. admonition:: The exports are not yet validated

   The Plaxis and D-Series exports are complete and runnable, but they have not
   yet been validated inside the target software against a hand-checked
   benchmark. Validating them in Plaxis, D-Stability and D-Sheet Piling is one of
   the open tasks of the tester loop. Until then, treat an exported model as a strong
   starting point to open and inspect, not as a finished, verified input.

Unit identifiers
----------------

Every export carries a **unit identifier** so the downstream tool can map a unit
onto a material definition. The identifier is built from the two machine-usable
fields on a unit, the NAD packing class and the base soil code, through one shared
rule.

.. list-table:: The unit identifier token
   :header-rows: 1
   :widths: 45 25 30

   * - Level
     - Example unit
     - Token
   * - geotech, classified
     - class-6 sand
     - ``NAD-06_ZAND``
   * - geotech, no soil on the litho parent
     - class 6
     - ``NAD-06``
   * - litho
     - sand
     - ``ZAND``
   * - stratigraphic
     - a formation
     - *(none)*

The class is zero-padded (``NAD-06``) so that CAD and Plaxis material lists, which
sort as text, keep the classes in order, and it leads the token so that
``NAD-06_*`` selects every instance of one class. A unit's *name* changes in an
export only when it carries a NAD class; formations, litho units and unclassified
geotech skeleton bands keep byte-identical names, and their identifiers ride
metadata channels (a DXF layer description, a Plaxis mapping table, the PDF
legend).

What each export carries
------------------------

**DXF (section).** One CAD layer per unit, named with the unit identifier and the
unit name; the layer description adds the NAD class and soil, and a mapping table
in model space lists the units. Two stacked units of the same NAD class can
optionally be thinned in the DXF (and only the DXF and PDF), so a delivered
drawing does not read as two materials where the engineer has one; the shallower
parent name wins, and this is opt-out.

**Plaxis 2D and 3D.** A runnable script (a Python file) that you run against your
own Plaxis instance. It clears the project, creates one Mohr-Coulomb material per
formation with the parameters **left as placeholders**, creates the soil layers in
stratigraphic order, and creates one borehole per investigation with its surface
elevation, setting each contact's level. The script header carries a unit-mapping
table (material to NAD class to soil to unit to formation). Neither Plaxis
exporter sets a water level, because writing a surface elevation into Plaxis's
head property would make the model fully saturated, and both headers say so.
Populating the Plaxis materials from the NAD table, as the D-Series exports
already do, is future work.

**D-Stability (.stix) and D-Sheet Piling (.shi).** These are written in memory
through the Deltares GEOLib library, so no D-Series installation is needed.
D-Stability's geometry is a set of closed soil-layer polygons, so StrixGeo sends
the exact partition you drew on the section (the same payload the 3-D build uses)
and closes it into polygons, one layer per drawn region, named by the unit
identifier. D-Sheet models a single 1-D soil profile per side, which StrixGeo
samples from the drawn fill along the section.

For both D-Series targets:

* **The ground surface is exported** (a surveyed surface elevation is a
  measurement).
* **No phreatic line, head line, load or reinforcement is ever written.** The
  water level is left at GEOLib's own default and named ``TODO``, never set to the
  ground surface.
* **The NAD characteristic parameters are attached where the table has a row.**
  StrixGeo carries the characteristic unit weight, effective friction angle and
  effective cohesion per packing class from the NAD table of NBN EN 1997-1 ANB
  (Tabel 2.1). When a class is in that table, those values ride on its
  Mohr-Coulomb soil and the soil's note names the source table. When a class is
  not in the table, the parameters stay at GEOLib's blank initial values, chosen
  over a plausible-looking default precisely so a blank cannot be mistaken for a
  value StrixGeo stood behind. These are characteristic values from the norm, to
  be verified against the norm; they are not a design output.
* **A section with nothing drawable is refused, not shipped empty.** An empty but
  correctly-named ``.stix`` is a plausible, completely-wrong deliverable, so
  StrixGeo refuses rather than produce one. Regions that cannot close are dropped
  and counted, never repaired into invented ground.

**Fence DXF.** The 3-D fence walls, written as a DXF you open directly in CAD, one
3-D face per triangle, coloured from the panel. The geometry, the on-screen name
and the colour travel up from the drawing, so the DXF matches the screen. A fence
with no geometry is refused before the request, because a valid empty DXF reads as
"the model is empty", the one failure a CAD user cannot see.

The layers are split by section and by formation together, so a layer name reads
like ``Fence-CS1_NAD-06_ZAND``: the section it belongs to, then the unit. That lets
you switch a whole section off in CAD by hiding every layer whose name starts with
that section, while a single unit stays selectable across all the sections by its
trailing name. The colour and the line weight are unchanged by the split. Each wall
also records which body it belongs to as extended data on the face, so a body can
be found from any of its faces in CAD without a plug-in; the body is kept off the
layer name on purpose, because one body can span several sections while the layers
are split per section.

**Cross-section PDF sheet.** The drawing sheet described in the Sections chapter,
carrying the on-screen unit names in the legend and in the fills.
