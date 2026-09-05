desktop.renderer.src.utils.geotechHierarchicalFill.constructive.fillTotality
============================================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/fillTotality.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/fillTotality.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-34

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/fillTotality.ts
   :language: typescript
   :lines: 1-34
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the module that treats residual ground on a banded gap as a defect. It imports the gap-fill types and the region-area helper.

**Why it is here.** The docstring records that until the least-dense ruling of 2026-08-26 the fill was allowed to hand ground back unanswered as 'correlate me' hatch. With that last hole closed, the fill is total on any gap the law can speak about, so leftover ground there is now a symptom this module names by name rather than a silent patch of hatch the owner finds with his eyes. It is deliberately silent where no banded run spans the gap — an un-divided borehole shows visibly empty ground (owner 2026-08-15) — because a tripwire that cried wolf on that would be switched off within a week.

.. CG-EXPLANATION-END id=module-header

``interface TotalityViolation``
-------------------------------

.. CG-BLOCK id=interface:TotalityViolation lines=35-51

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/fillTotality.ts
   :language: typescript
   :lines: 35-51
   :lineno-match:

.. CG-EXPLANATION-START id=interface:TotalityViolation

**What this does.** One gap that kept ground the law should have owned: the frame gap it stands on, how many loops were left unanswered, and how much cover they hold in square metres.

**Why it is here.** It is the report shape the engineer reads to find the offending gap.

.. CG-EXPLANATION-END id=interface:TotalityViolation

``function totalityViolationOf``
--------------------------------

.. CG-BLOCK id=function:totalityViolationOf lines=52-61

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/fillTotality.ts
   :language: typescript
   :lines: 52-61
   :lineno-match:

.. CG-EXPLANATION-START id=function:totalityViolationOf

**What this does.** Returns a violation, or nothing: nothing when the gap has no run or no residual, otherwise the residual face count and total area.

**Why it is here.** Only a gap with a banded run should be total, so a gap with no run is out of scope; where a run does span it, the residual area is summed for the report.

.. CG-EXPLANATION-END id=function:totalityViolationOf

