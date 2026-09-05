desktop.renderer.src.shell.stages.sections.useSectionColumnRevealBridge
=======================================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/sections/useSectionColumnRevealBridge.ts complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/sections/useSectionColumnRevealBridge.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-38

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/useSectionColumnRevealBridge.ts
   :language: typescript
   :lines: 1-38
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Header for the glue hook that publishes the section panel's 'bring these columns on screen' function onto the shell-facing bridge box, with one rule: WHAT gets marked follows from HOW MANY columns were named.

**Why it is here.** One column — the Build pre-flight's deep-link — is a test the engineer must subdivide, so the column itself gets the pulse. Two columns — the gapless-build report's 'Show me' — name a GAP, and the finding is the ground between them, so the span's midpoint is centred and the span itself pulsed; pulsing either end would claim the defect is on a column when it is not.

.. CG-EXPLANATION-END id=module-header

``function useSectionColumnRevealBridge``
-----------------------------------------

.. CG-BLOCK id=function:useSectionColumnRevealBridge lines=39-67

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/useSectionColumnRevealBridge.ts
   :language: typescript
   :lines: 39-67
   :lineno-match:

.. CG-EXPLANATION-START id=function:useSectionColumnRevealBridge

**What this does.** Registers, while the panel is mounted, a shell-facing reveal implementation that forwards to the panel's own reveal function — flashing the single column for one id, or the gap span for two — and clears the box on unmount.

**Why it is here.** It lives outside the giant canvas and outside the pending-tie reveal hook, which answers a different question (which of several pending ties comes next). A caller that finds the box null (no panel mounted) gets 'not revealed' back rather than a crash.

.. CG-EXPLANATION-END id=function:useSectionColumnRevealBridge

