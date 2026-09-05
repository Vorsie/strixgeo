desktop.renderer.src.utils.geotechGroupOrdinals
===============================================

.. CG-PAGE source=desktop/src/renderer/src/utils/geotechGroupOrdinals.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/geotechGroupOrdinals.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-26

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechGroupOrdinals.ts
   :language: typescript
   :lines: 1-26
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This file gives a deterministic number to each manual body group. The comment defines a group as a connected set of "Join with…" pairs — the verb by which the engineer declares two geometrically separate bodies to be the same mass. The server stores each pair and reports each anchor's current body but issues no group id, so the pane derives one here: it runs union-find over the pairs' body ids and numbers the resulting components in a stable order. It imports the union list-item type.

**Why it is here.** The reasons are recorded in the comment. It is derived rather than stored because a union is a fact about a pair, while "these three are one group" is the transitive closure of several pairs and is recomputed each time a union is added or lifted — numbering it in the client keeps the pane honest without a second server round-trip or a schema field that would have to be kept in sync. It lives under utils because both the geotech units roster and the Parameters body tree read it (owner ruling 2026-09-02, the "(group N)" tag rides both panes), so there is one copy and no duplication. The group-suggestion heuristic is deliberately not here — it is a Phase-5 follow-up; this module only reflects unions the engineer already made.

.. CG-EXPLANATION-END id=module-header

``interface GeotechGroupAnchor``
--------------------------------

.. CG-BLOCK id=interface:GeotechGroupAnchor lines=27-34

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechGroupOrdinals.ts
   :language: typescript
   :lines: 27-34
   :lineno-match:

.. CG-EXPLANATION-START id=interface:GeotechGroupAnchor

**What this does.** Describes one anchor of a union pair: the body it currently resolves to and that body's ordinal within its naming group, either of which may be absent when the anchor is unstamped.

**Why it is here.** A union is recorded against anchors, but grouping reasons about the bodies they currently point at, so each anchor carries its resolved body and ordinal.

.. CG-EXPLANATION-END id=interface:GeotechGroupAnchor

``interface GeotechGroupPair``
------------------------------

.. CG-BLOCK id=interface:GeotechGroupPair lines=35-41

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechGroupOrdinals.ts
   :language: typescript
   :lines: 35-41
   :lineno-match:

.. CG-EXPLANATION-START id=interface:GeotechGroupPair

**What this does.** Describes one manual union pair as its two anchors.

**Why it is here.** The pure numbering works on pairs of anchors, so this is the shape the API rows are adapted into.

.. CG-EXPLANATION-END id=interface:GeotechGroupPair

``const NO_ORDINAL``
--------------------

.. CG-BLOCK id=const:NO_ORDINAL lines=42-51

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechGroupOrdinals.ts
   :language: typescript
   :lines: 42-51
   :lineno-match:

.. CG-EXPLANATION-START id=const:NO_ORDINAL

**What this does.** A sentinel standing for "no ordinal", set to the largest safe integer.

**Why it is here.** Ordinals can be missing on an unstamped anchor; treating a missing one as "sorts last" means a real ordinal always wins the lowest-ordinal comparison used to order the groups.

.. CG-EXPLANATION-END id=const:NO_ORDINAL

``function bodyUnionsToGroupPairs``
-----------------------------------

.. CG-BLOCK id=function:bodyUnionsToGroupPairs lines=52-84

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechGroupOrdinals.ts
   :language: typescript
   :lines: 52-84
   :lineno-match:

.. CG-EXPLANATION-START id=function:bodyUnionsToGroupPairs

**What this does.** Turns the API's union rows into the pure pair shape, mapping each union's two anchors to their current body id and ordinal, and treating a missing list as empty.

**Why it is here.** This is the one place the anchor-to-pair shape is read, so all three consumers (the geotech roster, the Parameters unit list, the Parameters canvas) agree on it rather than each adapting the rows their own way.

.. CG-EXPLANATION-END id=function:bodyUnionsToGroupPairs

``function geotechGroupOrdinals``
---------------------------------

.. CG-BLOCK id=function:geotechGroupOrdinals lines=85-195

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechGroupOrdinals.ts
   :language: typescript
   :lines: 85-195
   :lineno-match:

.. CG-EXPLANATION-START id=function:geotechGroupOrdinals

**What this does.** Numbers the manual body groups, returning a map from body id to a 1-based group number. It runs union-find over the stamped body ids in the pairs, gathers the resulting components, keeps only those with two or more members, sorts them by their lowest body ordinal (ties broken by lowest body id), and numbers them 1, 2, and so on. Only bodies in a multi-member group appear in the result.

**Why it is here.** The stable sort order is what makes the same project always read "group 1" for the same set, so the tag does not jump around between renders. Only multi-member components are numbered because a body joined to nothing is a singleton and carries no tag; the docstring notes that every union connects two distinct stamped bodies, so any body appearing in one is by definition in a group of at least two. Union-find is the standard way to fold pairwise "same as" facts into whole groups.

.. CG-EXPLANATION-END id=function:geotechGroupOrdinals

``function geotechGroupMembers``
--------------------------------

.. CG-BLOCK id=function:geotechGroupMembers lines=196-206

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechGroupOrdinals.ts
   :language: typescript
   :lines: 196-206
   :lineno-match:

.. CG-EXPLANATION-START id=function:geotechGroupMembers

**What this does.** Given the group-number map and one body, returns that body's group number and the ids of every member of its group (sorted by id), or nothing when the body is in no multi-member group.

**Why it is here.** The docstring records the reason: when a grouped body is selected in the Parameters stage its statistics pool all member bodies' bands (owner ruling 2026-09-02, "grouping is just for lumping things that are similar together, so we have more data"). Resolving the member set from the same map the "(group N)" tag reads guarantees the tag and the pooled statistics never disagree on who is in a group; the stable id sort makes the provenance list read the same every render.

.. CG-EXPLANATION-END id=function:geotechGroupMembers

