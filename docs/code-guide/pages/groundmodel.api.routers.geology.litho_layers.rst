groundmodel.api.routers.geology.litho_layers
============================================

.. CG-PAGE source=src/groundmodel/api/routers/geology/litho_layers.py complete=true

*Source file:* ``src/groundmodel/api/routers/geology/litho_layers.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-70

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/litho_layers.py
   :language: python
   :lines: 1-70
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A docstring naming the file (the litho-layer router) and its final web path, then the imports: the router tools, the scope guard and a shared write-conflict mapper, the litho-layer request/response schemas, the application use cases (list, bulk create, boundary move, batch status, batch update, link-to-geo, delete, update), the model and layer database rows, the cross-section repository, and the overlap exception. It makes a bare router.

**Why it is here.** Same split-package pattern (mounted under the shared geology prefix). A *litho layer* is one soil interval in one investigation within a lithostratigraphic model — the unit rows the litho stage produces and the engineer accepts. The project id in the path is the cross-project scope guard used by every handler here.

.. CG-EXPLANATION-END id=module-header

Function ``async def list_layers``
----------------------------------

.. CG-BLOCK id=function:list_layers lines=71-144

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/litho_layers.py
   :language: python
   :lines: 71-144
   :lineno-match:

.. CG-EXPLANATION-START id=function:list_layers

**What this does.** The handler for ``GET .../layers`` — list the layer rows in a model, sorted shallowest-first, optionally filtered by anchor (borehole or CPT), formation, or status (pending / accepted / rejected). It scope-guards the model and returns the matching rows, empty for a non-litho model.

**Why it is here.** Scope-guarded like every by-model endpoint. The status filter matters because a layer starts as a suggestion (pending) and becomes real only when accepted; the table only holds litho rows, so a geological model returns nothing.

.. CG-EXPLANATION-END id=function:list_layers

Function ``async def bulk_create_layers``
-----------------------------------------

.. CG-BLOCK id=function:bulk_create_layers lines=145-255

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/litho_layers.py
   :language: python
   :lines: 145-255
   :lineno-match:

.. CG-EXPLANATION-START id=function:bulk_create_layers

**What this does.** The handler for ``POST .../layers`` — insert several layer rows in one transaction. It scope-guards the model, builds the create payloads, runs the bulk-create use case, and returns the new rows. It maps an unknown/foreign formation to ``404``, a depth overlap to ``409``, and any other constraint to ``422``. When a section was named, it adds the new ids to that section's seeded set.

**Why it is here.** Used by the segmenter's suggest flow (segmenter output becomes pending layers) and by the manual create path. The seeding enforces the explicit-content invariant carried over from the contact endpoint: only seeded ids pass a section's filter, so the engineer actually sees what was just drawn — and this works whether the section reads layers or contacts because an accepted layer keeps the same id as its contact mirror. A foreign formation is reported as "not found" without saying which, so a caller cannot probe another project. The overlap constraint fires at commit, so the session is rolled back before the seeding call.

.. CG-EXPLANATION-END id=function:bulk_create_layers

Function ``async def move_boundary``
------------------------------------

.. CG-BLOCK id=function:move_boundary lines=256-316

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/litho_layers.py
   :language: python
   :lines: 256-316
   :lineno-match:

.. CG-EXPLANATION-START id=function:move_boundary

**What this does.** The handler for ``PATCH .../layers/boundary-move`` — move the single depth shared by two stacked layers, updating both rows atomically. It scope-guards the model, runs the move use case, and returns both updated rows; an invalid move is ``422``.

**Why it is here.** The base of the upper layer and the top of the lower layer are the same boundary, so dragging it must change both rows together or the column would develop a gap or overlap; doing it in one operation keeps the column contiguous.

.. CG-EXPLANATION-END id=function:move_boundary

Function ``async def batch_update_status``
------------------------------------------

.. CG-BLOCK id=function:batch_update_status lines=317-397

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/litho_layers.py
   :language: python
   :lines: 317-397
   :lineno-match:

.. CG-EXPLANATION-START id=function:batch_update_status

