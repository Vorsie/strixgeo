desktop.renderer.src.utils.tieAutoSuggest
=========================================

.. CG-PAGE source=desktop/src/renderer/src/utils/tieAutoSuggest.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/tieAutoSuggest.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-17

.. literalinclude:: ../../../desktop/src/renderer/src/utils/tieAutoSuggest.ts
   :language: typescript
   :lines: 1-17
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Auto-proposes clean tie-sections — short sections that link a set of roughly-parallel cross-sections — from the investigations near them. It is pure math. The docstring gives the two stages: a strike-ordered sweep (strike is the along-line direction) proposes candidate rungs of about one test per wall, with members within a strike tolerance; then a conflict-free greedy selection keeps a subset guaranteed to have no two ties crossing in the map plane and no two ties sharing a test. It imports the projection helpers.

**Why it is here.** The docstring records why the second stage exists (spec §5.1.1): the strike sweep alone does not guarantee no crossings and no shared tests on real, not-perfectly-parallel walls with scattered tests, but the greedy pass does, by construction.

.. CG-EXPLANATION-END id=module-header

``interface TieInvestigation``
------------------------------

.. CG-BLOCK id=interface:TieInvestigation lines=18-24

.. literalinclude:: ../../../desktop/src/renderer/src/utils/tieAutoSuggest.ts
   :language: typescript
   :lines: 18-24
   :lineno-match:

.. CG-EXPLANATION-START id=interface:TieInvestigation

**What this does.** One investigation with its map location — an id and its x/y — followed by the docstring for the parallel-section shape below.

**Why it is here.** The minimal shape the sweep needs to project each test onto the walls.

.. CG-EXPLANATION-END id=interface:TieInvestigation

``interface ParallelSection``
-----------------------------

.. CG-BLOCK id=interface:ParallelSection lines=25-32

.. literalinclude:: ../../../desktop/src/renderer/src/utils/tieAutoSuggest.ts
   :language: typescript
   :lines: 25-32
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ParallelSection

**What this does.** An existing cross-section the ties will cross: its endpoints, its id, its projection buffer, and any explicitly-excluded CPT or borehole ids. It is followed by the tie-member docstring.

**Why it is here.** Names what the sweep needs about each wall, including which tests it excludes — explicit hides take precedence, exactly as in the projection filter.

.. CG-EXPLANATION-END id=interface:ParallelSection

``interface TieMember``
-----------------------

.. CG-BLOCK id=interface:TieMember lines=33-40

.. literalinclude:: ../../../desktop/src/renderer/src/utils/tieAutoSuggest.ts
   :language: typescript
   :lines: 33-40
   :lineno-match:

.. CG-EXPLANATION-START id=interface:TieMember

**What this does.** One member test of a proposed tie — one per wall the tie connects — carrying its section id, investigation id and x/y. It is followed by the suggested-tie docstring.

**Why it is here.** A tie links one test on each wall it spans; this is that per-wall member.

.. CG-EXPLANATION-END id=interface:TieMember

``interface SuggestedTie``
--------------------------

.. CG-BLOCK id=interface:SuggestedTie lines=41-53

.. literalinclude:: ../../../desktop/src/renderer/src/utils/tieAutoSuggest.ts
   :language: typescript
   :lines: 41-53
   :lineno-match:

.. CG-EXPLANATION-START id=interface:SuggestedTie

**What this does.** A single proposed tie: its member tests ordered by strike, the projected endpoints of the straight tie line through the extreme members, the greatest along-strike spread among the members (a measure of how collinear they are), and the thinnest buffer that still catches every member. It is followed by the perpendicular-distance docstring.

**Why it is here.** The comments record what the two quality numbers mean: the strike spread grades collinearity, and the buffer is the thinnest corridor that still reaches every member.

.. CG-EXPLANATION-END id=interface:SuggestedTie

``function perpDistanceToLine``
-------------------------------

.. CG-BLOCK id=function:perpDistanceToLine lines=54-64

.. literalinclude:: ../../../desktop/src/renderer/src/utils/tieAutoSuggest.ts
   :language: typescript
   :lines: 54-64
   :lineno-match:

.. CG-EXPLANATION-START id=function:perpDistanceToLine

**What this does.** Returns the perpendicular distance from a point to the line through two other points, falling back to the plain point-to-point distance when those two points coincide. It is followed by the 2-D point docstring.

**Why it is here.** A geometry primitive used to size a tie's buffer and to test corridor membership.

.. CG-EXPLANATION-END id=function:perpDistanceToLine

``interface Pt``
----------------

.. CG-BLOCK id=interface:Pt lines=65-74

.. literalinclude:: ../../../desktop/src/renderer/src/utils/tieAutoSuggest.ts
   :language: typescript
   :lines: 65-74
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Pt

**What this does.** A 2-D point in the projected CRS, followed by the segments-cross docstring.

**Why it is here.** Names the point shape the crossing and corridor tests operate on.

.. CG-EXPLANATION-END id=interface:Pt

``function segmentsCross``
--------------------------

.. CG-BLOCK id=function:segmentsCross lines=75-89

