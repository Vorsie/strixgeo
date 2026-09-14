Stratigraphy: formations and surfaces
=====================================

The stratigraphic model is the regional backbone of the ground model: the
formations and the surfaces that separate them. It is the first of the three
levels, and both the lithological and the geotechnical models hang off it. The
formations are named after the Belgian stratigraphic nomenclature maintained by
the National Commission for Stratigraphy Belgium (NCS), so the units you build
carry the accepted Flemish and Belgian names (Boom Formation, Diest Formation,
the Ieper Group, the Quaternary cover).

Formations: adding them, and seeding from boreholes
---------------------------------------------------

The Stratigraphy stage is where you **define the model**, the set of formations.
There are two ways to bring a formation into being, and they are worth keeping
distinct.

* **Add a formation by hand.** You create it, name it, and place it in the
  stratigraphic order yourself. This is how you enter a formation you know should
  be there, or one no borehole has named.
* **Seed from boreholes ("Fill from boreholes").** StrixGeo reads the observed
  stratigraphy of the imported boreholes and creates the formation set from it,
  across the whole model at once. This is the fast way to get from a set of
  borehole logs to a first formation list.

The fill step often meets **two slightly different names for the same
formation**: one log wrote it one way, another slightly differently, or a formal
and an informal name for the same unit. The fill dialog lets you **lump them
together** into a single formation, so the model has one unit where the field
logs had two spellings. StrixGeo also folds obvious variants together on its own
(case, dashes, a chronostratigraphic prefix), but the lumping you do by hand is
the authority.

When you lump, **read the DOV code shown next to each candidate**. Beside every
informal name the fill dialog prints the DOV formal-stratigraphy code or codes
the boreholes paired it with, and how many boreholes each came from. That code
is the reliable identity to lump on: two field logs can spell a unit
differently, or use an old and a new code for the same member, while the DOV
code still says what the borehole actually recorded. A worked example: a layer
logged as *Ieperiaan* may carry the code **TtEg**, and one logged
*Formatie van Hyon - Lid van Egem* may carry **HyEg**. Both codes are the Egem
member (the 2017 national nomenclature renamed the Tielt Formation to Hyon), so
they are the same unit even though the informal names read nothing alike. Where
StrixGeo recognises the code it also offers the DOV unit name (here *Lid van
Egem*) as a one-click target, so you can accept the official member name for
both instead of guessing which spelling to keep.

Formations carry a **stratigraphic order**: a lower order is an older formation,
deeper in the column. Every layered view paints formations oldest-first so that
younger formations render on top, the geological superposition rule. The one
deliberate exception is the formation *list* in the inspector, which reads
youngest-first like a borehole log; that is a presentation-only reversal and does
not change the order. You can drag to reorder, and a manual reorder **pins** the
formations so a later build never silently reverts your ordering. That matters
for unusual stratigraphy (pinch-outs, unconformities, inversions) where an
automatic age guess would be wrong.

Contacts, and how a unit is defined
-----------------------------------

A **formation contact** is a committed boundary: the depth at which one formation
meets the next at a specific investigation. Contacts are the durable, audited
record of your interpretation; every depth change is timestamped and logged,
whichever part of the interface fired the edit.

A unit is defined by its **top boundary**. Its base is not stored separately: it
is simply the top of the next unit below, or, where there is no unit below, the
bottom of what the investigation reached. Move a contact and you move the top of
the unit under it and the base of the unit over it at the same time; the column
stays gap-free by construction.

Because a test's formation contacts are a property of the **test**, not of any
section, you classify a test once and its contacts appear on every section whose
corridor contains it. There is no per-section step to make a formation contact
visible.

The borehole log on the model
-----------------------------

A borehole brings its observed soil log and its samples with it, and the
Stratigraphy stage shows that log against your formations, so you can place a
contact against what the driller actually recorded rather than against a bare
depth axis.

Seeding on the model, against seeding per section
-------------------------------------------------

The three levels do not all seed the same way, and it helps to know which is
which.

* The **stratigraphic model seeds on the model**: "Fill from boreholes" creates
  formations for the whole project at once. (A separate per-section verb can
  reveal already-created contacts on one section, but it never creates a new
  formation.)
* The **lithological and geotechnical models seed per section**: you run their
  suggestions on the section you are looking at, one section at a time, because
  those interpretations are built where you can see the columns side by side.

