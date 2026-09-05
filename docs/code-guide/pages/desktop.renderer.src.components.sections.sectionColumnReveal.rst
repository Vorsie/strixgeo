desktop.renderer.src.components.sections.sectionColumnReveal
============================================================

.. CG-PAGE source=desktop/src/renderer/src/components/sections/sectionColumnReveal.ts complete=true

*Source file:* ``desktop/src/renderer/src/components/sections/sectionColumnReveal.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-18

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/sectionColumnReveal.ts
   :language: typescript
   :lines: 1-18
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Defines the contract by which something outside the section canvas asks the canvas to bring a pair of columns into view. The caller names investigations and an optional landing marker; it never names a position, an index, or a column-list slot.

**Why it is here.** It carries the same rule, and guards against the same past bug, as ``resolveColumnReveal``: where a column is drawn is known only to the surface that drew it. ``SectionPanel`` implements the contract because it owns the visible-column list and the pan, and ``SectionsCanvas`` holds the implementation and passes the outcome up.

.. CG-EXPLANATION-END id=module-header

``interface SectionColumnRevealRequest``
----------------------------------------

.. CG-BLOCK id=interface:SectionColumnRevealRequest lines=19-51

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/sectionColumnReveal.ts
   :language: typescript
   :lines: 19-51
   :lineno-match:

.. CG-EXPLANATION-START id=interface:SectionColumnRevealRequest

**What this does.** What to bring on screen, named the only way the caller can name it: the investigation ids that must all be drawn, plus three optional landing markers: a correlation edge to flash, a single column to pulse, or a gap (named by its two bounding investigations) to pulse.

**Why it is here.** The column pulse serves the Build pre-flight's one-click visit (owner ruling 2026-08-26: make it so that user can go to those test through one click), where there is no tie to mark, only a test to subdivide. The gap marker belongs to the ground between the columns, not to either column, and the panel resolves the pair against the same live layout it just centred, so even a very narrow gap gets a visible marker without an index or an X coordinate crossing the surface boundary.

.. CG-EXPLANATION-END id=interface:SectionColumnRevealRequest

``interface SectionColumnRevealResult``
---------------------------------------

.. CG-BLOCK id=interface:SectionColumnRevealResult lines=52-66

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/sectionColumnReveal.ts
   :language: typescript
   :lines: 52-66
   :lineno-match:

.. CG-EXPLANATION-START id=interface:SectionColumnRevealResult

**What this does.** What the section view did, or could not do, with the request: whether every requested column was drawn and the view centred on them, and the ids the section is NOT drawing.

**Why it is here.** It returns ids only, deliberately: the panel is the authority on whether a column is drawn, and the shell is the authority on why it is not, since the shell can see the project-level manifest and removed-set gates that never reach the panel. Splitting it this way means the two can never contradict each other.

.. CG-EXPLANATION-END id=interface:SectionColumnRevealResult

``type SectionColumnRevealFn``
------------------------------

.. CG-BLOCK id=type:SectionColumnRevealFn lines=67-69

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/sectionColumnReveal.ts
   :language: typescript
   :lines: 67-69
   :lineno-match:

.. CG-EXPLANATION-START id=type:SectionColumnRevealFn

**What this does.** The type of the panel-side function that answers a reveal request and returns the result.

**Why it is here.** It is the implementation ``SectionPanel`` publishes upward so the shell can call it.

.. CG-EXPLANATION-END id=type:SectionColumnRevealFn

