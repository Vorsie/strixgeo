desktop.renderer.src.utils.divideBoreholesToast
===============================================

.. CG-PAGE source=desktop/src/renderer/src/utils/divideBoreholesToast.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/divideBoreholesToast.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-19

.. literalinclude:: ../../../desktop/src/renderer/src/utils/divideBoreholesToast.ts
   :language: typescript
   :lines: 1-19
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A comment introducing the helper that builds the success-toast sentence for a "Divide boreholes" run, and the import of the divide response shape.

**Why it is here.** The comment records why the message is extracted (testable, and keeps the god-hook from growing, debt #201) and the owner ruling (2026-08-14) that the divide silently deletes bridged CPT-to-CPT ties whose borehole chain arrived accepted — a silent database change that the toast must own, because tie lines vanishing without a word would read as lost work.

.. CG-EXPLANATION-END id=module-header

``function divideBoreholesToastMessage``
----------------------------------------

.. CG-BLOCK id=function:divideBoreholesToastMessage lines=20-44

.. literalinclude:: ../../../desktop/src/renderer/src/utils/divideBoreholesToast.ts
   :language: typescript
   :lines: 20-44
   :lineno-match:

.. CG-EXPLANATION-START id=function:divideBoreholesToastMessage

**What this does.** Builds the sentence for a completed divide: it reads the counts from the result — how many boreholes were split, how many stayed single-band, how many accepted ties were kept, how many jump ties were replaced by the borehole chain, and how many crossing ties were auto-deleted — and assembles them, adding each optional clause only when its count is above zero and pluralising as needed. The wording opens with "Boreholes" or "Borehole" depending on whether it was a whole-model run.

**Why it is here.** The docstring records that the tie fields are optional so a backend predating them still yields a complete sentence, and the comment records that the crossing-span deletions are silent in the database (owner ruling 2026-08-24) so the toast owns their count under the same contract as the jump ties.

.. CG-EXPLANATION-END id=function:divideBoreholesToastMessage