Surfaces, and the 3-D stratigraphic model
------------------------------------------

A **surface** is the interpolated top of a formation, built by triangulating
across the contacts you have placed. The triangulation is a Delaunay triangulated
irregular network (a TIN) today; other interpolation methods can be added later.

StrixGeo uses **on-click build**: editing a contact does not silently recompute
the surface. It marks the affected surface stale, and the section view shows a
stale surface dimmed and dashed, so you can see "this is your last build, refresh
to update." Only the "Build 3-D model" action re-runs the interpolation, so
nothing recomputes behind your back. The built surfaces, stacked in the 3-D view,
are the stratigraphic model in three dimensions.

Once built, a **crossing validator** samples each pair of surfaces and flags any
point where a younger formation dips below an older one, raising a
"surface crossings detected" banner so you can find and fix the inversion.

Faulting and overturned folding are future work. They are deemed unnecessary for
the large majority of projects in Flanders, so they are left out of this version
rather than half-built.

The DEM ground surface, and the elevation-trust rule
----------------------------------------------------

StrixGeo can carry a **DEM-based ground surface** as the ground between
investigations. Where a real investigation has a surveyed collar elevation, the
surface is warped to meet that collar exactly: it anchors a vertex at each collar
and uses the DEM only for the ground in between.

The rule behind this is the **elevation-trust rule**: a surveyed surface
elevation of a test is trusted more than a DEM pulled from the web. A surveyed
collar therefore outranks the DEM at that point, and the DEM fills only the
ground between tests. One corollary matters in Belgium: a ground level of
**0 m TAW is a real value**, not a missing-data marker, so StrixGeo treats a
genuine 0.0 m collar as data. The 3-D view can also show a **footprint ring**
marking the extent of the interpreted volume.

Drawing the canal bed: bed overrides
------------------------------------

Over water the DEM is the water surface, not the bed. Where a site was dredged,
that difference is large: a canal cut 8 m below the banks reads as if the ground
there sat at the water level. A **bed override** fixes this by hand. You draw a
polygon on the map and type one constant bed elevation in m TAW for it. Inside
the polygon the ground surface takes that bed level instead of the DEM; outside,
the DEM stands. You can draw several polygons, each with its own level, and edit
or delete them from the list in the right pane.

The bed level feeds every consumer of the ground surface: the 3-D ground
surface, the section DEM line (which shows the bed where the section crosses the
polygon), and the surface clip described next. The lithological and
geotechnical models follow it too: inside a bed polygon the section fill and the
3-D litho model stop at the bed level, so nothing lithological is drawn or built
above the dredged bed (outside the polygon nothing changes). The 3-D fence walls
and the fence DXF export are cut at the bed at once as well, but the built 3-D
models (litho and geotech solids) and the stratigraphy surfaces cache the ground
they were built on, so after you draw, edit, or delete a bed StrixGeo marks them
for rebuild and a toast reminds you to Build again to cut them at it (the section
and fence views are already cut). A surveyed test collar still wins over the bed
at the test's own location, the same elevation-trust rule as above.

When a formation surface meets the ground: the crossing-line clip
-----------------------------------------------------------------

On Build, each formation surface is cut where it crosses the ground surface. The
crossing is a line, and StrixGeo feeds that line into the surface as new points
and drops the part above the ground. So a formation surface **ends where it
meets the ground**: under a dredged canal, a unit that was present on both banks
is cut away between them and is simply gone under the water, which matches the
site. A surface that lies entirely below the ground, like a deep unit well under
the bed, keeps its own top unchanged: it is never flattened to the ground. This
replaces an older clamp that pushed every crossing surface down to a flat
plateau at the ground level.

.. admonition:: Bathymetry and water

   Bathymetry from a survey file cannot be imported yet: the manual bed override
   above is the way to set the bed for now. Over water, the DEM otherwise stands
   in for the water surface, which makes it an approximation of the water level
   and very untrustworthy there: it is not the bed of the river or the sea. Full
   bathymetry import is worth adding later, and not only for a more honest
   picture of the ground. Recent
   alluvial and marine deposits are strongly shaped by water: a meandering river
   deposits on the inner bend and erodes the outer bend, so the two banks
   carry distinctly different material, and
   natural or man-made levee breaks and floodplain deposits are usually one-sided.
   Getting the water surface right is part of getting those deposits right.
