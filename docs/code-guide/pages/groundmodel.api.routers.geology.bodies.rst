groundmodel.api.routers.geology.bodies
======================================

.. CG-PAGE source=src/groundmodel/api/routers/geology/bodies.py complete=true

*Source file:* ``src/groundmodel/api/routers/geology/bodies.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-103

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/bodies.py
   :language: python
   :lines: 1-103
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A docstring listing the body endpoints this file provides, then the imports: the router tools, the scope guard and a model-kind guard, the body/boundary/absence/recompute schemas, the many application use cases (name, delete, boundary get/save, clear boundaries, perpendicular companion, merge enclosed lenses, recompute bodies, geo labels, upsert absence), the database rows, the model-kind constants and exceptions, and the logger. It makes a module-level logger and a bare router.

**Why it is here.** Same split-package pattern (mounted under the shared geology prefix). A *body* is a connected mass of one soil unit across the model — the thing the engineer names, colours, groups, and eventually exports. This file is its metadata and shape surface, replacing the older lenses router.

.. CG-EXPLANATION-END id=module-header

Function ``def _to_list_item``
------------------------------

.. CG-BLOCK id=function:_to_list_item lines=104-123

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/bodies.py
   :language: python
   :lines: 104-123
   :lineno-match:

.. CG-EXPLANATION-START id=function:_to_list_item

**What this does.** A private helper that copies a body database row into its list-item schema, then sets by hand the derived geological label (the majority formation and the list of formations the body crosses).

