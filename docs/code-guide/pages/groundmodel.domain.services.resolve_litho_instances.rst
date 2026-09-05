groundmodel.domain.services.resolve_litho_instances
===================================================

.. CG-PAGE source=src/groundmodel/domain/services/resolve_litho_instances.py complete=true

*Source file:* ``src/groundmodel/domain/services/resolve_litho_instances.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-66

.. literalinclude:: ../../../src/groundmodel/domain/services/resolve_litho_instances.py
   :language: python
   :lines: 1-66
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Introduces the resolver that groups correlated litho layers into bodies and numbers them, and imports the collection, sequence, dataclass and id tools. The docstring states the core rule and its history.

**Why it is here.** This is the heart of body identity. A body is one connected component of layers joined by approved correlation edges that share a soil; a connected component is a set of items all reachable from one another through links. Two invariants are recorded: a body is one soil (2026-06-03), so an edge across soils is dropped; and a body may cross a geological boundary (A2, 2026-06-04), so the geological parent no longer filters edges. The module also hosts a separate formation-level graph walk kept deliberately distinct.

.. CG-EXPLANATION-END id=module-header

Class ``LayerNode``
-------------------

.. CG-BLOCK id=class:LayerNode lines=67-117

.. literalinclude:: ../../../src/groundmodel/domain/services/resolve_litho_instances.py
   :language: python
   :lines: 67-117
   :lineno-match:

.. CG-EXPLANATION-START id=class:LayerNode

**What this does.** A frozen data holder for one accepted layer the resolver reasons about: its id, its formation, its geological parent, its soil, its top depth, its anchor investigation, and, for a geotech band, its packing-class formation and its NAD packing class number.

**Why it is here.** The resolver needs a slim snapshot of each layer. The docstring is careful about the packing fields: a litho layer carries none, so the soil filter alone decides there; a geotech body is one soil AND one packing density, so two sand bands of different densities are two bodies however they are tied. The class number matters because the same NAD class exists under several formation rows across geological parents, and the owner ruled the mass identity is the CLASS, not the row.

.. CG-EXPLANATION-END id=class:LayerNode

Class ``LayerEdge``
-------------------

.. CG-BLOCK id=class:LayerEdge lines=118-133

.. literalinclude:: ../../../src/groundmodel/domain/services/resolve_litho_instances.py
   :language: python
   :lines: 118-133
   :lineno-match:

.. CG-EXPLANATION-START id=class:LayerEdge

**What this does.** A frozen data holder for one user-approved correlation edge: its two endpoint layer ids.

**Why it is here.** The resolver walks approved edges to find connected components, so it needs each edge as a slim two-endpoint record. These edges are the real correlation ties the engineer drew, never generated automatically.

.. CG-EXPLANATION-END id=class:LayerEdge

Class ``LayerSeparation``
-------------------------

.. CG-BLOCK id=class:LayerSeparation lines=134-162

.. literalinclude:: ../../../src/groundmodel/domain/services/resolve_litho_instances.py
   :language: python
   :lines: 134-162
   :lineno-match:

.. CG-EXPLANATION-START id=class:LayerSeparation

**What this does.** A frozen data holder for one Separate ruling: two layer anchors that must never share a body. This is a cannot-link constraint, the opposite of an edge.

