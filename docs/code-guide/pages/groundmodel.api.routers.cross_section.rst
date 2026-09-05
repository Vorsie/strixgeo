groundmodel.api.routers.cross_section
=====================================

.. CG-PAGE source=src/groundmodel/api/routers/cross_section.py complete=true

*Source file:* ``src/groundmodel/api/routers/cross_section.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-72

.. literalinclude:: ../../../src/groundmodel/api/routers/cross_section.py
   :language: python
   :lines: 1-72
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A short docstring, then imports of the FastAPI building blocks, the shared route helpers (view-state merge, download response, scope guard, parse-error-to-404), the section create/batch/update/response and geometry-export schemas, the application use cases (batch create, build polygons, build snapshot, thin export units), the coordinate-system helpers, the section row and repository, the four exporters, and the session and logger. It makes the module logger and the ``/projects/{project_id}/sections`` router.

**Why it is here.** This is the router for cross-sections, the surface on which the engineer edits and views all three model levels. Every route is project-scoped by the URL prefix, so the project id is the scope guard and every section returned belongs to that project. The four exporters are imported here because a section is the unit that gets exported to the design tools.

.. CG-EXPLANATION-END id=module-header

Function ``def _require_supported_section_crs``
-----------------------------------------------

.. CG-BLOCK id=function:_require_supported_section_crs lines=73-112

.. literalinclude:: ../../../src/groundmodel/api/routers/cross_section.py
   :language: python
   :lines: 73-112
   :lineno-match:

.. CG-EXPLANATION-START id=function:_require_supported_section_crs

**What this does.** A guard that rejects a section whose coordinate system is not a projected metric one, answering ``400`` with a clear message.

