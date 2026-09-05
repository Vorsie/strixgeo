desktop.renderer.src.utils.lostTieMessage
=========================================

.. CG-PAGE source=desktop/src/renderer/src/utils/lostTieMessage.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/lostTieMessage.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-10

.. literalinclude:: ../../../desktop/src/renderer/src/utils/lostTieMessage.ts
   :language: typescript
   :lines: 1-10
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The opening comment. This file holds the wording for the message shown when some accepted packing ties could not be carried across a rebuild of the model.

**Why it is here.** The comment records the audit finding (2026-08-02) that the old toast said "See the console for which", but a packaged build strips debug logging and its DevTools console is closed, so that pointer was unreachable. The engine now returns a list of the lost ties (investigation name and depth range per end), and this module turns them into the one sentence that both geotech rebuild verbs, Subdivide and Divide-boreholes, show — so the two can never word it differently.

.. CG-EXPLANATION-END id=module-header

``const MAX_NAMED_LOST_TIES``
-----------------------------

.. CG-BLOCK id=const:MAX_NAMED_LOST_TIES lines=11-32

.. literalinclude:: ../../../desktop/src/renderer/src/utils/lostTieMessage.ts
   :language: typescript
   :lines: 11-32
   :lineno-match:

.. CG-EXPLANATION-START id=const:MAX_NAMED_LOST_TIES

**What this does.** How many lost ties the message names in full before it just counts the rest: three.

**Why it is here.** Naming a handful and then counting the remainder keeps a long list readable in a toast.

.. CG-EXPLANATION-END id=const:MAX_NAMED_LOST_TIES

``function lostTieMessage``
---------------------------

.. CG-BLOCK id=function:lostTieMessage lines=33-49

.. literalinclude:: ../../../desktop/src/renderer/src/utils/lostTieMessage.ts
   :language: typescript
   :lines: 33-49
   :lineno-match:

.. CG-EXPLANATION-START id=function:lostTieMessage

**What this does.** Builds the toast text for a set of lost ties: a lead sentence with the count and correct singular/plural wording, then either a pointer to the server log when no detail is available, or up to three named ties followed by an "(and N more)" tail.

**Why it is here.** The docstring records that when the response comes from an older engine that predates the detail field, the message honestly degrades to the count plus the server-log pointer rather than inventing detail it does not have. A comment records that the remainder is counted off the label list, not off the reported count, so if the engine ever sent fewer labels than losses, the message will not hide the gap by claiming "and 0 more".

.. CG-EXPLANATION-END id=function:lostTieMessage

