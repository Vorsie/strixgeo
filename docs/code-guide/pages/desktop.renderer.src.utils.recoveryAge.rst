desktop.renderer.src.utils.recoveryAge
======================================

.. CG-PAGE source=desktop/src/renderer/src/utils/recoveryAge.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/recoveryAge.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-13

.. literalinclude:: ../../../desktop/src/renderer/src/utils/recoveryAge.ts
   :language: typescript
   :lines: 1-13
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This file turns the timestamp on a recovery file into a short human phrase describing when it was written. The reference "now" can be passed in rather than always read from the clock. The block covers the module comment and the month-names documentation.

**Why it is here.** The comment records the question the phrasing has to answer: the recovery prompt and the start screen's "Recovered work" list both need to say whether a file is from the session the engineer just lost or from something abandoned last week. A plain duration ("3 hours ago") answers that badly across a lunch break or an overnight, but a wall time anchored to a calendar day answers it well. It is pure, and the injectable "now" lets the phrasing be tested without freezing the real clock.

.. CG-EXPLANATION-END id=module-header

``const MONTHS``
----------------

.. CG-BLOCK id=const:MONTHS lines=14-29

.. literalinclude:: ../../../desktop/src/renderer/src/utils/recoveryAge.ts
   :language: typescript
   :lines: 14-29
   :lineno-match:

.. CG-EXPLANATION-START id=const:MONTHS

**What this does.** The list of short month names, Jan through Dec. The block ends with the documentation for the zero-pad helper below.

**Why it is here.** The comment records they are written out here rather than taken from the machine's locale, so the phrase is the same on every machine and can be tested without pulling in a locale library.

.. CG-EXPLANATION-END id=const:MONTHS

``function pad2``
-----------------

.. CG-BLOCK id=function:pad2 lines=30-34

.. literalinclude:: ../../../desktop/src/renderer/src/utils/recoveryAge.ts
   :language: typescript
   :lines: 30-34
   :lineno-match:

.. CG-EXPLANATION-START id=function:pad2

**What this does.** Pads a number to two digits, turning 7 into "07".

**Why it is here.** It keeps the clock part of the phrase two digits wide so times line up and read as clock times.

.. CG-EXPLANATION-END id=function:pad2

``function calendarDayDelta``
-----------------------------

.. CG-BLOCK id=function:calendarDayDelta lines=35-52

.. literalinclude:: ../../../desktop/src/renderer/src/utils/recoveryAge.ts
   :language: typescript
   :lines: 35-52
   :lineno-match:

.. CG-EXPLANATION-START id=function:calendarDayDelta

**What this does.** Counts the whole calendar days from one date to another, ignoring the time of day. The block ends with the documentation for the main formatting function below.

**Why it is here.** Comparing calendar days rather than elapsed hours is what makes "today" and "yesterday" correct across a midnight boundary — 11 pm and 1 am are one day apart even though only two hours passed.

.. CG-EXPLANATION-END id=function:calendarDayDelta

``function formatRecoveryAge``
------------------------------

.. CG-BLOCK id=function:formatRecoveryAge lines=53-62

.. literalinclude:: ../../../desktop/src/renderer/src/utils/recoveryAge.ts
   :language: typescript
   :lines: 53-62
   :lineno-match:

.. CG-EXPLANATION-START id=function:formatRecoveryAge

**What this does.** Describes when a recovery file was written as day-relative wall time — "today 14:32", "yesterday 23:05", or "12 Jul 08:07" for anything older — and returns "an unknown time" when the stamp cannot be read.

**Why it is here.** The docstring records that callers prefix the phrase with "from", so it carries no preposition of its own and can also sit alone in a list; and that a corrupt timestamp only costs the age line, never the recovery offer itself — the engineer is still offered the file to restore (docs/design/autosave-recovery.md).

.. CG-EXPLANATION-END id=function:formatRecoveryAge

