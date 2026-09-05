desktop.renderer.src.api.clients.geology
========================================

.. CG-PAGE source=desktop/src/renderer/src/api/clients/geology.ts complete=true

*Source file:* ``desktop/src/renderer/src/api/clients/geology.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-123

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/geology.ts
   :language: typescript
   :lines: 1-123
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The opening comment and imports for the geology client — the largest subject client, holding the typed calls for every geological-model, formation-contact, litho-layer, body, correlation-edge and geotechnical-unit endpoint, plus the 3-D exports. It pulls in all the shared HTTP helpers, folds in the packing-band edit calls from the geotechBands client, brings in the logger, and imports the whole catalogue of geology data shapes from a companion types file (re-exporting them so callers keep one import path).

**Why it is here.** The comment lists the endpoint families this file owns and notes that the section shape is imported because several answers embed an ``updated_section`` field. Splitting the many data shapes into a separate types file and the packing-band calls into their own module keeps this already-oversized file (debt #201) from growing further. Every call goes through the shared ``request`` helper introduced on the ``desktop.renderer.src.api.clients.shared`` page.

.. CG-EXPLANATION-END id=module-header

``function divideBoreholesBody``
--------------------------------

.. CG-BLOCK id=function:divideBoreholesBody lines=124-152

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/geology.ts
   :language: typescript
   :lines: 124-152
   :lineno-match:

.. CG-EXPLANATION-START id=function:divideBoreholesBody

**What this does.** A small helper that assembles the JSON body for the divide-boreholes call and its preview. It adds each option only when the caller actually supplied it: the borehole subset, the ignore-pending-ties flag, the skip-already-divided flag, the 2-D section geometry, and the section to scope to.

**Why it is here.** The docstrings and comments record the reason each field is omitted rather than sent empty: the backend reads an absent ``borehole_ids`` as "every borehole" but an empty list as "none", so sending an empty list to mean "all" would trigger the maximal irreversible rebuild the distinction exists to prevent; likewise an absent section id means the whole-model run, and an absent section geometry means fall back to the donor rule. First subdivision wins — an already-divided borehole is skipped.

.. CG-EXPLANATION-END id=function:divideBoreholesBody

``const geologyClient``
-----------------------

.. CG-BLOCK id=const:geologyClient lines=153-1289

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/geology.ts
   :language: typescript
   :lines: 153-1289
   :lineno-match:

.. CG-EXPLANATION-START id=const:geologyClient

**What this does.** The object of typed calls for the whole geology domain, wired under ``api.geology``. Its methods group into: the 3-D exports (Plaxis 3D script, fence DXF, model footprint); the formation vocabulary (list, create, update, delete); geological models (list, create, update, activate, delete); formation contacts (list, create, update, delete, batch update); litho layers (list, update, delete, bulk create, move a boundary, batch update, link a layer to a geological unit); model-wide litho actions (seed from stratigraphy, discover candidates, clear the model, list and rebuild surfaces, dedupe contacts); the litho 3-D solids and the voxel build with its gapless report; body recompute and colour; suggest, accept and batch-accept litho suggestions; build the ground surface; contact-correlation edges (list, create, delete, propagate, auto-correlate, accept, confirm flagged edges); bodies (list, boundary get/save, name, delete, reset boundaries) with their separation and union constraints; formation absences; the perpendicular companion; and the geotech subdivision (subdivide bodies, clear a column, subdivide CPTs, tie status, staleness, divide boreholes with preview, auto-correlate, delete auto edges) — with the packing-band hand edits folded in from the geotechBands client.

**Why it is here.** Most calls go through the shared ``request`` helper introduced on the ``desktop.renderer.src.api.clients.shared`` page. A handful — update/delete a layer, link a layer, create/update a contact, clear the model, delete a correlation, delete auto-correlations — deliberately use a bare ``fetch`` instead, because they carry or read a non-JSON shape or fold a 404 into a null of their own; these are the endpoints the shared layer's ``isApiStatus`` warns it cannot classify. A dedicated ``DuplicateContactError`` is raised where a contact would clash. The geotech subdivision produces NAD packing classes — characterisation outputs, not the design-ready parameters held to Phase 5. Several answers carry an ``updated_section`` so the caller can refresh the section that a geology edit changed, which feeds the explicit-content invariant on which contacts render. The file's size is acknowledged debt #201; the section comments are the map that keeps it navigable.

.. CG-EXPLANATION-END id=const:geologyClient

