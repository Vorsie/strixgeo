groundmodel.api.routers.investigation_review
============================================

.. CG-PAGE source=src/groundmodel/api/routers/investigation_review.py complete=true

*Source file:* ``src/groundmodel/api/routers/investigation_review.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-62

.. literalinclude:: ../../../src/groundmodel/api/routers/investigation_review.py
   :language: python
   :lines: 1-62
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A docstring describing the two surfaces the file serves, then imports of the router and error types, the shared view-state and scope-guard helpers, the review and view-state schemas, the CPT/borehole/project/review rows and repositories, the session, and the logger. It creates the ``/projects/{project_id}`` router.

**Why it is here.** One file serves two related surfaces: the per-investigation review decisions (kept, hidden, reviewed) and the project-level view-state bag. The docstring records that every route checks the resolved row belongs to the project in the URL, so a leaked id from one project cannot read or change another's data (the project-scope guard).

.. CG-EXPLANATION-END id=module-header

Function ``async def list_reviews``
-----------------------------------

.. CG-BLOCK id=function:list_reviews lines=63-90

.. literalinclude:: ../../../src/groundmodel/api/routers/investigation_review.py
   :language: python
   :lines: 63-90
   :lineno-match:

.. CG-EXPLANATION-START id=function:list_reviews

**What this does.** The handler for ``GET /reviews`` — return every review row for a project, oldest first.

**Why it is here.** Most callers use the per-target lookup instead; this list exists for the saved-project round-trip and the sidebar's "show all reviewed/hidden" filter.

.. CG-EXPLANATION-END id=function:list_reviews

Function ``async def get_review_for_target``
--------------------------------------------

.. CG-BLOCK id=function:get_review_for_target lines=91-138

.. literalinclude:: ../../../src/groundmodel/api/routers/investigation_review.py
   :language: python
   :lines: 91-138
   :lineno-match:

.. CG-EXPLANATION-START id=function:get_review_for_target

**What this does.** The handler for ``GET /reviews/{target_kind}/{target_id}`` — fetch the decision row for one investigation, answering ``404`` when none has been written yet.

**Why it is here.** The absence of a row is the default "unreviewed, not hidden" state, so the handler does not auto-create on read, keeping the read a pure read. The scope guard ensures the row belongs to the project in the URL.

.. CG-EXPLANATION-END id=function:get_review_for_target

Function ``async def upsert_review_for_target``
-----------------------------------------------

.. CG-BLOCK id=function:upsert_review_for_target lines=139-211

.. literalinclude:: ../../../src/groundmodel/api/routers/investigation_review.py
   :language: python
   :lines: 139-211
   :lineno-match:

.. CG-EXPLANATION-START id=function:upsert_review_for_target

**What this does.** The handler for ``PUT /reviews/{target_kind}/{target_id}`` — create or update the decision row for one investigation, after checking the target investigation actually exists in this project.

**Why it is here.** *Upsert* (update-or-insert) is the dominant write because the desktop does not track review-row ids. The target is validated first so a leaked id or a typo is rejected ``404`` rather than silently inserting a review pointing at nothing; a rejected patch surfaces as ``422``.

.. CG-EXPLANATION-END id=function:upsert_review_for_target

Function ``async def delete_review_for_target``
-----------------------------------------------

.. CG-BLOCK id=function:delete_review_for_target lines=212-269

.. literalinclude:: ../../../src/groundmodel/api/routers/investigation_review.py
   :language: python
   :lines: 212-269
   :lineno-match:

.. CG-EXPLANATION-START id=function:delete_review_for_target

**What this does.** The handler for ``DELETE /reviews/{target_kind}/{target_id}`` — drop the decision row, restoring the default unreviewed state, and always answer ``204``.

**Why it is here.** The docstring records the deliberate asymmetry with the upsert: delete only needs its post-condition ("no row for this target") to hold, so a missing row, or one in another project, still answers ``204`` — which also avoids leaking whether a review id exists in a sibling project.

.. CG-EXPLANATION-END id=function:delete_review_for_target

Function ``async def patch_project_view_state``
-----------------------------------------------

.. CG-BLOCK id=function:patch_project_view_state lines=270-324

.. literalinclude:: ../../../src/groundmodel/api/routers/investigation_review.py
   :language: python
   :lines: 270-324
   :lineno-match:

.. CG-EXPLANATION-START id=function:patch_project_view_state

**What this does.** The handler for ``PATCH /view-state`` — shallow-merge a patch into the project's view-state bag (each key overwrites its namesake, an empty value removes the key), then return the full project.

**Why it is here.** It is exposed as its own endpoint so callers can change a few keys without round-tripping the whole project. The merge is one statement via the shared helper, because a Python read-merge-write would let two overlapping patches drop a key — and the save flow keeps its save anchor in this same bag, so the lost key could be the anchor.

.. CG-EXPLANATION-END id=function:patch_project_view_state

Function ``async def _target_exists_in_project``
------------------------------------------------

.. CG-BLOCK id=function:_target_exists_in_project lines=325-345

.. literalinclude:: ../../../src/groundmodel/api/routers/investigation_review.py
   :language: python
   :lines: 325-345
   :lineno-match:

.. CG-EXPLANATION-START id=function:_target_exists_in_project

**What this does.** A helper that checks whether a given CPT or borehole id resolves to a row in the project, without loading the whole row.

**Why it is here.** There is deliberately no database foreign key from a review row to its target (the review table is polymorphic), so this targeted existence check stands in for one. The unknown-kind branch is defence in depth — the request schema already rejects other kinds.

.. CG-EXPLANATION-END id=function:_target_exists_in_project

