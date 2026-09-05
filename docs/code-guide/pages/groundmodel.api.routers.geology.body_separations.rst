groundmodel.api.routers.geology.body_separations
================================================

.. CG-PAGE source=src/groundmodel/api/routers/geology/body_separations.py complete=true

*Source file:* ``src/groundmodel/api/routers/geology/body_separations.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-61

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/body_separations.py
   :language: python
   :lines: 1-61
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A docstring listing the three web addresses this file adds and the rule behind them, then the imports: the router tools, the scope guard, the separation request/response schemas, the body-partition lock, the resolver use case, the database rows, the repository, an ordered-id generator, and the logger. It makes a bare router and a module-level logger.

**Why it is here.** This file implements the "Separate" verb (debt #278; owner ruling 2026-08-31): the engineer states two masses are NOT the same body and the resolver honours it permanently, as a cannot-link constraint in layer-id space. Both write endpoints re-run the body resolver in the SAME request under the model's partition lock so the split (or re-join) is durable even if the desktop dies right after the call, and the reversible-action rule (fire, provide an undo) is met by the delete endpoint acting as the Rejoin. A *body* is a connected mass of one soil unit; the *resolver* recomputes which layers belong to which body.

.. CG-EXPLANATION-END id=module-header

Function ``def _canonical_pair``
--------------------------------

.. CG-BLOCK id=function:_canonical_pair lines=62-72

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/body_separations.py
   :language: python
   :lines: 62-72
   :lineno-match:

.. CG-EXPLANATION-START id=function:_canonical_pair

**What this does.** A private helper that orders a pair of layer ids so the smaller comes first.

**Why it is here.** The database stores each separation with its pair in a fixed order (a CHECK plus a uniqueness rule), and Python orders identifiers by the same 128-bit value the database sorts by, so ordering the pair here produces exactly the arrangement the database will accept — which is also what makes a duplicate separation detectable.

.. CG-EXPLANATION-END id=function:_canonical_pair

Function ``async def create_body_separation``
---------------------------------------------

.. CG-BLOCK id=function:create_body_separation lines=73-212

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/body_separations.py
   :language: python
   :lines: 73-212
   :lineno-match:

.. CG-EXPLANATION-START id=function:create_body_separation

**What this does.** The handler for ``POST .../body-separations`` — record that two bodies must never merge, then re-resolve. It scope-guards the model, checks both anchors are accepted layers of the model (else ``422``), takes the partition lock, inserts the separation if new, and re-runs the resolver. It answers ``201`` for a new separation and ``200`` when it already existed.

**Why it is here.** Because Separate is a reversible action, a duplicate is not an error: it returns the existing row with ``200`` rather than a ``409`` conflict. The lock is taken after validation so two concurrent creates of the same pair are serialised instead of both inserting and tripping the uniqueness rule. Re-running the resolver in the same transaction makes the split durable, and the response carries the re-resolve difference for the on-screen toast.

.. CG-EXPLANATION-END id=function:create_body_separation

Function ``async def list_body_separations``
--------------------------------------------

.. CG-BLOCK id=function:list_body_separations lines=213-316

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/body_separations.py
   :language: python
   :lines: 213-316
   :lineno-match:

.. CG-EXPLANATION-START id=function:list_body_separations

**What this does.** The handler for ``GET .../body-separations`` — return the model's separations, each carrying both anchors' current body (name, ordinal, formation). It scope-guards the model, loads the separations, then resolves each anchor layer's live body in batched queries.

**Why it is here.** The desktop renders "Rejoin with <label>" from this server-resolved display info, so the desktop never has to own a layer-to-body resolution map of its own. The bodies are looked up in batched queries keyed off the anchors' current body ids.

.. CG-EXPLANATION-END id=function:list_body_separations

Function ``async def delete_body_separation``
---------------------------------------------

.. CG-BLOCK id=function:delete_body_separation lines=317-388

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/body_separations.py
   :language: python
   :lines: 317-388
   :lineno-match:

.. CG-EXPLANATION-START id=function:delete_body_separation

**What this does.** The handler for ``DELETE .../body-separations/{sep_id}`` — the Rejoin: remove one separation and re-run the resolver so the two anchors can merge again if the ties still connect them. It scope-guards the model, takes the lock, deletes the row (``404`` if absent), re-resolves, and returns the difference.

**Why it is here.** Lifting the cannot-link constraint is the undo path the reversible-action rule requires. Running the delete and re-resolve together under the partition lock makes the re-join durable in one transaction, and the response carries the difference for the toast.

.. CG-EXPLANATION-END id=function:delete_body_separation

