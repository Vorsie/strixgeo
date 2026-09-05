desktop.renderer.src.utils.sectionCoordinatePlausibility
========================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/sectionCoordinatePlausibility.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/sectionCoordinatePlausibility.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-28

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionCoordinatePlausibility.ts
   :language: typescript
   :lines: 1-28
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This file answers one yes/no question: is a section's line something the app can sensibly ask a ground-surface model (DEM) about? It only judges; the caller decides whether to skip a fetch, warn, or show a toast. The block covers the module comment and the section-row documentation.

**Why it is here.** The comment records the incident that forced it (dogfeed 2026-08-02, root-caused the next day): the section panel flooded the DEM endpoint with impossible extents on every re-mount, each a 30-second round-trip to the Flemish coverage service that returned not-found. The cause was in the data — two hand-typed section rows carried section-space coordinates like (0,0) to (1,0) while declaring a real map coordinate system (EPSG:31370, Belgian Lambert 72). The old length-based guard could not catch that; the right question is whether the endpoints fall inside the declared coordinate system's own area of use. Distances are metres only inside a projected metric CRS, and an EPSG number names one specific CRS. It deliberately does not restrict to Flanders, because a Wallonia or Netherlands section is a perfectly legal request.

.. CG-EXPLANATION-END id=module-header

``interface SectionLineLike``
-----------------------------

.. CG-BLOCK id=interface:SectionLineLike lines=29-44

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionCoordinatePlausibility.ts
   :language: typescript
   :lines: 29-44
   :lineno-match:

.. CG-EXPLANATION-START id=interface:SectionLineLike

**What this does.** A declared shape for just enough of a section row to judge its geometry: its name, its start and end coordinates, and its declared EPSG number. The block ends with the documentation for the CRS table below.

**Why it is here.** It names only the fields the plausibility check reads, so the check does not depend on the full section row.

.. CG-EXPLANATION-END id=interface:SectionLineLike

``const CRS_DOMAINS``
---------------------

.. CG-BLOCK id=const:CRS_DOMAINS lines=45-61

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionCoordinatePlausibility.ts
   :language: typescript
   :lines: 45-61
   :lineno-match:

.. CG-EXPLANATION-START id=const:CRS_DOMAINS

**What this does.** A table, keyed by EPSG number, of a readable coordinate-system name and the rectangle of coordinates that system covers — Belgian Lambert 72 and Dutch RD New. The block ends with the documentation for the function below.

**Why it is here.** The comment records that the rectangles mirror the backend DEM's valid-extent constants — the coordinate system's area of use, not the data coverage footprint — so a legitimate no-data request still gets through to the server, and that any EPSG not in this table is not judged at all, because the check refuses only what it can prove impossible.

.. CG-EXPLANATION-END id=const:CRS_DOMAINS

``function implausibleSectionCoordinates``
------------------------------------------

.. CG-BLOCK id=function:implausibleSectionCoordinates lines=62-85

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionCoordinatePlausibility.ts
   :language: typescript
   :lines: 62-85
   :lineno-match:

.. CG-EXPLANATION-START id=function:implausibleSectionCoordinates

**What this does.** Returns a sentence explaining why a section's endpoints cannot be real map coordinates, or nothing when they are fine. It first rejects any non-finite coordinate, then, for a coordinate system it holds a domain for, rejects endpoints that fall outside that system's rectangle.

**Why it is here.** The docstring records that the returned sentence names the section and what is wrong, suitable for both a toast and a warning log, and that it returns nothing when the line is plausible or the coordinate system is one it holds no domain for. The comment notes the backend has a matching guard; this one just stops the pointless round-trip from being paid at all.

.. CG-EXPLANATION-END id=function:implausibleSectionCoordinates

