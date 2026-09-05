desktop.renderer.src.utils.partitionFillV2.declaredMeetings
===========================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/partitionFillV2/declaredMeetings.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/partitionFillV2/declaredMeetings.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-25

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/declaredMeetings.ts
   :language: typescript
   :lines: 1-25
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This file lets a parent litho model declare that two masses MEET on a gap -- a boundary, not a correlation. Inside a per-family geotech run the only ties the engine sees are the packing ties, but the family itself is a litho chain and litho approval carries down; so a pair whose parent litho units are tied is declared to meet even when their own packing tie is absent (deleted by hand, or not yet derived).

**Why it is here.** The docstring stresses what it does NOT do: it never bands the two masses -- a declared meeting is a boundary where they meet and keep their own classes, so a tie the engineer deleted is never resurrected as a class band. It is process-global (like ``forceLensUnits``) because the v2 engine takes only columns, edges and spacing and has no channel for a caller's extra context, and a caller must clear it in a ``finally`` so it cannot leak into the next run. Empty by default, so every existing path is byte-identical. Pure module.

.. CG-EXPLANATION-END id=module-header

``interface DeclaredMeeting``
-----------------------------

.. CG-BLOCK id=interface:DeclaredMeeting lines=26-31

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/declaredMeetings.ts
   :language: typescript
   :lines: 26-31
   :lineno-match:

.. CG-EXPLANATION-START id=interface:DeclaredMeeting

**What this does.** A type for one declared meeting on one gap: the gap index and the sets of band ids on each side whose parent units the parent model ties.

**Why it is here.** It carries exactly which masses on each side are declared to meet.

.. CG-EXPLANATION-END id=interface:DeclaredMeeting

``let DECLARED``
----------------

.. CG-BLOCK id=let:DECLARED lines=32-34

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/declaredMeetings.ts
   :language: typescript
   :lines: 32-34
   :lineno-match:

.. CG-EXPLANATION-START id=let:DECLARED

**What this does.** The process-global list of declared meetings for the current run, empty by default.

**Why it is here.** The v2 engine has no argument to pass this through, so it lives as a cleared-between-runs global.

.. CG-EXPLANATION-END id=let:DECLARED

``function setDeclaredMeetings``
--------------------------------

.. CG-BLOCK id=function:setDeclaredMeetings lines=35-41

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/declaredMeetings.ts
   :language: typescript
   :lines: 35-41
   :lineno-match:

.. CG-EXPLANATION-START id=function:setDeclaredMeetings

**What this does.** Installs the declared meetings for one run and returns the previous set so the caller can restore it.

**Why it is here.** The install-and-restore pattern lets a caller nest a run without losing the outer context.

.. CG-EXPLANATION-END id=function:setDeclaredMeetings

``function clearDeclaredMeetings``
----------------------------------

.. CG-BLOCK id=function:clearDeclaredMeetings lines=42-52

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/declaredMeetings.ts
   :language: typescript
   :lines: 42-52
   :lineno-match:

.. CG-EXPLANATION-START id=function:clearDeclaredMeetings

**What this does.** Empties the declared-meeting list (the default state).

**Why it is here.** The mandatory reset a caller runs in a ``finally`` so a run's context never leaks to the next.

.. CG-EXPLANATION-END id=function:clearDeclaredMeetings

``function isDeclaredMeeting``
------------------------------

.. CG-BLOCK id=function:isDeclaredMeeting lines=53-64

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/declaredMeetings.ts
   :language: typescript
   :lines: 53-64
   :lineno-match:

.. CG-EXPLANATION-START id=function:isDeclaredMeeting

**What this does.** Answers whether two given masses are declared to meet on a gap, by scanning the installed meetings for a matching gap where the left set holds the left mass and the right set holds the right.

**Why it is here.** The predicate ``emitEnclosingFlood`` asks before drawing the mid-gap vertical fence; an empty list or missing ids answer false, keeping the default byte-identical.

.. CG-EXPLANATION-END id=function:isDeclaredMeeting