**Why it is here.** The stored columns copy straight off the row, but the geo label is derived (it is not a stored column), so it is injected separately after the automatic copy. Keeping the crossed-formation list (debt #278) lets the units pane show which formations a body spans.

.. CG-EXPLANATION-END id=function:_to_list_item

Function ``async def list_bodies``
----------------------------------

.. CG-BLOCK id=function:list_bodies lines=124-179

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/bodies.py
   :language: python
   :lines: 124-179
   :lineno-match:

.. CG-EXPLANATION-START id=function:list_bodies

**What this does.** The handler for ``GET .../bodies`` — list every body in the model, oldest first, each with its derived geo label. It scope-guards the model, queries the body rows for this project and model, fetches their geo labels in one call, and returns the list items.

**Why it is here.** Scope-guarded like every by-model endpoint. The geo labels are fetched in a single batched call rather than per body, and the bodies are ordered by creation time for a stable list.

.. CG-EXPLANATION-END id=function:list_bodies

Function ``async def merge_enclosed_lenses``
--------------------------------------------

.. CG-BLOCK id=function:merge_enclosed_lenses lines=180-246

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/bodies.py
   :language: python
   :lines: 180-246
   :lineno-match:

.. CG-EXPLANATION-START id=function:merge_enclosed_lenses

**What this does.** The handler for ``POST .../bodies/merge-enclosed-lenses`` — join the two host halves that a local lens split into one body. It scope-guards the model, requires it to be lithostratigraphic, runs the merge use case for the active section, and returns counts of correlation edges created and skipped.

**Why it is here.** A lens of a different soil that pinches out is a real interruption, so the bracketing host halves are correlated across it to become one body while the lens keeps its own; a same-soil enclosed lens instead merges into its surrounding body (owner ruling 2026-07-13). It is section-scoped because column adjacency is defined per cross-section, and idempotent because re-running only adds new edges. A non-litho model is refused ``422``.

.. CG-EXPLANATION-END id=function:merge_enclosed_lenses

Function ``async def recompute_bodies``
---------------------------------------

.. CG-BLOCK id=function:recompute_bodies lines=247-343

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/bodies.py
   :language: python
   :lines: 247-343
   :lineno-match:

.. CG-EXPLANATION-START id=function:recompute_bodies

**What this does.** The handler for ``POST .../bodies/recompute`` — persist the geometric grouping the desktop rendered and re-stamp which body each layer belongs to. It scope-guards the model, requires a body-carrying kind (litho or geotech), unions the posted regions with the cross-section rule, replaces the model's geometry facts, and re-runs the resolver, returning the difference. An empty payload is refused ``422``.

**Why it is here.** The rule (owner 2026-08-12) is that every set of same-soil units whose fill regions touch shares one body id; the desktop is the only place that computes the rendered fill, so it posts what it drew and the server makes it durable. An empty payload would wipe every geometric merge, so it is refused rather than applied — a broken input must never destroy good grouping.

.. CG-EXPLANATION-END id=function:recompute_bodies

Function ``async def update_body``
----------------------------------

.. CG-BLOCK id=function:update_body lines=344-419

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/bodies.py
   :language: python
   :lines: 344-419
   :lineno-match:

.. CG-EXPLANATION-START id=function:update_body

**What this does.** The handler for ``PATCH .../bodies/{body_id}`` — rename a body. It loads and scope-checks the body row, derives the body's formation and ordinal from it, and delegates to the name use case, returning the id and a created flag.

**Why it is here.** The name use case is keyed by formation and ordinal, so the endpoint reads those off the existing row rather than trusting the request to supply them (the schema's copies of them are ignored here). A body must already exist to be addressed by id, so the created flag is always false here. A validation failure in naming is ``422``.

.. CG-EXPLANATION-END id=function:update_body

Function ``async def delete_body_endpoint``
-------------------------------------------

.. CG-BLOCK id=function:delete_body_endpoint lines=420-484

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/bodies.py
   :language: python
   :lines: 420-484
   :lineno-match:

.. CG-EXPLANATION-START id=function:delete_body_endpoint

**What this does.** The handler for ``DELETE .../bodies/{body_id}`` — hard-delete a body's metadata row. It scope-guards the model, scope-checks the body row, and runs the delete use case, answering ``204 No Content``.

**Why it is here.** Absence rows and synthetic contacts are deliberately kept because they belong to the body's formation, not to the label row being deleted. The body row is scope-checked directly here so a foreign or missing id yields a clean ``404`` rather than the use case's silent no-op.

.. CG-EXPLANATION-END id=function:delete_body_endpoint

Function ``def _boundary_response``
-----------------------------------

.. CG-BLOCK id=function:_boundary_response lines=485-501

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/bodies.py
   :language: python
   :lines: 485-501
   :lineno-match:

.. CG-EXPLANATION-START id=function:_boundary_response

**What this does.** A private helper that maps the internal boundary state into the API boundary-response schema, copying the render style, the primary section, and the upper and lower node lists.

**Why it is here.** It keeps the internal domain shape separate from the API-boundary shape, so one can change without breaking the other.

.. CG-EXPLANATION-END id=function:_boundary_response

Function ``async def get_body_boundary``
----------------------------------------

.. CG-BLOCK id=function:get_body_boundary lines=502-548

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/bodies.py
   :language: python
   :lines: 502-548
   :lineno-match:

.. CG-EXPLANATION-START id=function:get_body_boundary

**What this does.** The handler for ``GET .../bodies/{body_id}/boundary`` — return the engineer's hand-drawn boundary shape for a body, or empty node lists and a straight style when none is stored. It runs the get use case and maps a missing body to ``404``.

**Why it is here.** A body with no custom shape falls back to the engine's straight boundary, so the desktop always gets a usable answer. The scope check lives inside the use case and surfaces as a ``404`` here.

.. CG-EXPLANATION-END id=function:get_body_boundary

Function ``async def put_body_boundary``
----------------------------------------

.. CG-BLOCK id=function:put_body_boundary lines=549-617

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/bodies.py
   :language: python
   :lines: 549-617
   :lineno-match:

.. CG-EXPLANATION-START id=function:put_body_boundary

**What this does.** The handler for ``PUT .../bodies/{body_id}/boundary`` — fully replace a body's boundary shape and nodes. It converts the request nodes, runs the save use case (which sorts and re-indexes them), and returns the saved state; a missing body is ``404`` and a body with no primary section is ``422``.

**Why it is here.** A *PUT* replaces the whole resource rather than patching part of it, which fits a boundary redraw. The server sorts and re-indexes the nodes so the stored shape is canonical regardless of the order the desktop sent them. A boundary needs a section to live on, so a body with none is refused ``422``.

.. CG-EXPLANATION-END id=function:put_body_boundary

Function ``async def clear_body_boundaries``
--------------------------------------------

.. CG-BLOCK id=function:clear_body_boundaries lines=618-676

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/bodies.py
   :language: python
   :lines: 618-676
   :lineno-match:

.. CG-EXPLANATION-START id=function:clear_body_boundaries

**What this does.** The handler for ``DELETE .../boundaries`` — reset every hand-drawn boundary shape in the model back to the engine default. It scope-guards the model, requires it to be lithostratigraphic, runs the clear use case, and returns the count deleted.

**Why it is here.** This is the "Reset manual points" bulk action: leftover hand-drawn overrides can bend boundaries off the engine default and open visible gap wedges, so clearing them restores the validated fill. It is idempotent — a model with no stored shapes clears zero. A non-litho model is refused ``422``.

.. CG-EXPLANATION-END id=function:clear_body_boundaries

Function ``async def create_perpendicular_companion``
-----------------------------------------------------

.. CG-BLOCK id=function:create_perpendicular_companion lines=677-758

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/bodies.py
   :language: python
   :lines: 677-758
   :lineno-match:

.. CG-EXPLANATION-START id=function:create_perpendicular_companion

**What this does.** The handler for ``POST .../bodies/{body_id}/perpendicular-companion`` — auto-create a cross-section running perpendicular to a body's primary section, centred on its contact centroid. It scope-guards the model and body, runs the use case, and returns the section, ``201`` for a new one and ``200`` when one already exists.

**Why it is here.** A companion section lets the engineer view a body from the perpendicular direction. It is idempotent, returning the existing companion rather than making a duplicate. A body with no primary section, or a deleted one, is refused ``422``.

.. CG-EXPLANATION-END id=function:create_perpendicular_companion

Function ``async def list_formation_absences``
----------------------------------------------

.. CG-BLOCK id=function:list_formation_absences lines=759-821

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/bodies.py
   :language: python
   :lines: 759-821
   :lineno-match:

.. CG-EXPLANATION-START id=function:list_formation_absences

**What this does.** The handler for ``GET .../formations/{formation_id}/absences`` — list the recorded absences of a formation (the investigations where it is missing) and their source. It scope-checks the formation and returns the rows in a deterministic order.

**Why it is here.** The inspect-body panel shows which investigations lack this formation and whether that absence was inferred, entered manually, or observed. The formation is scope-checked directly here so a foreign id gives a clean ``404``. This endpoint lives under the geology prefix for historical reasons even though it is formation-scoped.

.. CG-EXPLANATION-END id=function:list_formation_absences

Function ``async def upsert_formation_absence``
-----------------------------------------------

.. CG-BLOCK id=function:upsert_formation_absence lines=822-892

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/bodies.py
   :language: python
   :lines: 822-892
   :lineno-match:

.. CG-EXPLANATION-START id=function:upsert_formation_absence

**What this does.** The handler for ``POST .../formations/{formation_id}/absences`` — create or promote an absence record for an investigation. It runs the upsert use case and returns the id and a created flag; an invalid source or a missing formation/investigation is ``422``.

**Why it is here.** It supports two gestures from the inspect-body panel: confirming an inferred absence promotes it to manual so the inference engine will not overwrite it, and a manual absence adds one the engine did not infer. The inferred source is reserved for the engine, so a request claiming it is refused.

.. CG-EXPLANATION-END id=function:upsert_formation_absence

