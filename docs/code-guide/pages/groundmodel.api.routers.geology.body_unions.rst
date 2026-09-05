groundmodel.api.routers.geology.body_unions
===========================================

.. CG-PAGE source=src/groundmodel/api/routers/geology/body_unions.py complete=true

*Source file:* ``src/groundmodel/api/routers/geology/body_unions.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-81

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/body_unions.py
   :language: python
   :lines: 1-81
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A long docstring stating the three web addresses this file adds and the rule behind the "Join with…" verb, then the imports: the router tools, the scope guard, the union request/response schemas, the partition lock, the resolver use case and its similarity predicate, the database rows, the repository, an ordered-id generator, and the logger. It makes a bare router and a module-level logger.

**Why it is here.** This file implements grouping (debt #278; owner 2026-09-02): a Join is a GROUP relation, not a merge — the two bodies keep their separate identities (identity is geometry-only) and the row simply records that they belong to one group so exports can pool them and the units pane can tag them "(group N)". A group can span two different bodies, so merging would lose provenance; only a label can join them. One guard is enforced at write time — never a mixed group: the two anchors must be the same soil and packing class, checked with the resolver's own similarity predicate so the write guard matches how the resolver judges similarity. The docstring also records that the older Separate/Rejoin verbs were removed (owner 2026-09-01), so a leftover separation row must never refuse a Join.

.. CG-EXPLANATION-END id=module-header

Function ``def _canonical_pair``
--------------------------------

.. CG-BLOCK id=function:_canonical_pair lines=82-92

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/body_unions.py
   :language: python
   :lines: 82-92
   :lineno-match:

.. CG-EXPLANATION-START id=function:_canonical_pair

**What this does.** A private helper that orders a pair of layer ids so the smaller comes first.

**Why it is here.** Same reasoning as the separations file: the database stores the pair in a fixed order (a CHECK plus a uniqueness rule), and Python orders ids by the same value the database sorts by, so ordering here produces the arrangement the database accepts and makes a duplicate detectable.

.. CG-EXPLANATION-END id=function:_canonical_pair

Function ``def _anchor_node``
-----------------------------

.. CG-BLOCK id=function:_anchor_node lines=93-127

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/body_unions.py
   :language: python
   :lines: 93-127
   :lineno-match:

.. CG-EXPLANATION-START id=function:_anchor_node

**What this does.** A private helper that builds the minimal node object the similarity check needs from an anchor row: it carries the anchor's soil code and, for a geotech model, its packing class.

**Why it is here.** It mirrors exactly how the resolver maps these fields, so the router's mixed-group guard and the resolver's own merge filter judge similarity identically. Only soil and packing are read by the check; the other fields are placeholders. A litho model carries no packing class, so similarity there falls to soil alone.

.. CG-EXPLANATION-END id=function:_anchor_node

Function ``async def create_body_union``
----------------------------------------

.. CG-BLOCK id=function:create_body_union lines=128-333

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/body_unions.py
   :language: python
   :lines: 128-333
   :lineno-match:

.. CG-EXPLANATION-START id=function:create_body_union

**What this does.** The handler for ``POST .../body-unions`` — record that two bodies form one group, then re-resolve. It scope-guards the model, checks both anchors are accepted layers (else ``422`` invalid anchor), checks the two are the same mass (else ``422`` cross-class), takes the lock, inserts the union if new, and re-runs the resolver. It answers ``201`` for a new group and ``200`` when it already existed.

**Why it is here.** The mixed-group guard refuses a group of dissimilar soils or classes with a ``422`` naming both soils and classes, because a group means "things that are similar". Because Join is reversible, a duplicate returns the existing row with ``200``, not a ``409``. The resolver is still run in the same transaction for durability and to return a live difference, but grouping changes no body identity, so it is a no-op for identity and leaves the cached 3-D solids valid (owner 2026-09-01).

.. CG-EXPLANATION-END id=function:create_body_union

Function ``async def list_body_unions``
---------------------------------------

.. CG-BLOCK id=function:list_body_unions lines=334-437

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/body_unions.py
   :language: python
   :lines: 334-437
   :lineno-match:

.. CG-EXPLANATION-START id=function:list_body_unions

**What this does.** The handler for ``GET .../body-unions`` — return the model's groups, each carrying both anchors' current body (name, ordinal, formation). It scope-guards the model, loads the unions, and resolves each anchor's live body in batched queries.

**Why it is here.** The desktop renders "Disjoin from <label>" from this server-resolved display info, so the desktop never owns a layer-to-body resolution map of its own. Same batched-lookup pattern as the separations list.

.. CG-EXPLANATION-END id=function:list_body_unions

Function ``async def delete_body_union``
----------------------------------------

.. CG-BLOCK id=function:delete_body_union lines=438-521

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/body_unions.py
   :language: python
   :lines: 438-521
   :lineno-match:

.. CG-EXPLANATION-START id=function:delete_body_union

**What this does.** The handler for ``DELETE .../body-unions/{union_id}`` — the Disjoin: drop one group and re-run the resolver. It scope-guards the model, takes the lock, deletes the row (``404`` if absent), re-resolves, and returns the difference.

**Why it is here.** Deleting a group is the undo path the reversible-action rule requires; because a group never merged anything, ungrouping changes no identity and no geometry, so the cached 3-D solids stay valid and the ungroup shows up in the client's group numbering. The re-resolve is kept only so the delete commits with a live difference in one transaction.

.. CG-EXPLANATION-END id=function:delete_body_union