**What this does.** The handler for ``POST .../layers/batch-status`` — set the same status on many layers at once (accept-all or reject-all). It scope-guards, applies the status to every named layer through the shared batch-update use case, and returns the count and rows. It maps an overlap to ``409`` and an invalid batch to ``422``.

**Why it is here.** It is a thin alias over the generic batch update because a batch status change is just a batch update whose every patch is the same status field — the two used to be duplicate use cases and were merged. Accept-all promotes rows to accepted, which is exactly what the no-overlap rule guards, so an overlap surfaces as a clear ``409`` at commit rather than a raw error.

.. CG-EXPLANATION-END id=function:batch_update_status

Function ``async def batch_update_layers``
------------------------------------------

.. CG-BLOCK id=function:batch_update_layers lines=398-480

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/litho_layers.py
   :language: python
   :lines: 398-480
   :lineno-match:

.. CG-EXPLANATION-START id=function:batch_update_layers

**What this does.** The handler for ``PATCH .../layers/batch-update`` — apply per-layer partial patches to many layers in one all-or-nothing transaction. It scope-guards, converts each item to a layer id plus its sent fields, runs the batch, and returns the count and rows; overlap is ``409``, an invalid batch ``422``.

**Why it is here.** It mirrors the contacts batch endpoint so the desktop's multi-drag and cross-column move keep their all-or-nothing guarantee: either every patch applies or none does, so a partial failure cannot strand half a gesture. A batch can move depths or accept rows, both guarded by the no-overlap rule at commit.

.. CG-EXPLANATION-END id=function:batch_update_layers

Function ``async def link_layer_to_geo``
----------------------------------------

.. CG-BLOCK id=function:link_layer_to_geo lines=481-551

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/litho_layers.py
   :language: python
   :lines: 481-551
   :lineno-match:

.. CG-EXPLANATION-START id=function:link_layer_to_geo

**What this does.** The handler for ``POST .../layers/{layer_id}/link-geo`` — link one litho layer to the nearest geological contact. It scope-guards the model and layer, runs the link use case, refreshes the row, and returns it — or ``200`` with an empty body when no geological contact is within tolerance.

**Why it is here.** It mirrors the contact-side link endpoint; because an accepted layer and its contact mirror share the same id, the one use case works through either entry point. Returning an empty body rather than an error when nothing is close enough lets the desktop treat "no link made" as a normal outcome.

.. CG-EXPLANATION-END id=function:link_layer_to_geo

Function ``async def delete_layer``
-----------------------------------

.. CG-BLOCK id=function:delete_layer lines=552-604

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/litho_layers.py
   :language: python
   :lines: 552-604
   :lineno-match:

.. CG-EXPLANATION-START id=function:delete_layer

**What this does.** The handler for ``DELETE .../layers/{layer_id}`` — delete one layer and reconcile the model. It scope-guards the model and runs the delete use case, answering ``204 No Content`` whether or not the row existed.

**Why it is here.** It is idempotent (a missing row is still ``204``) so a repeated delete is safe. Deleting an accepted layer removes its contact mirror through a database trigger and cascades any correlation edges, and the use case re-runs the resolver and lens detector afterwards so the model stays consistent.

.. CG-EXPLANATION-END id=function:delete_layer

Function ``async def update_layer``
-----------------------------------

.. CG-BLOCK id=function:update_layer lines=605-679

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/litho_layers.py
   :language: python
   :lines: 605-679
   :lineno-match:

.. CG-EXPLANATION-START id=function:update_layer

**What this does.** The handler for ``PATCH .../layers/{layer_id}`` — partially update one layer (only the sent fields). It scope-guards the model, applies the patch, and returns the row; a depth edit that would overlap an accepted sibling is ``409`` and a missing layer is ``404``.

**Why it is here.** It mirrors the contact update: only fields present are written, and an anchor change must keep the exactly-one-anchor rule (enforced at the request schema). The overlap check fires at commit and is turned into a clear ``409`` naming the layer rather than a raw server error, because the edit would push this layer inside an accepted neighbour on the same column.

.. CG-EXPLANATION-END id=function:update_layer

