desktop.renderer.src.utils.partitionFillV2.emitLonePinch
========================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/partitionFillV2/emitLonePinch.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/partitionFillV2/emitLonePinch.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-55

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitLonePinch.ts
   :language: typescript
   :lines: 1-55
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This module draws a lone-side pinch: when a unit on one column has no counterpart on the facing column, it must pinch (its apex sits short of the far column) and the facing enclosing soil claims the space past the apex, rather than the unit filling the whole gap width. It ports v1's one-sided-pinch geometry into arrangement lines: a pinch triangle for each stacked unit (a lens at 0.45 of the gap for a no-tie unit, an onlap at 0.5 on the tied bracket for a one-tie unit), plus flood-closure lines that bound the vacated wedge beyond the apex and are coloured from the bracket matrix as a band.

**Why it is here.** The docstring records the systematic finding-A defect it fixes (a lone untied unit filling the whole width) and the reach guard: a unit the facing column is too shallow to reach is a data void that continues sideways at full width and is not routed here, so this module only ever emits for genuine pinch-outs.

.. CG-EXPLANATION-END id=module-header

``const ELEV_EPS``
------------------

.. CG-BLOCK id=const:ELEV_EPS lines=56-58

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitLonePinch.ts
   :language: typescript
   :lines: 56-58
   :lineno-match:

.. CG-EXPLANATION-START id=const:ELEV_EPS

**What this does.** The one-millionth-of-a-metre elevation slack, as elsewhere.

**Why it is here.** Floating-point noise must not read as a real elevation difference before the 1 mm snap.

.. CG-EXPLANATION-END id=const:ELEV_EPS

``function facingTopElevOf``
----------------------------

.. CG-BLOCK id=function:facingTopElevOf lines=59-63

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitLonePinch.ts
   :language: typescript
   :lines: 59-63
   :lineno-match:

.. CG-EXPLANATION-START id=function:facingTopElevOf

**What this does.** Returns the facing column's top-bracket elevation for a given lone side (the right value when the lone side is left, and vice versa).

**Why it is here.** A one-line helper so the lone-side code reads the facing bracket without repeating the left/right swap.

.. CG-EXPLANATION-END id=function:facingTopElevOf

``function facingBaseElevOf``
-----------------------------

.. CG-BLOCK id=function:facingBaseElevOf lines=64-72

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitLonePinch.ts
   :language: typescript
   :lines: 64-72
   :lineno-match:

.. CG-EXPLANATION-START id=function:facingBaseElevOf

**What this does.** The same helper for the facing column's base-bracket elevation.

**Why it is here.** Same shape as the helper above, for the base bracket instead of the top.

.. CG-EXPLANATION-END id=function:facingBaseElevOf

``interface LonePinchBracket``
------------------------------

.. CG-BLOCK id=interface:LonePinchBracket lines=73-99

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitLonePinch.ts
   :language: typescript
   :lines: 73-99
   :lineno-match:

.. CG-EXPLANATION-START id=interface:LonePinchBracket

**What this does.** A type for one bracket line across a gap: its left and right elevations plus an ``anchor`` flag marking a real tie or bridge (versus the surface or TD floor).

**Why it is here.** A unit whose bounding contact sits on an anchor bracket is tied on that contact (one tie means onlap), so the flag is what separates an onlap from a lens.

.. CG-EXPLANATION-END id=interface:LonePinchBracket

``function loneSidePinches``
----------------------------

.. CG-BLOCK id=function:loneSidePinches lines=100-142

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitLonePinch.ts
   :language: typescript
   :lines: 100-142
   :lineno-match:

.. CG-EXPLANATION-START id=function:loneSidePinches

**What this does.** A yes/no test: do a lone side's units genuinely pinch (the facing column reaches them) rather than continue sideways into a data void? It answers yes when the facing column's deepest base reaches the deepest lone unit's base.