**Why it is here.** The docstring records that the Separate verb (debt #278) let the engineer state two masses are NOT the same body and have it honoured permanently. It anchors on LAYER ids, never body ids, because body ids re-mint on every resolve, so a body-anchored constraint would bind the wrong mass after the next renumber. This type is dormant now, but kept so old data still loads.

.. CG-EXPLANATION-END id=class:LayerSeparation

Class ``LayerUnion``
--------------------

.. CG-BLOCK id=class:LayerUnion lines=163-204

.. literalinclude:: ../../../src/groundmodel/domain/services/resolve_litho_instances.py
   :language: python
   :lines: 163-204
   :lineno-match:

.. CG-EXPLANATION-START id=class:LayerUnion

**What this does.** A frozen data holder for one Join with ruling: two layer anchors the engineer grouped together.

**Why it is here.** The docstring records owner ruling 2026-09-02: a Join is a GROUP relation, not a merge. Separate bodies keep their separate ids; grouping only lumps similar bodies (same soil and class) so an export can pool them into one class and the units pane can tag them group N. It anchors on layer ids for the same re-mint reason as separations, and it is dormant in the resolver: identity is geometry-only, so the resolver ignores unions and the grouping is resolved for display on the client.

.. CG-EXPLANATION-END id=class:LayerUnion

Class ``InstanceAssignment``
----------------------------

.. CG-BLOCK id=class:InstanceAssignment lines=205-231

.. literalinclude:: ../../../src/groundmodel/domain/services/resolve_litho_instances.py
   :language: python
   :lines: 205-231
   :lineno-match:

.. CG-EXPLANATION-START id=class:InstanceAssignment

**What this does.** A frozen data holder for one resolved instance: its representative formation (the shallowest member's), its 0-based ordinal within the soil naming group, all its member layer ids, its source investigation, and its shallowest depth.

**Why it is here.** Each connected component becomes one body, and this carries everything the caller needs to reconcile the body row and stamp every member layer's body id. The ordinal is the depth rank the section renderer uses for labels, so Sa1 is the shallowest sand instance and Sa2 the next.

.. CG-EXPLANATION-END id=class:InstanceAssignment

Class ``ResolveResult``
-----------------------

.. CG-BLOCK id=class:ResolveResult lines=232-263

.. literalinclude:: ../../../src/groundmodel/domain/services/resolve_litho_instances.py
   :language: python
   :lines: 232-263
   :lineno-match:

.. CG-EXPLANATION-START id=class:ResolveResult

**What this does.** A data holder for the whole answer: the list of instances, a lookup from layer to its ordinal, a lookup from layer to its representative formation, and two union lists that are always empty now.

**Why it is here.** Bundling the instances with the two lookups lets callers and tests read the result without re-deriving it. The two union lists are documented as always empty since the 2026-09-02 ruling made a Join a group relation rather than a merge, so the resolver never judges a union inert; they are kept only for signature compatibility.

.. CG-EXPLANATION-END id=class:ResolveResult

Function ``def _bfs_reachable``
-------------------------------

.. CG-BLOCK id=function:_bfs_reachable lines=264-297

.. literalinclude:: ../../../src/groundmodel/domain/services/resolve_litho_instances.py
   :language: python
   :lines: 264-297
   :lineno-match:

.. CG-EXPLANATION-START id=function:_bfs_reachable

**What this does.** Returns every node reachable from a starting node by breadth-first search, in the order they are discovered. Breadth-first search explores a graph outward from the start, visiting nearest neighbours first, using a queue.

**Why it is here.** This is the traversal core for the separate formation-level graph walk below, not the body resolver. The docstring is explicit that the body resolver no longer uses it, because the resolver needs a CONSTRAINED grouping that can refuse an edge a plain walk would blindly follow.

.. CG-EXPLANATION-END id=function:_bfs_reachable

Function ``def _constrained_components``
----------------------------------------

.. CG-BLOCK id=function:_constrained_components lines=298-382

.. literalinclude:: ../../../src/groundmodel/domain/services/resolve_litho_instances.py
   :language: python
   :lines: 298-382
   :lineno-match:

.. CG-EXPLANATION-START id=function:_constrained_components

**What this does.** Groups layers into connected components with a constrained union-find that honours cannot-link (Separate) constraints. It seeds each separation anchor with a side marker, then for each edge refuses the union if merging would place both sides of one separation under a single group. It returns the components with members in a deterministic order.

**Why it is here.** Plain connectivity would merge every layer an edge reaches, ignoring the engineer's Separate rulings. The docstring flags a subtlety: with cannot-link constraints the result depends on edge order, so the caller sorts the edges canonically first, and that sort IS the determinism guarantee. The side-marker bookkeeping keeps the invariant that no group ever holds both sides of one separation.

.. CG-EXPLANATION-END id=function:_constrained_components

Function ``def same_mass``
--------------------------

.. CG-BLOCK id=function:same_mass lines=383-434

.. literalinclude:: ../../../src/groundmodel/domain/services/resolve_litho_instances.py
   :language: python
   :lines: 383-434
   :lineno-match:

.. CG-EXPLANATION-START id=function:same_mass

**What this does.** The shared predicate deciding whether two layers describe one mass. Different soil is never one mass. For geotech bands where both carry a packing class: if both class numbers are known they must be equal; otherwise the packing formation rows must be equal. A litho layer carries no packing class, so only the soil rule applies.

**Why it is here.** Both a machine edge and a user Join must obey the identical rule, so it lives in one place (owner 2026-06-03 one-soil invariant plus the 2026-08-19 and 2026-08-21 one-packing invariant). Comparing the CLASS rather than the row where both are known is load-bearing: one class lives under several row ids across geological parents, so comparing rows would wrongly split a body tied across a geological boundary. Two unknown classes are not assumed equal.

.. CG-EXPLANATION-END id=function:same_mass

Module-level constants and statements
-------------------------------------

.. CG-BLOCK id=module-statements lines=435-437

.. literalinclude:: ../../../src/groundmodel/domain/services/resolve_litho_instances.py
   :language: python
   :lines: 435-437
   :lineno-match:

.. CG-EXPLANATION-START id=module-statements

**What this does.** Keeps the old private name as an alias for the now-public predicate.

**Why it is here.** The predicate was private until it became a cross-layer contract the body-union write guard also calls, so it was made public as same_mass. The alias preserves any code that still imports the old private name, honouring the backwards-compatibility habit of not breaking existing callers.

.. CG-EXPLANATION-END id=module-statements

Function ``def resolve_litho_instances``
----------------------------------------

.. CG-BLOCK id=function:resolve_litho_instances lines=438-610

.. literalinclude:: ../../../src/groundmodel/domain/services/resolve_litho_instances.py
   :language: python
   :lines: 438-610
   :lineno-match:

.. CG-EXPLANATION-START id=function:resolve_litho_instances

**What this does.** The public entry point. It maps layers by id, drops dangling edges and edges that fail the one-mass predicate, sorts the survivors canonically, groups them into components (with no live separations now), then per soil naming group sorts the components shallowest-first and assigns ordinals, stamping each member's ordinal and representative formation. It returns the instances and lookups.

**Why it is here.** This runs on every correlation-mutating action to keep body identity coherent. The docstring and comments record that both the separations and the unions arguments are dormant: separations because the Separate verb was removed (2026-09-01) and unions because a Join is now a group relation, not a merge (2026-09-02). Both are still accepted so every caller, including bundle restore of legacy rows, is unchanged, and the resolve is byte-identical whether or not they are supplied. Identity is geometry-only: only real edges and geometry facts decide it, never generated ties.

.. CG-EXPLANATION-END id=function:resolve_litho_instances

Class ``CorrelationEdge``
-------------------------

.. CG-BLOCK id=class:CorrelationEdge lines=611-626

.. literalinclude:: ../../../src/groundmodel/domain/services/resolve_litho_instances.py
   :language: python
   :lines: 611-626
   :lineno-match:

.. CG-EXPLANATION-START id=class:CorrelationEdge

**What this does.** A frozen data holder for one formation-level correlation edge: its two endpoint formation ids, canonically ordered.

**Why it is here.** This is the input for the separate formation-level graph walk below, which reasons over formations rather than layers. It is kept distinct from the layer edge because it names a different kind of node.

.. CG-EXPLANATION-END id=class:CorrelationEdge

Function ``def connected_formation_ids``
----------------------------------------

.. CG-BLOCK id=function:connected_formation_ids lines=627-659

.. literalinclude:: ../../../src/groundmodel/domain/services/resolve_litho_instances.py
   :language: python
   :lines: 627-659
   :lineno-match:

.. CG-EXPLANATION-START id=function:connected_formation_ids

**What this does.** Builds an undirected adjacency map from the formation edges and returns every formation reachable from a starting formation, including the start itself.

**Why it is here.** This serves the admixture-propagation use case, which needs to walk the formation-level correlation graph and is the only remaining caller of the breadth-first helper. The docstring keeps it intentionally separate from the layer resolver: different node kind, different filters, different traversal.

.. CG-EXPLANATION-END id=function:connected_formation_ids

