desktop.renderer.src.components.sections.joinPick
=================================================

.. CG-PAGE source=desktop/src/renderer/src/components/sections/joinPick.ts complete=true

*Source file:* ``desktop/src/renderer/src/components/sections/joinPick.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-35

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/joinPick.ts
   :language: typescript
   :lines: 1-35
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the file: it resolves a 'Join with…' target click into a commit, an advisory, or a no-op. It is pure and shared by the partition overlay's armed left-click (debt #278, geotech axis). It imports the region-body resolver.

**Why it is here.** The comment records the Join verb (owner ruling 2026-08-31) arms on one body, then the engineer clicks the other body to state 'these two ARE the same body'. Like the retired Separate verb, the pick resolves through the region's layer ids — the label-independent identity the recompute already uses — never a region label. The one extra rule over Separate is that a body can only be one mass, so a different packing class is refused with a cross-class advisory rather than committed, since the backend would refuse it anyway.

.. CG-EXPLANATION-END id=module-header

``function firstLayerStampedToBody``
------------------------------------

.. CG-BLOCK id=function:firstLayerStampedToBody lines=36-47

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/joinPick.ts
   :language: typescript
   :lines: 36-47
   :lineno-match:

.. CG-EXPLANATION-START id=function:firstLayerStampedToBody

**What this does.** Returns the first of the region's layer ids whose body stamp equals a given body id, or nothing when none of them belong to that body.

**Why it is here.** The docstring records this is the deterministic anchor rule: an anchor is any accepted layer of the body, and picking the first one keeps the choice stable so the same body always joins through the same anchor. It moved here when the Separate verb was retired (the body-verb simplification, 2026-09-01).

.. CG-EXPLANATION-END id=function:firstLayerStampedToBody

``type JoinPick``
-----------------

.. CG-BLOCK id=type:JoinPick lines=48-64

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/joinPick.ts
   :language: typescript
   :lines: 48-64
   :lineno-match:

.. CG-EXPLANATION-START id=type:JoinPick

**What this does.** Names one clicked-region outcome while a Join is armed — same (a self-join, refused), unresolvable (no single body could be resolved), cross-class (a distinct but different-mass body, with a note of whether the packing or the lithology differs), or commit (a distinct same-class body to join).

**Why it is here.** The docstring records that cross-class names what differs so the advisory picks the right copy (owner ruling 2026-09-01): packing when the two share a soil but carry different NAD classes, litho when the soils themselves differ or a soil is unknown.

.. CG-EXPLANATION-END id=type:JoinPick

``type JoinNotice``
-------------------

.. CG-BLOCK id=type:JoinNotice lines=65-100

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/joinPick.ts
   :language: typescript
   :lines: 65-100
   :lineno-match:

.. CG-EXPLANATION-START id=type:JoinNotice

**What this does.** Names the non-committing outcomes — everything the arm advises on without disarming, that is, every ``JoinPick`` except commit.

**Why it is here.** It lets the caller handle 'stay armed and advise' cases apart from the committing case.

.. CG-EXPLANATION-END id=type:JoinNotice

``function resolveJoinPick``
----------------------------

.. CG-BLOCK id=function:resolveJoinPick lines=101-127

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/joinPick.ts
   :language: typescript
   :lines: 101-127
   :lineno-match:

.. CG-EXPLANATION-START id=function:resolveJoinPick

**What this does.** Classifies a clicked region against the armed body: a different body of the same class commits the join; the same body or a region resolving to no single body stays armed; a different-class body is refused with a cross-class advisory.

**Why it is here.** The docstring records that when either side's class is unknown (a map race) the client does not block — it commits and lets the write guard be the authority, which can only ever safely widen, because a label difference implies a class difference so a missing class never hides a real cross-class the backend would then accept.

.. CG-EXPLANATION-END id=function:resolveJoinPick

