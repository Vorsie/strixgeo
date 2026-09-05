groundmodel.api.routers.geology.surfaces
========================================

.. CG-PAGE source=src/groundmodel/api/routers/geology/surfaces.py complete=true

*Source file:* ``src/groundmodel/api/routers/geology/surfaces.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-60

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/surfaces.py
   :language: python
   :lines: 1-60
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the file (rebuild the model's surfaces, list them, validate gaps and crossings, and build the ground surface from the terrain model) and imports the router tools, the scope guard, the surface/validation/ground-surface schemas, the application use cases, the database rows, the terrain-model provider factory, and the logger. It makes a module-level logger and a bare router.

**Why it is here.** Same split-package pattern as the other geology sub-routers (debt #40). A *TIN* (triangulated irregular network) is a surface built from triangles between the picked points; it is the cached shape of a formation's top across the site.

.. CG-EXPLANATION-END id=module-header

Function ``def _to_gap_issues``
-------------------------------

.. CG-BLOCK id=function:_to_gap_issues lines=61-91

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/surfaces.py
   :language: python
   :lines: 61-91
   :lineno-match:

.. CG-EXPLANATION-START id=function:_to_gap_issues

**What this does.** A small private helper that copies a list of domain validation issues into their API response shape, carrying each issue's kind, detail, depth, and the contacts and formations involved.

**Why it is here.** The same seven-line conversion was needed by three handlers (gap validation, crossing validation, ground-surface build), so it was extracted to one place (per the project's don't-repeat rule). It keeps the internal domain issue separate from the API-boundary shape.

.. CG-EXPLANATION-END id=function:_to_gap_issues

Function ``async def rebuild_model_surfaces``
---------------------------------------------

.. CG-BLOCK id=function:rebuild_model_surfaces lines=92-165

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/surfaces.py
   :language: python
   :lines: 92-165
   :lineno-match:

.. CG-EXPLANATION-START id=function:rebuild_model_surfaces

**What this does.** The handler for ``POST .../models/{model_id}/surfaces/rebuild`` — recompute every formation's cached surface from the current picks. It runs the scope guard, runs the rebuild use case, and returns counts of formations considered, rebuilt, and reordered.

**Why it is here.** This is the primary "Build" action of the on-click-build design: editing a pick no longer recomputes surfaces automatically; it marks them stale and the section view shows the stale cache faded and dashed until this endpoint clears it. It is idempotent — a clean model rebuilds zero. The ``method`` query parameter is fixed to ``tin`` by a pattern (an unknown value is a ``422``); it scaffolds future interpolation methods for Phase 5 without a contract change.

.. CG-EXPLANATION-END id=function:rebuild_model_surfaces

Function ``async def list_model_surfaces``
------------------------------------------

.. CG-BLOCK id=function:list_model_surfaces lines=166-215

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/surfaces.py
   :language: python
   :lines: 166-215
   :lineno-match:

.. CG-EXPLANATION-START id=function:list_model_surfaces

**What this does.** The handler for ``GET .../models/{model_id}/surfaces`` — return every cached surface in the model. It runs the scope guard and returns the rows.

**Why it is here.** The section view fetches this once on load, indexes by formation, and slices each surface against the section line so a formation's top draws correctly even where the section runs off the picked points. Scope-guarded like the other by-model endpoints.

.. CG-EXPLANATION-END id=function:list_model_surfaces

Function ``async def validate_no_gaps``
---------------------------------------

.. CG-BLOCK id=function:validate_no_gaps lines=216-272

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/surfaces.py
   :language: python
   :lines: 216-272
   :lineno-match:

.. CG-EXPLANATION-START id=function:validate_no_gaps

**What this does.** The handler for ``GET .../models/{model_id}/boreholes/{borehole_id}/validate`` — check that one borehole's contacts form a clean, gap-free stratigraphy. It scope-guards both the model and the borehole, runs the validation, and returns the list of issues (empty means clean).

**Why it is here.** The editor calls this on save and shows the issues as inline warnings. Both the model and the borehole are scope-guarded against the project to block cross-project id enumeration (VULN-11).

.. CG-EXPLANATION-END id=function:validate_no_gaps

Function ``async def validate_no_crossings``
--------------------------------------------

.. CG-BLOCK id=function:validate_no_crossings lines=273-326

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/surfaces.py
   :language: python
   :lines: 273-326
   :lineno-match:

.. CG-EXPLANATION-START id=function:validate_no_crossings

**What this does.** The handler for ``GET .../models/{model_id}/validate/crossings`` — check that no two formation surfaces cross in a way that breaks stratigraphic order. It scope-guards the model, walks the cached surfaces looking for a younger formation dipping below an older one, and returns the crossing issues.

**Why it is here.** A younger formation sitting below an older one anywhere in their shared footprint violates the geological superposition rule; catching it lets the editor warn the engineer inline. Scope-guarded like the other by-model reads.

.. CG-EXPLANATION-END id=function:validate_no_crossings

Function ``async def build_ground_surface``
-------------------------------------------

.. CG-BLOCK id=function:build_ground_surface lines=327-462

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/surfaces.py
   :language: python
   :lines: 327-462
   :lineno-match:

.. CG-EXPLANATION-START id=function:build_ground_surface

**What this does.** The handler for ``POST .../models/{model_id}/ground-surface/build`` — sample the public terrain model over the model's investigations and return a ground-surface mesh. It scope-guards the model, picks the terrain provider from the project's coordinate system, samples the terrain, and returns the mesh with its provenance. It maps a bad extent to ``422`` and a terrain-service outage to ``503``.

**Why it is here.** The 3-D viewer uses this mesh as the scene floor instead of a flat globe. It picks the right national terrain model from the project's coordinate system (Belgium or the Netherlands) and is not persisted, because it is fully derivable from the cached terrain tiles and the investigation locations — so calling it again is idempotent and needs no file-format change (G7). An impossible extent is a data problem in this model, hence ``422`` with the numbers; an unreachable terrain service is ``503``, and the full upstream error is logged server-side while the client sees only a safe message.

.. CG-EXPLANATION-END id=function:build_ground_surface

