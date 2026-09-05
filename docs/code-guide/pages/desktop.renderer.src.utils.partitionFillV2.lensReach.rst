desktop.renderer.src.utils.partitionFillV2.lensReach
====================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/partitionFillV2/lensReach.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/partitionFillV2/lensReach.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-41

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/lensReach.ts
   :language: typescript
   :lines: 1-41
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This module is the single source of truth for how far a no-tie lens reaches into a gap. The default reach is 0.45 of the gap for every lens; a lens is shortened only when its flank would collide with a tie or band line, first halving and halving again while still colliding. Every lens-emitting path routes its apex fraction through here so the reach cannot differ between call sites.

**Why it is here.** The docstring cites owner ruling 8b-rev (2026-07-19: lenses should fill to 0.45 distance, we only need to shorten lenses that collide with a sloping correlation) — the roughly-twice-thickness cap is no longer the default, only the first step of the collision shortener. A hand-set override takes precedence and is never shortened. The 0.45 default is the product path only; the frozen fallback keeps the original thickness-capped reach byte-identical.

.. CG-EXPLANATION-END id=module-header

``interface ReachTie``
----------------------

.. CG-BLOCK id=interface:ReachTie lines=42-52

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/lensReach.ts
   :language: typescript
   :lines: 42-52
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ReachTie

**What this does.** A minimal type for a gap tie used in reach collision: just its two column endpoints.

**Why it is here.** The docstring records it is kept structural (not importing the full tie type) so this low-level module never creates a circular import back through the emitters.

.. CG-EXPLANATION-END id=interface:ReachTie

``const MIN_REACH_FRACTION``
----------------------------

.. CG-BLOCK id=const:MIN_REACH_FRACTION lines=53-69

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/lensReach.ts
   :language: typescript
   :lines: 53-69
   :lineno-match:

.. CG-EXPLANATION-START id=const:MIN_REACH_FRACTION

**What this does.** A constant, one-thousandth of the gap: a tiny floor so a degenerate unit or a zero-width gap still emits a non-degenerate lens.

**Why it is here.** The docstring notes a zero-area apex would collapse the two closing lines onto the column edge and drop the face at trace time, and this floor is well below any real lens yet far above the snap grid.

.. CG-EXPLANATION-END id=const:MIN_REACH_FRACTION

``function lensReachM``
-----------------------

.. CG-BLOCK id=function:lensReachM lines=70-93

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/lensReach.ts
   :language: typescript
   :lines: 70-93
   :lineno-match:

.. CG-EXPLANATION-START id=function:lensReachM

**What this does.** Returns the original ruling-8b lens reach in real metres: the smaller of 0.45 of the gap width and twice the unit's own thickness.

**Why it is here.** This is the thickness-capped reach the fallback path and the collision shortener's first rung use; it is stated once here.

.. CG-EXPLANATION-END id=function:lensReachM

``function lensReachFraction``
------------------------------

.. CG-BLOCK id=function:lensReachFraction lines=94-157

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/lensReach.ts
   :language: typescript
   :lines: 94-157
   :lineno-match:

.. CG-EXPLANATION-START id=function:lensReachFraction

**What this does.** Returns the default lens reach as a fraction of the gap: a flat 0.45 on the product path, or the original thickness-capped fraction on the fallback path, floored at a small epsilon and never above 0.45.

**Why it is here.** The docstring cites ruling 8b-rev: the flat 0.45 is the product default (the collision shortener trims a lens that would cross line art), while the fallback path keeps the original min-of-0.45-and-twice-thickness cap byte-identical until cut-over. A degenerate zero-width gap falls back to 0.45 to avoid dividing by zero.

.. CG-EXPLANATION-END id=function:lensReachFraction

``function fitLensReach``
-------------------------

.. CG-BLOCK id=function:fitLensReach lines=158-218

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/lensReach.ts
   :language: typescript
   :lines: 158-218
   :lineno-match:

.. CG-EXPLANATION-START id=function:fitLensReach

**What this does.** The collision shortener: given a wedge bounded above and below by sloping brackets, it returns the largest reach at which the lens apex (at the unit's own mid-elevation) sits strictly inside the wedge. It starts at the default reach and, if that collides, halves repeatedly down to the floor, returning 0 when nothing fits.

**Why it is here.** The docstring cites ruling 8t (owner 2026-07-20: retire the thickness hug, just halve the length to 0.225): on the product path the ladder halves from 0.45 with no thickness rung, whereas the fallback path keeps the original thickness-then-halve ladder. A small margin keeps the apex strictly off a bracket line so a flank cannot run collinear with it and merge the lens into the flood (the B6-class collapse).

.. CG-EXPLANATION-END id=function:fitLensReach

``function reachTieElevAt``
---------------------------

.. CG-BLOCK id=function:reachTieElevAt lines=219-270

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/lensReach.ts
   :language: typescript
   :lines: 219-270
   :lineno-match:

.. CG-EXPLANATION-START id=function:reachTieElevAt

**What this does.** Returns a tie's elevation at a given along-x, flat outside the tie's own endpoints.

**Why it is here.** The docstring records a correlation states nothing past the two contacts it joins, and extrapolating it is how a steep short-gap tie becomes a phantom bracket far away — which only became reachable when a termination started measuring against a column several gaps off (2026-08-21): CS1's 1.17 m silt tie extrapolated 31 m into gap 16 and halved a lens twice. Inside a single gap the clamp is a measured no-op.

.. CG-EXPLANATION-END id=function:reachTieElevAt

``function interiorLensReachToTies``
------------------------------------

.. CG-BLOCK id=function:interiorLensReachToTies lines=271-385

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/lensReach.ts
   :language: typescript
   :lines: 271-385
   :lineno-match:

.. CG-EXPLANATION-START id=function:interiorLensReachToTies

**What this does.** Returns the collision-shortened reach for an interior lens bracketed by the gap ties: it finds the nearest tie above and below the unit's mid-elevation (sampled across the reach span so a steeply dipping tie that cuts through the diamond is caught), fits the lens between them, and floors the result — returning the full 0.45 when no tie crosses the diamond.

**Why it is here.** The docstring cites ruling 8b-rev (only shorten a lens that collides with a sloping correlation) and ruling 8s (2026-07-19, 0.45 stands, matrix detours): the facing-sample caps are deleted, and the sole shortener is a gap tie crossing the diamond, because the surrounding soil detours around the wedge so overlap is impossible by construction. The floor keeps the lens emitting its tiny hug even where a converging bracket would otherwise fit nothing.

.. CG-EXPLANATION-END id=function:interiorLensReachToTies

``function enclosedLensReach``
------------------------------

.. CG-BLOCK id=function:enclosedLensReach lines=386-400

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/lensReach.ts
   :language: typescript
   :lines: 386-400
   :lineno-match:

.. CG-EXPLANATION-START id=function:enclosedLensReach

**What this does.** Returns the reach for an enclosed lens: on the product path it delegates to the interior tie-collision reach (0.45 unless a gap tie crosses the diamond, then halved); on the fallback path it returns the original thickness-capped reach.

**Why it is here.** The docstring cites ruling 8s: the default 0.45 is kept even when the facing carries a different soil and the wedge opens into surrounding fill, because the enclosing soil detours around the wedge; the sole shortener is a genuine tie collision. The fallback path never runs the tie scan and stays byte-identical.

.. CG-EXPLANATION-END id=function:enclosedLensReach

