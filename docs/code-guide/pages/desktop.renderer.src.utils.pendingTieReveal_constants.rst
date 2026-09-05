desktop.renderer.src.utils.pendingTieReveal_constants
=====================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/pendingTieReveal_constants.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/pendingTieReveal_constants.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-16

.. literalinclude:: ../../../desktop/src/renderer/src/utils/pendingTieReveal_constants.ts
   :language: typescript
   :lines: 1-16
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This file holds the fixed text and numbers for the pending-tie callout. The block covers the module note and the first constant's documentation.

**Why it is here.** The comment records that these constants live in their own file, beside the module that uses them, following the project's constants-in-a-dedicated-file convention (CLAUDE.md) rather than sitting at the top of the logic file.

.. CG-EXPLANATION-END id=module-header

``const PENDING_TIE_DEPTH_DECIMALS``
------------------------------------

.. CG-BLOCK id=const:PENDING_TIE_DEPTH_DECIMALS lines=17-24

.. literalinclude:: ../../../desktop/src/renderer/src/utils/pendingTieReveal_constants.ts
   :language: typescript
   :lines: 17-24
   :lineno-match:

.. CG-EXPLANATION-START id=const:PENDING_TIE_DEPTH_DECIMALS

**What this does.** The number of decimals shown on the band depths in the callout: two. The block also carries the documentation for the separator constant below.

**Why it is here.** The comment records that two decimals match the precision the geotech band editor and the packing inspector already print, so the engineer can match the sentence against the band list by eye without converting anything.

.. CG-EXPLANATION-END id=const:PENDING_TIE_DEPTH_DECIMALS

``const TIE_ENDPOINT_SEPARATOR``
--------------------------------

.. CG-BLOCK id=const:TIE_ENDPOINT_SEPARATOR lines=25-33

.. literalinclude:: ../../../desktop/src/renderer/src/utils/pendingTieReveal_constants.ts
   :language: typescript
   :lines: 25-33
   :lineno-match:

.. CG-EXPLANATION-START id=const:TIE_ENDPOINT_SEPARATOR

**What this does.** The symbol placed between the two ends of a tie in the callout: a double-headed arrow, ↔.

**Why it is here.** The comment records the choice of a double-headed arrow rather than a dash: a tie is symmetric, and the section view already uses a plain en dash for the depth ranges on either side of it.

.. CG-EXPLANATION-END id=const:TIE_ENDPOINT_SEPARATOR

``const PENDING_TIE_TOAST_KEY``
-------------------------------

.. CG-BLOCK id=const:PENDING_TIE_TOAST_KEY lines=34-43

.. literalinclude:: ../../../desktop/src/renderer/src/utils/pendingTieReveal_constants.ts
   :language: typescript
   :lines: 34-43
   :lineno-match:

.. CG-EXPLANATION-START id=const:PENDING_TIE_TOAST_KEY

**What this does.** The key the chip's toast is filed under, so each new answer replaces the previous one.

**Why it is here.** The comment records that every press replaces the previous answer where it stands rather than stacking another — an engineer cycling through several pending ties wants the answers in one place, not a growing column of them.

.. CG-EXPLANATION-END id=const:PENDING_TIE_TOAST_KEY

``const PENDING_TIE_NONE_HERE``
-------------------------------

.. CG-BLOCK id=const:PENDING_TIE_NONE_HERE lines=44-47

.. literalinclude:: ../../../desktop/src/renderer/src/utils/pendingTieReveal_constants.ts
   :language: typescript
   :lines: 44-47
   :lineno-match:

.. CG-EXPLANATION-START id=const:PENDING_TIE_NONE_HERE

**What this does.** The sentence a press shows when the open section carries no pending tie — telling the engineer the count is the model total and to open the section named in the tooltip.

**Why it is here.** The comment records that this is reachable because the chip stays visible while the whole MODEL still has pending ties even after this section is clear (owner ruling 2026-08-15); the sentence keeps the press honest if it is somehow reached.

.. CG-EXPLANATION-END id=const:PENDING_TIE_NONE_HERE

``const PENDING_TIE_NO_CANVAS``
-------------------------------

.. CG-BLOCK id=const:PENDING_TIE_NO_CANVAS lines=48-49

.. literalinclude:: ../../../desktop/src/renderer/src/utils/pendingTieReveal_constants.ts
   :language: typescript
   :lines: 48-49
   :lineno-match:

.. CG-EXPLANATION-START id=const:PENDING_TIE_NO_CANVAS

**What this does.** The sentence a press shows before any cross-section canvas has been opened.

**Why it is here.** The comment records that finding a pending tie needs the section it sits on to be on screen, so the message asks the engineer to open a cross-section first.

.. CG-EXPLANATION-END id=const:PENDING_TIE_NO_CANVAS