**Why it is here.** A section's along-distance is a straight-line distance in the section's coordinate units, which is only physically correct in metres; a degrees-based system would silently produce geometry at the wrong scale in every export, so the endpoint fails loudly at the boundary instead (debt #31).

.. CG-EXPLANATION-END id=function:_require_supported_section_crs

Function ``async def _build_export_snapshot``
---------------------------------------------

.. CG-BLOCK id=function:_build_export_snapshot lines=113-167

.. literalinclude:: ../../../src/groundmodel/api/routers/cross_section.py
   :language: python
   :lines: 113-167
   :lineno-match:

.. CG-EXPLANATION-START id=function:_build_export_snapshot

**What this does.** A shared helper that loads a section snapshot for export: it builds the snapshot, maps a resolution failure to ``404``, checks the coordinate system, and optionally runs the same-class thinning pass.

**Why it is here.** It combines the three steps every section-export handler repeated. Thinning defaults off so a new caller gets the exact snapshot; the docstring records that the CAD and PDF exports opt in per the owner's ruling, while the Plaxis export must never thin because its single global soil-layer stack cannot express an interleaved merge (debt #104b).

.. CG-EXPLANATION-END id=function:_build_export_snapshot

Function ``async def create_section``
-------------------------------------

.. CG-BLOCK id=function:create_section lines=168-228

.. literalinclude:: ../../../src/groundmodel/api/routers/cross_section.py
   :language: python
   :lines: 168-228
   :lineno-match:

.. CG-EXPLANATION-START id=function:create_section

**What this does.** The handler for ``POST /projects/{project_id}/sections`` — create one cross-section from its endpoints, coordinate system, buffer, exaggeration, exclusions, depth clamps, order, and view state, answering ``201 Created``.

**Why it is here.** It rejects a non-metric coordinate system up front (the guard above). The section is the project-scoped edit surface; creating it under the project in the URL is the scope model.

.. CG-EXPLANATION-END id=function:create_section

Function ``async def batch_create_sections``
--------------------------------------------

.. CG-BLOCK id=function:batch_create_sections lines=229-281

.. literalinclude:: ../../../src/groundmodel/api/routers/cross_section.py
   :language: python
   :lines: 229-281
   :lineno-match:

.. CG-EXPLANATION-START id=function:batch_create_sections

**What this does.** The handler for ``POST /projects/{project_id}/sections/batch`` — create several cross-sections in one transaction, validating each (coordinate system and distinct endpoints) before any row is written; an empty list is a valid no-op.

**Why it is here.** It mirrors the single-create per section but commits once, matching the batch-accept pattern used elsewhere, and backs the Accept-all tie-sections action so many sections land atomically rather than one request at a time.

.. CG-EXPLANATION-END id=function:batch_create_sections

Function ``async def list_sections``
------------------------------------

.. CG-BLOCK id=function:list_sections lines=282-306

.. literalinclude:: ../../../src/groundmodel/api/routers/cross_section.py
   :language: python
   :lines: 282-306
   :lineno-match:

.. CG-EXPLANATION-START id=function:list_sections

**What this does.** The handler for ``GET /projects/{project_id}/sections`` — list every section for the project, ordered by display order then name.

**Why it is here.** Only sections in the project in the URL are returned (the scope model). The order matches how the desktop lists them.

.. CG-EXPLANATION-END id=function:list_sections

Function ``async def get_section``
----------------------------------

.. CG-BLOCK id=function:get_section lines=307-341

.. literalinclude:: ../../../src/groundmodel/api/routers/cross_section.py
   :language: python
   :lines: 307-341
   :lineno-match:

.. CG-EXPLANATION-START id=function:get_section

**What this does.** The handler for ``GET /projects/{project_id}/sections/{section_id}`` — fetch one section, answering ``404`` when it is missing or belongs to another project, via the shared scope guard.

**Why it is here.** Same project-scope guard as every by-id endpoint (see the CPT page).

.. CG-EXPLANATION-END id=function:get_section

Function ``async def update_section``
-------------------------------------

.. CG-BLOCK id=function:update_section lines=342-422

.. literalinclude:: ../../../src/groundmodel/api/routers/cross_section.py
   :language: python
   :lines: 342-422
   :lineno-match:

.. CG-EXPLANATION-START id=function:update_section

**What this does.** The handler for ``PATCH /projects/{project_id}/sections/{section_id}`` — partial update: only fields present are written, the view-state bag follows shallow-merge rules, and the update is rejected ``400`` if it would collapse the two endpoints onto each other.

**Why it is here.** Reading only the sent fields keeps an unsent field untouched. The view-state merge is deferred to a single atomic statement after the main update, because a Python read-merge-write would be a lost-update race that drops a concurrent edit's key (see the shared ``apply_view_state_patch`` helper). The post-update distinct-endpoints check protects the invariant that a section line has non-zero length; the rare case where the row vanishes mid-update surfaces as a ``404``.

.. CG-EXPLANATION-END id=function:update_section

Function ``async def delete_section``
-------------------------------------

.. CG-BLOCK id=function:delete_section lines=423-458

.. literalinclude:: ../../../src/groundmodel/api/routers/cross_section.py
   :language: python
   :lines: 423-458
   :lineno-match:

.. CG-EXPLANATION-START id=function:delete_section

**What this does.** The handler for ``DELETE /projects/{project_id}/sections/{section_id}`` — delete a section after the scope guard, answering ``204 No Content``.

**Why it is here.** Anything drawn on the section will cascade via the database when the editor lands; today there is nothing to cascade. The scope guard gives the same foreign-id protection as elsewhere.

.. CG-EXPLANATION-END id=function:delete_section

Function ``async def export_section_dxf``
-----------------------------------------

.. CG-BLOCK id=function:export_section_dxf lines=459-526

.. literalinclude:: ../../../src/groundmodel/api/routers/cross_section.py
   :language: python
   :lines: 459-526
   :lineno-match:

.. CG-EXPLANATION-START id=function:export_section_dxf

**What this does.** The handler for ``GET .../export/dxf`` — export the section's drawn geological model as a DXF CAD file: one polyline per formation, a vertical line and label per projected investigation, and a title block. Same-class thinning is on by default.

**Why it is here.** Engineers import the DXF into their CAD and design tools as the geometric reference. Thinning is the default for the CAD deliverable per the owner's ruling, with an opt-out because the merge erases a parent boundary the engineer drew and some clients need those boundaries (debt #104b). A resolution failure maps to ``404``.

.. CG-EXPLANATION-END id=function:export_section_dxf

Function ``async def export_section_plaxis2d``
----------------------------------------------

.. CG-BLOCK id=function:export_section_plaxis2d lines=527-589

.. literalinclude:: ../../../src/groundmodel/api/routers/cross_section.py
   :language: python
   :lines: 527-589
   :lineno-match:

.. CG-EXPLANATION-START id=function:export_section_plaxis2d

**What this does.** The handler for ``GET .../export/plaxis2d`` — export the section's drawn geology as a runnable Plaxis 2D script that recreates the same geometry (one placeholder material per formation, a global layer stack, one borehole per projected column).

**Why it is here.** It is the section-scoped sibling of the project-wide Plaxis 3D export. It deliberately never thins: the script indexes one global soil-layer stack every borehole reuses, so an interleaved merged unit would have to occupy one global layer twice in a column, which cannot be expressed; the script's own mapping table names every unit separately instead (debt #104b, owner ruling to keep Plaxis exact).

.. CG-EXPLANATION-END id=function:export_section_plaxis2d

Function ``async def _build_export_polygons``
---------------------------------------------

.. CG-BLOCK id=function:_build_export_polygons lines=590-634

.. literalinclude:: ../../../src/groundmodel/api/routers/cross_section.py
   :language: python
   :lines: 590-634
   :lineno-match:

.. CG-EXPLANATION-START id=function:_build_export_polygons

**What this does.** A shared helper for the closed-geometry exports: it loads the section snapshot (same guards and coordinate check) and resolves the partition the renderer POSTed, converting the drawn fill from gap-local fractions to absolute along-distances.

**Why it is here.** It is the closed-geometry counterpart of the snapshot helper. The fill is computed in the renderer and sent in the request body, so this is where that drawn partition is turned into real polygons for a geometry exporter (see docs/exports.md).

.. CG-EXPLANATION-END id=function:_build_export_polygons

Function ``def _refuse_empty_geometry``
---------------------------------------

.. CG-BLOCK id=function:_refuse_empty_geometry lines=635-664

.. literalinclude:: ../../../src/groundmodel/api/routers/cross_section.py
   :language: python
   :lines: 635-664
   :lineno-match:

.. CG-EXPLANATION-START id=function:_refuse_empty_geometry

**What this does.** A helper that turns an exporter's "nothing to write" refusal into a ``422`` the desktop can show verbatim, carrying a stable machine code.

**Why it is here.** Both D-Series geometry exporters raise when there is no closed geometry (or no ground at the sampled point). That is a ``422`` (the request was well-formed but the model is not ready), not a ``500``, and the engineer's next action is to draw the fill. An empty but correctly-named export file would be a plausible, completely wrong deliverable, so it is refused instead.

.. CG-EXPLANATION-END id=function:_refuse_empty_geometry

Function ``async def export_section_dstability``
------------------------------------------------

.. CG-BLOCK id=function:export_section_dstability lines=665-735

.. literalinclude:: ../../../src/groundmodel/api/routers/cross_section.py
   :language: python
   :lines: 665-735
   :lineno-match:

.. CG-EXPLANATION-START id=function:export_section_dstability

**What this does.** The handler for ``POST .../export/dstability`` — export the section's drawn filled polygons as a D-Stability ``.stix`` file: each drawn region becomes one layer, each unit one soil named by its export identifier.

**Why it is here.** It is a POST because the geometry IS the renderer's drawn fill, carried in the request body (the same partition the 3-D build uses). Crucially, no design parameter is written — strength, stiffness, unit weight, and the water line are left at the tool's defaults — because that is the product's deliberate liability boundary (docs/exports.md; the platform delivers characterisation, not design values). An empty section is refused ``422`` rather than shipping a wrong deliverable.

.. CG-EXPLANATION-END id=function:export_section_dstability

Function ``async def export_section_dsheetpiling``
--------------------------------------------------

.. CG-BLOCK id=function:export_section_dsheetpiling lines=736-809

.. literalinclude:: ../../../src/groundmodel/api/routers/cross_section.py
   :language: python
   :lines: 736-809
   :lineno-match:

.. CG-EXPLANATION-START id=function:export_section_dsheetpiling

**What this does.** The handler for ``POST .../export/dsheetpiling`` — sample the section's drawn fill at a position along the line (mid-section by default) and export that one column's layer stack as a D-Sheet Piling ``.shi`` file.

**Why it is here.** D-Sheet Piling models a wall against one soil profile per side, so the export takes a 1-D profile at the chosen fraction. As with D-Stability, no design parameter is invented: the wall, water levels, surcharges, and anchors are written as an explicit to-do in the file rather than as guessed values (docs/exports.md). The sample position is bounded here so an out-of-range value is a clean ``422`` from validation rather than an error from the exporter, and nothing drawn at the position is refused ``422``.

.. CG-EXPLANATION-END id=function:export_section_dsheetpiling

