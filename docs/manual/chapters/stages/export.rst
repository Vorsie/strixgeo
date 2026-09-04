Export — handing the model to the design tools
==============================================

Export is where the ground model leaves StrixGeo and enters the tool that does
the engineering. StrixGeo's job ends at a faithful, machine-usable description of
the geometry and the classification; the design checks happen downstream.

One rule governs every exporter and is the most important thing to know about
this stage: **the D-Series exporters write no design parameter that StrixGeo
invented.** They carry the geometry and the unit identity; the strength and
stiffness numbers are yours to set, or come only from the published NAD table
where it has a row (see below). This is the characterisation-vs-design boundary,
enforced at the file level.

Unit identifiers — the common thread
------------------------------------

Every export carries a **unit identifier** so the downstream tool can map a unit
onto a material definition. The identifier is built from the two machine-usable
fields on a unit — the NAD packing class and the base soil code — through one
shared rule:

.. list-table:: The unit identifier token
   :header-rows: 1
   :widths: 45 25 30

   * - Level
     - Example unit
     - Token
   * - geotech, classified
     - NAD 6 sand
     - ``NAD-06_ZAND``
   * - geotech, no soil on the litho parent
     - NAD 6
     - ``NAD-06``
   * - litho
     - sand
     - ``ZAND``
   * - geological
     - a formation
     - *(none)*

The class is zero-padded (``NAD-06``) so CAD and Plaxis material lists, which
sort as text, keep the classes in order, and it leads the token so ``NAD-06_*``
selects every instance of one class. A unit's *name* changes in an export only
when it carries a NAD class; geological formations, litho units and unclassified
geotech skeleton bands keep byte-identical names, and their identifiers ride
metadata channels (a DXF layer description, a Plaxis mapping table, the PDF
legend).

What each export carries
------------------------

**DXF (section).** One CAD layer per unit, named with the unit identifier and the
unit name; the layer description adds the NAD class and soil; a mapping table in
model space lists the units. Two stacked units of the same NAD class can
optionally be thinned in the DXF (and only the DXF/PDF) so a delivered drawing
does not read as two materials where the engineer has one — the shallower parent
name wins, and this is opt-out.

**Plaxis 2D and 3D.** A runnable ``plxscripting`` Python script (a ``.py`` file)
that you run against your own Plaxis instance. It clears the project, creates one
Mohr-Coulomb material per formation **with parameters blank** (Phase 5 fills
them), creates the soil layers in stratigraphic order, and creates one borehole
per investigation with its surface elevation, setting each contact's absolute
level. The script's header carries a unit-mapping table (material → NAD class →
soil → unit → formation id). **Neither Plaxis exporter sets a water level** —
writing a surface elevation into Plaxis's head property would make the model
fully saturated — and both script headers state that no water table was
exported.

**D-Stability (.stix)** and **D-Sheet Piling (.shi).** These are written in
memory through the Deltares GEOLib library, so no D-Series installation is
needed. D-Stability's geometry *is* a set of closed soil-layer polygons, so
StrixGeo POSTs the exact partition you drew on the section (the same payload the
3-D build uses) and closes it into polygons — one layer per drawn region, named
by the unit identifier. D-Sheet models a single 1-D soil profile per side, which
StrixGeo samples from the drawn fill along the section.

For both D-Series targets:

* **The ground surface is exported** (a surveyed surface elevation is a
  measurement).
* **No phreatic line, head line, load or reinforcement is ever written.** The
  water level is left at GEOLib's own default and named ``TODO`` — never set to
  the ground surface.
* **Design parameters are written only where the published NAD table carries the
  unit's class.** StrixGeo carries the NAD characteristic soil parameters — unit
  weight γ, effective friction angle φ′, effective cohesion c′ — per packing
  class, transcribed from the NAD table of NBN EN 1997-1 ANB (Tabel 2.1). When a class
  is in that table, its γ, φ′ and c′ ride on the Mohr-Coulomb soil, and the
  soil's note names the source table. When a class is not in the table, the
  parameters stay at GEOLib's own blank initial values — chosen over a plausible
  default precisely because a blank cannot be mistaken for a value StrixGeo stood
  behind. These are characteristic values from the norm, to be verified against
  the norm; they are not a design output.
* **A section with nothing drawable is refused, not shipped empty.** An empty but
  correctly-named ``.stix`` is a plausible, completely-wrong deliverable, so
  StrixGeo refuses rather than produce one. Regions that cannot close are dropped
  and counted, never repaired into invented ground.

**Fence DXF.** The 3-D fence walls, written as a DXF you open directly in CAD —
one 3-D face per triangle, one layer per panel, coloured from the panel. The
geometry and the on-screen name and colour travel up from the renderer (the
fence has no server-side twin), so the DXF matches the screen. A fence with no
geometry is refused before the request, because a valid empty DXF reads as "the
model is empty" — the one failure a CAD user cannot see.

**Cross-section PDF sheet.** The client-rendered drawing sheet described in the
Sections chapter, carrying the on-screen unit names in the legend and in the
fills.
