desktop.renderer.src.components.sections.tieVisitNav
====================================================

.. CG-PAGE source=desktop/src/renderer/src/components/sections/tieVisitNav.ts complete=true

*Source file:* ``desktop/src/renderer/src/components/sections/tieVisitNav.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-26

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/tieVisitNav.ts
   :language: typescript
   :lines: 1-26
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A pure helper that decides which item a section-editor find-the-next-one chip visits next. The comment records the two owner asks it serves.

**Why it is here.** Owner ask 2026-08-23, for the crossing-tie warning chip: make that clickable so it zooms to the first one, and then when it is resolved it takes the second one. Owner ask 2026-08-25, for the geotech pending-tie chip: why do not we make that clickable so it highlights the tie. Same walk, same wrap, same stale-index problem, so it is one function per the project's extract-on-the-second-copy rule.

.. CG-EXPLANATION-END id=module-header

``function nextVisitIndex``
---------------------------

.. CG-BLOCK id=function:nextVisitIndex lines=27-35

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/tieVisitNav.ts
   :language: typescript
   :lines: 27-35
   :lineno-match:

.. CG-EXPLANATION-START id=function:nextVisitIndex

**What this does.** Returns the next index to visit, given the last one visited and how many items the section currently has. It wraps at the end and clamps a stale index back to the start, or returns nothing when there is nothing left.

**Why it is here.** Resolving an item shrinks the list under the caller's stored index, so a press must still land on something that exists; wrapping means a chip never dead-ends, and restarting at the first item also makes a single remaining item re-centre on a repeat press instead of going blank.

.. CG-EXPLANATION-END id=function:nextVisitIndex

