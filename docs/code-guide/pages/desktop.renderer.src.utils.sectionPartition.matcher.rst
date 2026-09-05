desktop.renderer.src.utils.sectionPartition.matcher
===================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/sectionPartition/matcher.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/sectionPartition/matcher.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-8

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionPartition/matcher.ts
   :language: typescript
   :lines: 1-8
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the section-wide matcher: the code that decides, for a gap between two columns, which unit on the left pairs with which unit on the right. It imports the small overlap tolerance and the unit shape from the vocabulary file next door.

**Why it is here.** Like its siblings this was lifted verbatim out of the old ``partitionFill.ts`` under debt #201. It is the part of the engine that turns drawn correlations plus soil-and-geometry into pairings, so it sits at the centre of the 2/1/0 rule.

.. CG-EXPLANATION-END id=module-header

``interface MatchUnit``
-----------------------

.. CG-BLOCK id=interface:MatchUnit lines=9-27

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionPartition/matcher.ts
   :language: typescript
   :lines: 9-27
   :lineno-match:

.. CG-EXPLANATION-START id=interface:MatchUnit

**What this does.** A unit prepared for matching, with its elevations already worked out: its soil, its ``layerId`` (what correlation edges reference), its top and base elevations in metres TAW, and an optional ``virtual`` flag.

**Why it is here.** Elevations are precomputed here so the matcher never re-derives them in its inner loop. The docstring warns that virtual units must never pair, because their elevation ranges mirror the real deep column exactly and a geometry-only score would invent spurious bands.

.. CG-EXPLANATION-END id=interface:MatchUnit

``type Correlated``
-------------------

.. CG-BLOCK id=type:Correlated lines=28-35

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionPartition/matcher.ts
   :language: typescript
   :lines: 28-35
   :lineno-match:

.. CG-EXPLANATION-START id=type:Correlated

**What this does.** A named function shape: given two layer ids, it answers true when an approved correlation edge directly connects them.

**Why it is here.** The matcher is handed this lookup rather than the raw edge list, so the same matching code works whether the caller supplies user edges, base-tie edges, or a precomputed fast lookup.

.. CG-EXPLANATION-END id=type:Correlated

``interface TieSets``
---------------------

.. CG-BLOCK id=interface:TieSets lines=36-46

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionPartition/matcher.ts
   :language: typescript
   :lines: 36-46
   :lineno-match:

.. CG-EXPLANATION-START id=interface:TieSets

**What this does.** For one unit looking toward one neighbour, the two sets of layer ids whose top contact and whose base contact the engineer explicitly tied to that neighbour.

**Why it is here.** This is the per-side bookkeeping of the owner's 2/1/0 model — how many of a unit's two bounding contacts are tied toward this particular neighbour. The docstring notes synthetic bridge edges never contribute, so only real user ties count.

.. CG-EXPLANATION-END id=interface:TieSets

``const isSyntheticLayer``
--------------------------

.. CG-BLOCK id=const:isSyntheticLayer lines=47-67

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionPartition/matcher.ts
   :language: typescript
   :lines: 47-67
   :lineno-match:

.. CG-EXPLANATION-START id=const:isSyntheticLayer

**What this does.** Answers true when a layer id was injected by the engine rather than declared by the engineer — bridge copies, borehole projections, flood fillers, and gap fillers, recognised by their id prefixes.

**Why it is here.** Engine-injected units carry the soil across data voids but are never user statements, so they must neither count as ties nor terminate with their own gesture. The docstring records a concrete bug this prevents: treating a ``gapfill:`` unit as a lens once put a spurious clay lens into a deep substrate (dogfeed 2026-07-07).

.. CG-EXPLANATION-END id=const:isSyntheticLayer

``type ContactTermination``
---------------------------

.. CG-BLOCK id=type:ContactTermination lines=68-114

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionPartition/matcher.ts
   :language: typescript
   :lines: 68-114
   :lineno-match:

.. CG-EXPLANATION-START id=type:ContactTermination

**What this does.** The three ways a unit can end toward one neighbour, named as words: ``band`` (both bounding contacts tied, so it spans the gap), ``onlap`` (exactly one contact tied, so it laps the tie-line and pinches to meet it), and ``lens`` (neither tied, so it closes to a point in the void).

**Why it is here.** This is the owner's 2/1/0 model (2026-06-09) written as a type — the skeletal framework of the whole interpolation mechanism, where the count of tied contacts (2, 1, 0) chooses the shape (band, onlap, lens).

.. CG-EXPLANATION-END id=type:ContactTermination

``function classifyTermination``
--------------------------------

.. CG-BLOCK id=function:classifyTermination lines=115-182

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionPartition/matcher.ts
   :language: typescript
   :lines: 115-182
   :lineno-match:

.. CG-EXPLANATION-START id=function:classifyTermination

**What this does.** The heart of the 2/1/0 rule. For one unit looking at one neighbour column, it counts how many of the unit's two bounding contacts are tied to that neighbour. The TOP contact is tied when an approved edge sits on this unit's own layer; the BASE contact is tied when an edge sits on the layer immediately below it, or when this unit's own layer carries a bottom-tie. It adds the two (0, 1 or 2) and returns ``lens``, ``onlap`` or ``band`` accordingly. It accepts optional precomputed lookup sets so the count is a fast set-membership test in the hot loop.

**Why it is here.** The docstring names this as the owner's model made literal: the count maps directly to lens/onlap/band, and it is judged per side so the same unit can band toward one neighbour and pinch toward the other. The careful separation of top-keyed edges from base-ties exists so a base-tie can never make a unit's top contact look correlated, which would wrongly promote a lens to an onlap.

.. CG-EXPLANATION-END id=function:classifyTermination

``function pairScore``
----------------------

.. CG-BLOCK id=function:pairScore lines=183-227

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionPartition/matcher.ts
   :language: typescript
   :lines: 183-227
   :lineno-match:

.. CG-EXPLANATION-START id=function:pairScore

**What this does.** Scores how strongly two candidate units, one on each column, should pair: 4 when they share a soil, a correlation edge and a geometric overlap; 3 for a correlation edge with no overlap (a correlated bed that dips between the columns); 1 for a geometric overlap with no edge (matrix fill only); 0 for no match, meaning the unit pinches out. It refuses any pairing across different soils or involving a virtual unit.

**Why it is here.** The docstring makes the ranking explicit: an explicit correlation is the authoritative band signal and connects two beds at any elevation, while geometric overlap is only a last-resort fill tier. It deliberately does NOT use ``body_id`` because the resolver over-lumps it and would falsely band uncorrelated beds. Base-ties are scored through a separate predicate so they never make a top contact look correlated.

.. CG-EXPLANATION-END id=function:pairScore

``function matchColumns``
-------------------------

.. CG-BLOCK id=function:matchColumns lines=228-264

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionPartition/matcher.ts
   :language: typescript
   :lines: 228-264
   :lineno-match:

.. CG-EXPLANATION-START id=function:matchColumns

**What this does.** Given both columns' units in order and the correlation lookups, returns the matched (left, right) index pairs. It fills a table with the best cumulative score (a weighted longest-common-subsequence over ``pairScore``) and then walks back through the table to recover the pairs, keeping them in top-to-bottom order and never crossing them.

**Why it is here.** Order-preserving matching is what lets explicit correlations win while the uncorrelated soil still connects by overlap, without the pairings tangling. The docstring reiterates that it never pairs across lithology and keeps the base-tie lookup separate so a base-tie does not disturb the top-contact count the 2/1/0 classifier relies on.

.. CG-EXPLANATION-END id=function:matchColumns

