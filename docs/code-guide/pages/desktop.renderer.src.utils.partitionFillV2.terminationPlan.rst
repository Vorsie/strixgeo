desktop.renderer.src.utils.partitionFillV2.terminationPlan
==========================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/partitionFillV2/terminationPlan.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/partitionFillV2/terminationPlan.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-41

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/terminationPlan.ts
   :language: typescript
   :lines: 1-41
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This module builds THE termination plan: one provenance-carrying record per gap, side, and unit, produced by a single planner from the 2/1/0 classifier and consumed by everything downstream. Each plan carries the literal correlation count, the exact tie a corr-1 onlap rides, the shape (lens, onlap, or band member), the geometry context, the default apex fraction, and the unit's own soil and body.

**Why it is here.** Owner ruling 8p ("only litho's ties no ties and filling between lines, no extrapolating downward, upward leftward or rightward follow the lines"): no subsystem may ever re-derive termination authority from soil overlap, stack walks, facing samples, face length, or depth special-cases — the plan IS the authority. The docstring stresses it emits no geometry, samples no facing column, and walks no matrix; it is the pure translation of the classifier plus geometry context into a declarative record. Pure and deterministic.

.. CG-EXPLANATION-END id=module-header

``const ELEV_EPS``
------------------

.. CG-BLOCK id=const:ELEV_EPS lines=42-54

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/terminationPlan.ts
   :language: typescript
   :lines: 42-54
   :lineno-match:

.. CG-EXPLANATION-START id=const:ELEV_EPS

**What this does.** A small metres tolerance for elevation comparisons before the 1 mm snap.

**Why it is here.** Comparisons near a contact need a tiny slack so float noise does not flip a sub-TD test the wrong way.

.. CG-EXPLANATION-END id=const:ELEV_EPS

``type PlanGeometry``
---------------------

.. CG-BLOCK id=type:PlanGeometry lines=55-57

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/terminationPlan.ts
   :language: typescript
   :lines: 55-57
   :lineno-match:

.. CG-EXPLANATION-START id=type:PlanGeometry

**What this does.** A type naming which flood covers the space past a termination's apex, chosen only from unit index, column extent, and the facing TD: interior, surface (a first unit), td (a last unit), or sub-td (entirely below the facing column's TD).

**Why it is here.** Ruling 8i(e): geometry, never a soil, decides the shape context; this parameterises which flood the termination carves into, never whether it fires.

.. CG-EXPLANATION-END id=type:PlanGeometry

``type PlanKind``
-----------------

.. CG-BLOCK id=type:PlanKind lines=58-63

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/terminationPlan.ts
   :language: typescript
   :lines: 58-63
   :lineno-match:

.. CG-EXPLANATION-START id=type:PlanKind

**What this does.** A type naming the termination shape from the literal count: lens (0), onlap (1), or band-member (2).

**Why it is here.** Ruling 8l makes the shape a direct reading of the literal correlation count, so the plan names it explicitly.

.. CG-EXPLANATION-END id=type:PlanKind

``interface TerminationPlan``
-----------------------------

.. CG-BLOCK id=interface:TerminationPlan lines=64-113

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/terminationPlan.ts
   :language: typescript
   :lines: 64-113
   :lineno-match:

.. CG-EXPLANATION-START id=interface:TerminationPlan

**What this does.** The shape of one plan for one unit into one gap on one side: the gap, the side, the unit index, the literal count, the kind, the geometry context, the exact tie reference, the default apex fraction, and the unit's own soil and body.

**Why it is here.** The docstring pins each field to a ruling: the count is verbatim from the classifier (8l); the tie reference is the exact provenance the corr-1 onlap rides, never null at corr 1 (a corr-1 with a null tie cannot follow the actual tie); the apex is the ruling-8b-rev default (0.45 for a lens, 0.5 for an onlap) with the collision cap left to the emitter; and the soil is the litho the wedge carries to its apex and NOT one point past it (ruling 8n).

.. CG-EXPLANATION-END id=interface:TerminationPlan

