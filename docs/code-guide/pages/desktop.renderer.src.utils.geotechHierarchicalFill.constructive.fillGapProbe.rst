desktop.renderer.src.utils.geotechHierarchicalFill.constructive.fillGapProbe
============================================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/fillGapProbe.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/fillGapProbe.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-13

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/fillGapProbe.ts
   :language: typescript
   :lines: 1-13
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens a dormant diagnostic sink that records the fill's own decisions, one entry per family-and-gap run: per band the emit and which contacts counted as tied, the lines fed to the arrangement, and per face who owns it and on which tier. It costs nothing while dormant.

**Why it is here.** Owner 2026-08-21, on a fix that changed the render but not the scene he circled: 'instrument and try again'. The scene probes read the output; this reads the decisions behind it. It is enabled only by the construct-probe diagnostic test.

.. CG-EXPLANATION-END id=module-header

``interface ProbeConstruct``
----------------------------

.. CG-BLOCK id=interface:ProbeConstruct lines=14-32

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/fillGapProbe.ts
   :language: typescript
   :lines: 14-32
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ProbeConstruct

**What this does.** One band's construct decision as the kernel and the line phase saw it: the layer, column, top and base, the emit, the two tied flags, whether it extends to the far column, and where it terminates in the gap's own fraction space.

**Why it is here.** The termination fraction is read by the onlap-closure tripwire: a vertical face there is a wedge that was cut instead of closed — 'it terminates at 0.5 Distance approximately' — while one anywhere else is a different kind of boundary.

.. CG-EXPLANATION-END id=interface:ProbeConstruct

``interface ProbeFace``
-----------------------

.. CG-BLOCK id=interface:ProbeFace lines=33-40

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/fillGapProbe.ts
   :language: typescript
   :lines: 33-40
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ProbeFace

**What this does.** One labelled face: who owns it, its role (construct, fill or residual), the sample point used, and the ring.

**Why it is here.** It records how each loop was decided, which is the evidence the face-level audit reads.

.. CG-EXPLANATION-END id=interface:ProbeFace

``interface ProbeTie``
----------------------

.. CG-BLOCK id=interface:ProbeTie lines=41-49

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/fillGapProbe.ts
   :language: typescript
   :lines: 41-49
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ProbeTie

**What this does.** One resolved tie of the run as the constructs see it: its key and both endpoints.

**Why it is here.** It records the actual lines the constructs worked from, so the decisions can be traced back to their inputs.

.. CG-EXPLANATION-END id=interface:ProbeTie

``interface ProbeEntry``
------------------------

.. CG-BLOCK id=interface:ProbeEntry lines=50-67

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/fillGapProbe.ts
   :language: typescript
   :lines: 50-67
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ProbeEntry

**What this does.** One family-and-gap run: the gap, the cover layers naming the family, whether it is a stacked seam, and the constructs, ties, lines and faces of that run.

**Why it is here.** The stacked-seam flag is carried because a vertical step at a stacked seam is the ruling itself (owner 2026-08-25, 'the different height is acceptable'), so the onlap-closure tripwire skips these runs rather than reporting the owner's own accepted geometry as a defect.

.. CG-EXPLANATION-END id=interface:ProbeEntry

``const fillGapProbe``
----------------------

.. CG-BLOCK id=const:fillGapProbe lines=68-71

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/fillGapProbe.ts
   :language: typescript
   :lines: 68-71
   :lineno-match:

.. CG-EXPLANATION-START id=const:fillGapProbe

**What this does.** The sink object itself: an enabled flag and an entries array, which the diagnostic test flips on and drains.

**Why it is here.** A single shared object the fill writes to only when the test enables it keeps the instrument free when it is off.

.. CG-EXPLANATION-END id=const:fillGapProbe

