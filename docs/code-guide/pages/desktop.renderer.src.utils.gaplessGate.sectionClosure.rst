desktop.renderer.src.utils.gaplessGate.sectionClosure
=====================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/gaplessGate/sectionClosure.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/gaplessGate/sectionClosure.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-25

.. literalinclude:: ../../../desktop/src/renderer/src/utils/gaplessGate/sectionClosure.ts
   :language: typescript
   :lines: 1-25
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens clause 4 — the check that every section the litho frame supplies either appears in the built payload or was consented out — and imports the entry and input wire shapes.

**Why it is here.** The docstring records the deliberately narrow scope: the build already knows, in its own place, which sections the frame supplies and which reached the payload, so this module is only the pure comparison. It explicitly does NOT try to attribute a missing section to a consented exclusion, because that exclusion is applied identically to both sides before this runs, so labelling an absence as consented would be guessing — which the gate exists to refuse.

.. CG-EXPLANATION-END id=module-header

``interface FrameSectionRef``
-----------------------------

.. CG-BLOCK id=interface:FrameSectionRef lines=26-31

.. literalinclude:: ../../../desktop/src/renderer/src/utils/gaplessGate/sectionClosure.ts
   :language: typescript
   :lines: 26-31
   :lineno-match:

.. CG-EXPLANATION-START id=interface:FrameSectionRef

**What this does.** One litho-frame section named for a human-readable entry: its id and its display name.

**Why it is here.** The clause needs the name as well as the id so a finding reads without a separate lookup.

.. CG-EXPLANATION-END id=interface:FrameSectionRef

``interface SectionClosureInput``
---------------------------------

.. CG-BLOCK id=interface:SectionClosureInput lines=32-44

.. literalinclude:: ../../../desktop/src/renderer/src/utils/gaplessGate/sectionClosure.ts
   :language: typescript
   :lines: 32-44
   :lineno-match:

.. CG-EXPLANATION-START id=interface:SectionClosureInput

**What this does.** Everything clause 4 needs: whether this build supplied a litho frame at all, every section the frame supplies, and the set of section ids that actually produced a payload entry.

**Why it is here.** The ``hasFrame`` flag exists so a litho-level build, which has no frame-versus-payload asymmetry to compare, reports not-evaluated rather than a vacuous pass — the same not-a-soft-pass rule as every other clause.

.. CG-EXPLANATION-END id=interface:SectionClosureInput

``const NO_FRAME_REASON``
-------------------------

.. CG-BLOCK id=const:NO_FRAME_REASON lines=45-52

.. literalinclude:: ../../../desktop/src/renderer/src/utils/gaplessGate/sectionClosure.ts
   :language: typescript
   :lines: 45-52
   :lineno-match:

.. CG-EXPLANATION-START id=const:NO_FRAME_REASON

**What this does.** The fixed sentence used when a build has no litho frame, so clause 4 has nothing to check.

**Why it is here.** Naming it once keeps the not-evaluated explanation consistent and honest.

.. CG-EXPLANATION-END id=const:NO_FRAME_REASON

``function sectionClosure``
---------------------------

.. CG-BLOCK id=function:sectionClosure lines=53-72

.. literalinclude:: ../../../desktop/src/renderer/src/utils/gaplessGate/sectionClosure.ts
   :language: typescript
   :lines: 53-72
   :lineno-match:

.. CG-EXPLANATION-START id=function:sectionClosure

**What this does.** Computes clause 4: with no frame it returns not-evaluated; otherwise it lists every frame section whose id is not among those that produced build output, each as an entry saying the section was framed by the litho model but produced no geotech output, and passes when the list is empty.

**Why it is here.** It is the whole-build check that no framed section silently vanished from the payload — the cross-section counterpart to the per-gap 2-D clauses.

.. CG-EXPLANATION-END id=function:sectionClosure