**Why it is here.** The docstring ports v1's full-observation reach guard: a lens gesture needs the facing column to reach the unit's base, so a facing too shallow means the caller keeps the full-width fill instead (v1's sideways continuation, which is not the defect).

.. CG-EXPLANATION-END id=function:loneSidePinches

``function emitLonePinch``
--------------------------

.. CG-BLOCK id=function:emitLonePinch lines=143-281

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitLonePinch.ts
   :language: typescript
   :lines: 143-281
   :lineno-match:

.. CG-EXPLANATION-START id=function:emitLonePinch

**What this does.** Draws the lone-side pinch and flood-closure lines for one interval and records each line's colour. It decides lens versus boundary pinch, caps the lens reach to the thinnest unit's halo so one shared apex fits, places the apex (own mid-elevation for a lens, on the base or top bracket for a boundary pinch, or a rising interior elevation when the caller overrides), draws each stacked unit's two pinch lines, then draws the matrix-extension flood triangles that close the wedge past the apex.

**Why it is here.** The docstring records the lens-versus-boundary rule (same matrix above and below gives a lens, otherwise a boundary pinch), the ruling-8b shared cap (use the thinnest unit's cap so the notch comb traces simple and can only shrink), and the surface-anchored rising apex (increment 18) that keeps a pinch off a dipping base band so it does not collapse to a full-width face (the B6 gap2 symptom).

.. CG-EXPLANATION-END id=function:emitLonePinch

``function pushLabelled``
-------------------------

.. CG-BLOCK id=function:pushLabelled lines=282-294

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitLonePinch.ts
   :language: typescript
   :lines: 282-294
   :lineno-match:

.. CG-EXPLANATION-START id=function:pushLabelled

**What this does.** A helper that pushes one closing line and records its colour label under the allocated id.

**Why it is here.** Every emitted line must register its label in the shared map so the face it bounds can be coloured; this centralises that pairing.

.. CG-EXPLANATION-END id=function:pushLabelled

``interface LoneIntervalContext``
---------------------------------

.. CG-BLOCK id=interface:LoneIntervalContext lines=295-333

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitLonePinch.ts
   :language: typescript
   :lines: 295-333
   :lineno-match:

.. CG-EXPLANATION-START id=interface:LoneIntervalContext

**What this does.** A type bundling one interval's inputs: the two columns, the top and base brackets, each side's matrix and lens units, and each side's tied-contact sets.

**Why it is here.** ``routeLoneSidePinch`` takes many related pieces; bundling them into one shape keeps the call readable and the pieces together.

.. CG-EXPLANATION-END id=interface:LoneIntervalContext

``function routeLoneSidePinch``
-------------------------------

.. CG-BLOCK id=function:routeLoneSidePinch lines=334-642

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitLonePinch.ts
   :language: typescript
   :lines: 334-642
   :lineno-match:

.. CG-EXPLANATION-START id=function:routeLoneSidePinch

**What this does.** Decides how a lone-side interval is filled and emits it, returning true when handled. It finds which side is lone; bails to full-width fill when the facing is too shallow (unless it is a surface-onlap candidate); routes a multi-unit stack to ``routeLoneStack``; and for a single unit, decides among the surface onlap, the mixed-bracket shared-contact onlap or lens, the clean-lateral onlap, the enclosing-matrix full-flood, and the plain lone pinch — drawing each with the right helper.

**Why it is here.** The docstring threads together many owner rulings: ruling 8a shared-contact onlap (a mixed-bracket unit riding a tied contact onlaps that tie, tip 0.5, the enclosing matrix on the untied side flooding around the notch); ruling 8 strict 2/1/0 (a mixed-bracket 0-tie unit still terminates as an own-elevation lens, but a converging facing with no tied contact stays a data void); and the enclosing-matrix full-flood versus the retired bare same-formation auto-match. The convergence gate keeps S7 gap18's real-thickness facing on its existing route.

.. CG-EXPLANATION-END id=function:routeLoneSidePinch

