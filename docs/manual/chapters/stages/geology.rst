Geology — formations, contacts and surfaces
===========================================

The geological model is the regional backbone of the ground model: the
formations and the surfaces that separate them. It is level 1 of the three-level
hierarchy, and both the lithostratigraphic and geotechnical models hang off it.

Formations
----------

The Geology stage is where you **define the model**: create and curate the
formations (Boom Klei, Diest Zand, Quaternary cover, …), order them, and — with
"Fill from boreholes" — seed the formation set from the borehole stratigraphy
already imported.

Formations carry a **stratigraphic order** (``display_order``): a lower order is
an older formation, deeper in the stratigraphic column. Every layered view paints
formations oldest-first so that younger formations render on top — the geological
superposition rule. The one deliberate exception is the formation *list* in the
inspector, which reads youngest-first like a borehole log; that is a
presentation-only reversal and does not change the order semantics. You can
drag to reorder; a manual reorder **pins** the formations so that a later Build
never silently reverts your ordering — important for unusual stratigraphy
(pinch-outs, unconformities, inversions) where an automatic age inference would
be wrong.

Contacts
--------

A **formation contact** is a committed boundary: the depth at which one formation
meets the next at a specific investigation. Contacts are the durable, audited
record of your interpretation. Every depth change goes through the matching
update, so it lands in the logs and is timestamped — the audit trail is the rule,
regardless of which part of the UI fired the edit.

**Classification follows the test.** A test's classification — its formation
contacts and its accepted litho layers — is a property of the borehole or CPT,
not of any section. Classify a test once, and it appears automatically on every
section whose corridor contains it. There is no per-section seeding step to make
a classification visible; this removes the temptation to re-classify on a fresh
section and land a second, slightly different boundary set on the same test.

Surfaces and on-click Build
---------------------------

A **surface** is the interpolated top of a formation, built by triangulating
(Delaunay / TIN) across the contacts you have placed. StrixGeo uses **on-click
build**: editing a contact does *not* silently recompute the surface. Instead it
marks the affected surface stale, and the section view shows a stale TIN dimmed
and dashed so you can see "this is your last build, refresh to update." Only the
"Build 3-D model" action re-runs the interpolation. You control when surfaces
compute — nothing recomputes behind your back.

Once built, a **crossing validator** samples each pair of surfaces and flags any
point where a younger formation dips below an older one, surfacing an amber
"N surface crossings detected" banner so you can find and fix the inversion.

The DEM ground surface and the elevation-trust rule
---------------------------------------------------

StrixGeo can carry a **DEM-based ground surface** (the G7 surface) as the ground
between investigations. Where a real investigation has a surveyed collar
elevation, the surface is warped to **meet that collar exactly**: the TIN anchors
a vertex at each collar and uses the DEM only for the ground in between.

The rule behind this is the **elevation-trust rule**, stated by the owner: *a
surveyed surface elevation of a test is trusted more than a DEM pulled from the
web.* A surveyed collar therefore outranks the DEM sample at that point; the DEM
fills only the ground between tests. One corollary matters in Belgium: a ground
level of **0 m TAW is a real value**, not a missing-data sentinel — StrixGeo
treats a genuine 0.0 m collar as data, never as "no elevation."
