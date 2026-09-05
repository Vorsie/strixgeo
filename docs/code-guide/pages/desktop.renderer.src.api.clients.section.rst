desktop.renderer.src.api.clients.section
========================================

.. CG-PAGE source=desktop/src/renderer/src/api/clients/section.ts complete=true

*Source file:* ``desktop/src/renderer/src/api/clients/section.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-23

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/section.ts
   :language: typescript
   :lines: 1-23
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The opening comment and imports for the section client — the typed calls for a project's cross-sections and for sampling the DEM ground line. It imports the shared HTTP helpers (including the two binary-bytes helpers) and, type-only, the shape of a section's drawn partition.

**Why it is here.** The comment records that the cross-section shape lives here because it is the canonical section primitive that geology responses reference. Every call goes through the shared ``request`` helper introduced on the ``desktop.renderer.src.api.clients.shared`` page.

.. CG-EXPLANATION-END id=module-header

``interface DemSamplePoint``
----------------------------

.. CG-BLOCK id=interface:DemSamplePoint lines=24-29

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/section.ts
   :language: typescript
   :lines: 24-29
   :lineno-match:

.. CG-EXPLANATION-START id=interface:DemSamplePoint

**What this does.** Describes one elevation sample along a section line: how far along, and the elevation (or null).

**Why it is here.** The docstring says a null elevation marks a NoData pixel outside coverage or in a data hole, where the renderer breaks the ground line rather than drawing across the gap.

.. CG-EXPLANATION-END id=interface:DemSamplePoint

``interface DemSampleLineResponse``
-----------------------------------

.. CG-BLOCK id=interface:DemSampleLineResponse lines=30-45

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/section.ts
   :language: typescript
   :lines: 30-45
   :lineno-match:

.. CG-EXPLANATION-START id=interface:DemSampleLineResponse

**What this does.** Describes the whole DEM line answer: which source it came from and the ordered list of samples.

**Why it is here.** Naming the source lets the ground line say which elevation model it used.

.. CG-EXPLANATION-END id=interface:DemSampleLineResponse

``interface CrossSectionResponse``
----------------------------------

.. CG-BLOCK id=interface:CrossSectionResponse lines=46-105

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/section.ts
   :language: typescript
   :lines: 46-105
   :lineno-match:

.. CG-EXPLANATION-START id=interface:CrossSectionResponse

**What this does.** Describes a cross-section row: its ids and name, the two endpoints and coordinate system, the projection buffer and vertical exaggeration, the excluded investigation lists, the depth window, the display order, the view-state preferences bag, the set of contacts allowed to render on it, the body-companion linkage fields, and its timestamps.

**Why it is here.** The docstrings carry two load-bearing rules. The set of seeded contact ids is the *explicit-content invariant* (owner directive 2026-05-17): only contacts in that set render on this section, and an empty set is a freshly-drawn section with no formation content. The view-state bag round-trips verbatim through the bundle so a user's per-section toggles survive across machines without a migration. The companion fields are optional (additive-only) and consumers treat their absence as null or false.

.. CG-EXPLANATION-END id=interface:CrossSectionResponse

``interface CrossSectionCreatePayload``
---------------------------------------

.. CG-BLOCK id=interface:CrossSectionCreatePayload lines=106-123

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/section.ts
   :language: typescript
   :lines: 106-123
   :lineno-match:

.. CG-EXPLANATION-START id=interface:CrossSectionCreatePayload

**What this does.** Describes the body for creating a section: a required name, the two endpoints and coordinate system, and optional description, buffer, exaggeration, exclusions, depth window and display order.

**Why it is here.** Only the geometry and name are required; the rest are optional with backend defaults (additive-only).

.. CG-EXPLANATION-END id=interface:CrossSectionCreatePayload

``interface BatchCreateSectionsPayload``
----------------------------------------

.. CG-BLOCK id=interface:BatchCreateSectionsPayload lines=124-128

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/section.ts
   :language: typescript
   :lines: 124-128
   :lineno-match:

.. CG-EXPLANATION-START id=interface:BatchCreateSectionsPayload

**What this does.** Describes the body for creating several sections at once — just a list of create payloads.

**Why it is here.** A batch shape so many sections can be made in one round-trip.

.. CG-EXPLANATION-END id=interface:BatchCreateSectionsPayload

``interface BatchCreateSectionsResult``
---------------------------------------

.. CG-BLOCK id=interface:BatchCreateSectionsResult lines=129-133

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/section.ts
   :language: typescript
   :lines: 129-133
   :lineno-match:

.. CG-EXPLANATION-START id=interface:BatchCreateSectionsResult

**What this does.** Describes the batch answer — the list of created sections.

**Why it is here.** Returns the created rows so the caller does not need a follow-up list call.

.. CG-EXPLANATION-END id=interface:BatchCreateSectionsResult

``interface CrossSectionUpdatePayload``
---------------------------------------

.. CG-BLOCK id=interface:CrossSectionUpdatePayload lines=134-161

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/section.ts
   :language: typescript
   :lines: 134-161
   :lineno-match:

.. CG-EXPLANATION-START id=interface:CrossSectionUpdatePayload

**What this does.** Describes the body for editing a section: every field optional, including a partial view-state patch.

**Why it is here.** The comment explains the view-state field is shallow-merged: a partial dict patches single keys, null for a key removes it, an empty object clears the bag, and null for the whole field is the do-not-touch sentinel.

.. CG-EXPLANATION-END id=interface:CrossSectionUpdatePayload

``const demClient``
-------------------

.. CG-BLOCK id=const:demClient lines=162-187

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/section.ts
   :language: typescript
   :lines: 162-187
   :lineno-match:

.. CG-EXPLANATION-START id=const:demClient

**What this does.** The object with the single DEM call: sample the ground elevation along a line between two points, defaulting to 200 samples.

**Why it is here.** One read over the shared ``request`` helper introduced on the ``desktop.renderer.src.api.clients.shared`` page, wired under ``api.dem``.

.. CG-EXPLANATION-END id=const:demClient

``const sectionClient``
-----------------------

.. CG-BLOCK id=const:sectionClient lines=188-280

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/section.ts
   :language: typescript
   :lines: 188-280
   :lineno-match:

.. CG-EXPLANATION-START id=const:sectionClient

**What this does.** The object of typed calls for a project's sections: list, fetch, create (one or a batch), edit, delete, and four export downloads — DXF, Plaxis 2D, D-Stability and D-Sheet Piling.

**Why it is here.** The read/write calls use the shared ``request`` helper introduced on the ``desktop.renderer.src.api.clients.shared`` page; the exports use its binary-bytes helpers because they return files. The comments record why the two Deltares exports are POSTs while the others are GETs: their geometry is the section's closed polygons, and the drawn partition is computed in the renderer, so it must travel in the request body — sending the same partition shape the 3-D voxel build uses so the exported and the built model describe the same ground. Each refuses with a readable ``detail.message`` (surfaced to the toast) when nothing is drawn to export.

.. CG-EXPLANATION-END id=const:sectionClient

