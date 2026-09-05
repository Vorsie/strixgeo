groundmodel.api.routers.geology.models
======================================

.. CG-PAGE source=src/groundmodel/api/routers/geology/models.py complete=true

*Source file:* ``src/groundmodel/api/routers/geology/models.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-42

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/models.py
   :language: python
   :lines: 1-42
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the file (geological-model create/read/update/delete plus activate) and imports the router tools, the shared scope guard, the model request/response schemas, the model database row, the repository, the parent-kind rule, and the logger. It makes a module-level logger and a bare, prefix-less router.

**Why it is here.** Same split-package pattern as the other geology sub-routers: no prefix here, mounted under the shared geology prefix by the package ``__init__`` (debt #40); one module-level logger because routers are functions, not classes.

.. CG-EXPLANATION-END id=module-header

Function ``async def create_model``
-----------------------------------

.. CG-BLOCK id=function:create_model lines=43-132

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/models.py
   :language: python
   :lines: 43-132
   :lineno-match:

.. CG-EXPLANATION-START id=function:create_model

**What this does.** The handler for ``POST .../models`` — create a new model under the project. Before creating, it enforces the three-level parent rule: a geological model must have no parent; a lithostratigraphic or geotechnical model must name a ``parent_model_id`` that points at an existing same-project model of the required parent kind. Any violation is refused with a ``422``. On success it creates the row, commits, and returns it as ``201 Created``.

**Why it is here.** This endpoint is where the "parent is not optional for litho/geotech" invariant is actually enforced, because the database column itself is left nullable (see the model-kind constants). The three modelling levels (geological → lithostratigraphic → geotechnical) each refine the one above, so a child with no valid parent, or the wrong parent kind, would be a broken model — caught here as a ``422`` ("understood but unacceptable") with a message naming the required parent kind.

.. CG-EXPLANATION-END id=function:create_model

Function ``async def list_models``
----------------------------------

.. CG-BLOCK id=function:list_models lines=133-156

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/models.py
   :language: python
   :lines: 133-156
   :lineno-match:

.. CG-EXPLANATION-START id=function:list_models

**What this does.** The handler for ``GET .../models`` — return every model in the project, the active one first. It asks the repository and returns the list.

**Why it is here.** Active-first ordering means the desktop can select the working model without a second sort. A read with no scope hazard beyond the project in the path, so it needs no by-id guard.

.. CG-EXPLANATION-END id=function:list_models

Function ``async def update_model``
-----------------------------------

.. CG-BLOCK id=function:update_model lines=157-204

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/models.py
   :language: python
   :lines: 157-204
   :lineno-match:

.. CG-EXPLANATION-START id=function:update_model

**What this does.** The handler for ``PATCH .../models/{model_id}`` — apply a partial update to a model. It runs the scope guard, applies only the fields the body actually set, commits, and returns the updated row; a ``404`` if the model is gone.

**Why it is here.** A *PATCH* changes only the fields present in the body (``exclude_unset``), leaving the rest untouched, so the desktop can edit one attribute without resending the whole model. The active flag is deliberately NOT settable here — it has its own activate endpoint — so activation stays a single, explicit action. The comment notes the second ``404`` guards the rare race where the row vanishes between the scope check and the write.

.. CG-EXPLANATION-END id=function:update_model

Function ``async def activate_model``
-------------------------------------

.. CG-BLOCK id=function:activate_model lines=205-243

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/models.py
   :language: python
   :lines: 205-243
   :lineno-match:

.. CG-EXPLANATION-START id=function:activate_model

**What this does.** The handler for ``POST .../models/{model_id}/activate`` — make this model the active one and clear the active flag on every sibling in the project. It runs the change through the repository, commits, and returns the now-active row, or ``404`` if the model is missing.

**Why it is here.** Exactly one model per project is active at a time, so activating one must clear the others in the same operation; giving activation its own endpoint keeps that all-or-nothing switch a single explicit action rather than a side effect of a general update.

.. CG-EXPLANATION-END id=function:activate_model

Function ``async def delete_model``
-----------------------------------

.. CG-BLOCK id=function:delete_model lines=244-298

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/models.py
   :language: python
   :lines: 244-298
   :lineno-match:

.. CG-EXPLANATION-START id=function:delete_model

**What this does.** The handler for ``DELETE .../models/{model_id}`` — remove a model and everything that depends on it (its formations and contacts, geotechnical units, and surfaces). It runs the scope guard, refuses with a ``409`` when another model refines this one, otherwise deletes, commits, and answers ``204 No Content``.

**Why it is here.** A litho model pins its geological parent and a geotech model pins its litho parent, so deleting a parent that still has a child would break the child; the ``409`` ("conflict") is pre-checked here so the engineer gets a clear "delete the dependent model first" message instead of a raw database constraint error at commit time.

.. CG-EXPLANATION-END id=function:delete_model