.. literalinclude:: ../../../desktop/src/renderer/src/utils/tieAutoSuggest.ts
   :language: typescript
   :lines: 75-89
   :lineno-match:

.. CG-EXPLANATION-START id=function:segmentsCross

**What this does.** Tests whether two open segments properly cross, using the standard orientation (counter-clockwise) test; segments that are collinear or merely touch at an endpoint count as not crossing. It is followed by the corridor-contains docstring.

**Why it is here.** The docstring records the endpoint rule: a tie that shares an endpoint with another is not a crossing, so those cases return false; the test is used to stop two accepted ties from crossing in the map plane.

.. CG-EXPLANATION-END id=function:segmentsCross

``function corridorContains``
-----------------------------

.. CG-BLOCK id=function:corridorContains lines=90-100

.. literalinclude:: ../../../desktop/src/renderer/src/utils/tieAutoSuggest.ts
   :language: typescript
   :lines: 90-100
   :lineno-match:

.. CG-EXPLANATION-START id=function:corridorContains

**What this does.** Tests whether a point lies inside the rectangular corridor of a given half-width around a segment, allowing a small ±5% overhang past each end. It is followed by the candidate docstring.

**Why it is here.** The comment records that the overhang mirrors the section's own projection behaviour; the test finds every investigation a proposed tie's corridor would capture.

.. CG-EXPLANATION-END id=function:corridorContains

``interface TieCandidate``
--------------------------

.. CG-BLOCK id=interface:TieCandidate lines=101-120

.. literalinclude:: ../../../desktop/src/renderer/src/utils/tieAutoSuggest.ts
   :language: typescript
   :lines: 101-120
   :lineno-match:

.. CG-EXPLANATION-START id=interface:TieCandidate

**What this does.** A candidate tie plus what the conflict-free selector needs: the tie, the ids of every investigation inside its corridor, and its length in metres. It is followed by the selector docstring.

**Why it is here.** The corridor id set is how the selector forbids two ties from sharing a test, and the length is the tie-breaker after the buffer.

.. CG-EXPLANATION-END id=interface:TieCandidate

``function selectNonConflictingTies``
-------------------------------------

.. CG-BLOCK id=function:selectNonConflictingTies lines=121-148

.. literalinclude:: ../../../desktop/src/renderer/src/utils/tieAutoSuggest.ts
   :language: typescript
   :lines: 121-148
   :lineno-match:

.. CG-EXPLANATION-START id=function:selectNonConflictingTies

**What this does.** Greedily keeps a conflict-free subset of candidate ties. It orders them thinnest-buffer-first (then shortest), and accepts a candidate only if it neither crosses an already-accepted tie nor shares a test with one — its corridor holding an investigation an accepted tie already consumed; each accepted tie then consumes its corridor's ids. It is followed by the internal placed-record docstring.

**Why it is here.** The docstring records the guarantee: the result has zero crossings and zero shared tests, and taking the thinnest buffer first prefers the most collinear ties.

.. CG-EXPLANATION-END id=function:selectNonConflictingTies

``interface Placed``
--------------------

.. CG-BLOCK id=interface:Placed lines=149-160

.. literalinclude:: ../../../desktop/src/renderer/src/utils/tieAutoSuggest.ts
   :language: typescript
   :lines: 149-160
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Placed

**What this does.** An internal record of a test placed onto one wall during the sweep: the investigation, the wall index, and its position along the strike axis. It is followed by the docstring for the main function.

**Why it is here.** The sweep's working record for each test it has assigned to a wall.

.. CG-EXPLANATION-END id=interface:Placed

``function suggestTieSections``
-------------------------------

.. CG-BLOCK id=function:suggestTieSections lines=161-269

.. literalinclude:: ../../../desktop/src/renderer/src/utils/tieAutoSuggest.ts
   :language: typescript
   :lines: 161-269
   :lineno-match:

.. CG-EXPLANATION-START id=function:suggestTieSections

**What this does.** Proposes a non-crossing ladder of ties. It returns nothing for fewer than two sections. It takes the first section's direction as the strike axis, then assigns each investigation to the single wall it projects onto best (within that wall's buffer and span, skipping excluded ids). It sorts each wall's tests by strike, then sweeps a moving frontier: at each step it looks at the lowest-strike unused test on every wall, groups those within the strike tolerance into a rung, advances past them, and — when a rung has at least two members — builds a tie (members sorted by strike, endpoints at the extremes, a buffer sized to catch every member plus breathing room), works out which investigations its corridor would capture, and records the candidate. Finally it returns the conflict-free subset.

**Why it is here.** The comments record three decisions: the constant ``while (true)`` loop is correct because the frontier is rebuilt from the per-wall pointers each pass and the "all walls exhausted" check has to live inside the loop, which is why the linter suppression carries a reason; the buffer has a 5 m floor because a narrower corridor would miss real-world measurement scatter even for a dead-collinear tie, plus 2 m of breathing room beyond the widest member; and the final conflict-free pass is what forbids two ties from crossing or sharing a test.

.. CG-EXPLANATION-END id=function:suggestTieSections

