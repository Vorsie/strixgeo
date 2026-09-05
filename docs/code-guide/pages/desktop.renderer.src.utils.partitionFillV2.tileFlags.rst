desktop.renderer.src.utils.partitionFillV2.tileFlags
====================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/partitionFillV2/tileFlags.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/partitionFillV2/tileFlags.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-23

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/tileFlags.ts
   :language: typescript
   :lines: 1-23
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This module holds the single process-wide flag that switches the interval tiler between its old thickness-weighted seam model and the new per-unit terminations-first path.

**Why it is here.** The docstring explains why it is a module-level flag rather than a per-section switch: the engine's public entry point carries no section identity (only columns, edges, and along-metres), so the cut-over is developed and guarded one section's shapes at a time by flipping this flag inside the per-section oracle and reading that section's rows, while the default output stays on the old path until every section is correct (ruling 8c). It is made runtime-mutable so a test can toggle it without a rebuild. Pure module — but a test that flips it must restore it so it never leaks across the byte-identical checks.

.. CG-EXPLANATION-END id=module-header

``let TWO_SIDED_TERMINATIONS``
------------------------------

.. CG-BLOCK id=let:TWO_SIDED_TERMINATIONS lines=24-26

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/tileFlags.ts
   :language: typescript
   :lines: 24-26
   :lineno-match:

.. CG-EXPLANATION-START id=let:TWO_SIDED_TERMINATIONS

**What this does.** The process-global variable holding the flag's current value, defaulting to false.

**Why it is here.** Default off means the engine keeps the old seam-based interval tiler; flipping the default to on (then deleting the old path) is the cut-over.

.. CG-EXPLANATION-END id=let:TWO_SIDED_TERMINATIONS

``function twoSidedTerminationsEnabled``
----------------------------------------

.. CG-BLOCK id=function:twoSidedTerminationsEnabled lines=27-45

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/tileFlags.ts
   :language: typescript
   :lines: 27-45
   :lineno-match:

.. CG-EXPLANATION-START id=function:twoSidedTerminationsEnabled

**What this does.** Reads the current value of the cut-over flag.

**Why it is here.** It is the one read the rest of the engine calls, so no other module touches the raw variable.

.. CG-EXPLANATION-END id=function:twoSidedTerminationsEnabled

``function setTwoSidedTerminations``
------------------------------------

.. CG-BLOCK id=function:setTwoSidedTerminations lines=46-50

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/tileFlags.ts
   :language: typescript
   :lines: 46-50
   :lineno-match:

.. CG-EXPLANATION-START id=function:setTwoSidedTerminations

**What this does.** Sets the flag and returns its previous value.

**Why it is here.** Returning the previous value lets a test restore it in a finally block, which the docstring requires so the flag never leaks across the deterministic byte-identical checks.

.. CG-EXPLANATION-END id=function:setTwoSidedTerminations