``function resolveCorr1TieRef``
-------------------------------

.. CG-BLOCK id=function:resolveCorr1TieRef lines=114-157

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/terminationPlan.ts
   :language: typescript
   :lines: 114-157
   :lineno-match:

.. CG-EXPLANATION-START id=function:resolveCorr1TieRef

**What this does.** Resolves a corr-1 unit-side's tie into an exact reference, in priority order: the classifier's own top or base tie reference, else a bridge (jump-tie) anchor resolved into the underlying tie, else the implicit top-band reference as a last resort.

**Why it is here.** Ruling 8p: a corr-1 plan must always carry a real tie to follow. The docstring records the bridge case (a jump tie anchored on this unit's contact but not an adjacent-column edge, so the classifier left the reference null — the F5 sub-TD hole) and guarantees the plan is never "corr=1 with a null reference".

.. CG-EXPLANATION-END id=function:resolveCorr1TieRef

``function findBridgeTie``
--------------------------

.. CG-BLOCK id=function:findBridgeTie lines=158-187

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/terminationPlan.ts
   :language: typescript
   :lines: 158-187
   :lineno-match:

.. CG-EXPLANATION-START id=function:findBridgeTie

**What this does.** Finds the jump tie whose near endpoint sits on a unit's contact in a gap, via two provenance routes: a DIRECT match on the unit's own contact, or a DERIVED-base match where a top jump-tie on the unit below shares this unit's base contact.

**Why it is here.** The derived-base route exists because a top anchor on the unit below registers this unit's base as anchored, but the jump-tie endpoint lives on the neighbour's top, so a direct match finds nothing (the real CS1 gap22 silt, the F5 hole). Both routes mirror the classifier's own tie-reference logic so the two agree.

.. CG-EXPLANATION-END id=function:findBridgeTie

``function planGeometry``
-------------------------

.. CG-BLOCK id=function:planGeometry lines=188-207

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/terminationPlan.ts
   :language: typescript
   :lines: 188-207
   :lineno-match:

.. CG-EXPLANATION-START id=function:planGeometry

**What this does.** Returns a unit-side's geometry context: sub-td wins when the unit is entirely below the facing TD, otherwise a first unit is surface, a last unit is td, and anything else (or a single-unit column) is interior.

**Why it is here.** Ruling 8i(e): the context is chosen from index, extent, and facing TD only, never a soil. Sub-td wins because such a unit carves into the deep-to-deep substrate, not the surface or TD boundary lines.

.. CG-EXPLANATION-END id=function:planGeometry

``function planSide``
---------------------

.. CG-BLOCK id=function:planSide lines=208-274

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/terminationPlan.ts
   :language: typescript
   :lines: 208-274
   :lineno-match:

.. CG-EXPLANATION-START id=function:planSide

**What this does.** Builds the plans for one side of one gap: it runs the classifier for the side, finds the facing column's TD, and for each unit assembles its count, kind, geometry context, tie reference (only for a corr-1), and default apex, packaging them into plan records.

**Why it is here.** It reads the classifier and the geometry context ONLY — no facing sample, no matrix walk (ruling 8p) — so the plan's authority is exactly the classifier plus geometry, nothing else.

.. CG-EXPLANATION-END id=function:planSide

``function buildTerminationPlans``
----------------------------------

.. CG-BLOCK id=function:buildTerminationPlans lines=275-300

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/terminationPlan.ts
   :language: typescript
   :lines: 275-300
   :lineno-match:

.. CG-EXPLANATION-START id=function:buildTerminationPlans

**What this does.** The planner: it produces one plan per gap, side, and unit for the whole section, iterating column-first — each column looks right into its own gap and left into the previous one.

**Why it is here.** It iterates column-first (ruling 8k, columns are ground truth) so the plans mirror the sweep's own iteration frame, with the gap only a look-direction. The docstring notes that building the plan here while nothing consumes it yet keeps the flag-off and flag-on output byte-identical this increment.

.. CG-EXPLANATION-END id=function:buildTerminationPlans

