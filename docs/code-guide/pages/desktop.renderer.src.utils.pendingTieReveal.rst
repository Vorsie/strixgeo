desktop.renderer.src.utils.pendingTieReveal
===========================================

.. CG-PAGE source=desktop/src/renderer/src/utils/pendingTieReveal.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/pendingTieReveal.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-33

.. literalinclude:: ../../../desktop/src/renderer/src/utils/pendingTieReveal.ts
   :language: typescript
   :lines: 1-33
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This module powers the geotech "N pending here" chip. When the engineer presses that chip it should either jump to and highlight the pending packing tie, or — when the tie cannot be drawn — spell out both of its ends and the reason. This file is the pure half of that: it lists the ties, works out why a column is missing, and writes the sentence. It holds no React and no screen coordinates. The imports bring in the correlation-edge and band-row types and two copy constants.

**Why it is here.** The comment records the owner's dogfeed on 2026-08-25 — a "one pending" notice with no visible tie — and the reason it happens: the count is per section (from the tie-status endpoint's ``pending_by_section``), but the canvas draws per rendered column and shows nothing when either end's column is not on screen, so a tie can be counted yet invisible. It also records the deliberate split: turning a tie into a screen position is the render surface's own job, and an index must never cross that boundary (the establish-WHERE-before-HOW rule; see ``PartitionFillOverlay.onJumpToConflictGap``).

.. CG-EXPLANATION-END id=module-header

``interface PendingTieEndpoint``
--------------------------------

.. CG-BLOCK id=interface:PendingTieEndpoint lines=34-47

.. literalinclude:: ../../../desktop/src/renderer/src/utils/pendingTieReveal.ts
   :language: typescript
   :lines: 34-47
   :lineno-match:

.. CG-EXPLANATION-START id=interface:PendingTieEndpoint

**What this does.** A declared shape for one end of a pending tie: the band-row id it points at, the investigation it stands on (a CPT or borehole id), which of the two that is, and the band's top and base depth below the collar.

**Why it is here.** These are exactly the facts a press needs about each end — the id to key the highlight on, the investigation to name in the sentence, and the depths to print so the engineer recognises the band.

.. CG-EXPLANATION-END id=interface:PendingTieEndpoint

``interface PendingTie``
------------------------

.. CG-BLOCK id=interface:PendingTie lines=48-85

.. literalinclude:: ../../../desktop/src/renderer/src/utils/pendingTieReveal.ts
   :language: typescript
   :lines: 48-85
   :lineno-match:

.. CG-EXPLANATION-START id=interface:PendingTie

**What this does.** The shape of one proposed packing tie with both ends worked out: the correlation-edge id, its creation time, and the two resolved endpoints ``a`` and ``b``. The block ends with a long comment that introduces the list of reasons a column may be missing, formalised by the type just below.

**Why it is here.** The comment records that the edge id is what the highlight keys on and that the visit order is oldest first, so repeated presses walk through the ties in a fixed order.

.. CG-EXPLANATION-END id=interface:PendingTie

``type ColumnAbsenceCode``
--------------------------

.. CG-BLOCK id=type:ColumnAbsenceCode lines=86-96

.. literalinclude:: ../../../desktop/src/renderer/src/utils/pendingTieReveal.ts
   :language: typescript
   :lines: 86-96
   :lineno-match:

.. CG-EXPLANATION-START id=type:ColumnAbsenceCode

**What this does.** A *type* listing the allowed reasons a section is not drawing a column — from "the project no longer lists it" through model and section exclusions, falling outside the projection corridor, column focus, down to an honest "unknown".

**Why it is here.** The comment records that each value names ONE real gate in the render path, in the order those gates fire, so the sentence the engineer reads points straight at the control that would undo it.

.. CG-EXPLANATION-END id=type:ColumnAbsenceCode

``interface ColumnAbsenceInputs``
---------------------------------

.. CG-BLOCK id=interface:ColumnAbsenceInputs lines=97-114

.. literalinclude:: ../../../desktop/src/renderer/src/utils/pendingTieReveal.ts
   :language: typescript
   :lines: 97-114
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ColumnAbsenceInputs

**What this does.** The shape of one reading of every gate for a single investigation on the open section: seven yes/no facts — is it known to the project, hidden, visible after filtering, excluded by the model, excluded by the section, projecting onto the section, and is column focus on.

**Why it is here.** It separates the raw gate readings from the decision about which one to report, so the render-order logic lives in one place (the function below) rather than being scattered.

.. CG-EXPLANATION-END id=interface:ColumnAbsenceInputs

``interface ColumnAbsence``
---------------------------

.. CG-BLOCK id=interface:ColumnAbsence lines=115-120

.. literalinclude:: ../../../desktop/src/renderer/src/utils/pendingTieReveal.ts
   :language: typescript
   :lines: 115-120
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ColumnAbsence

**What this does.** The shape pairing one absent investigation id with the gate code that dropped it.

**Why it is here.** It ties the missing end to its reason so the sentence can name the end and its cause together.

.. CG-EXPLANATION-END id=interface:ColumnAbsence

``interface UndrawableTieDescription``
--------------------------------------

.. CG-BLOCK id=interface:UndrawableTieDescription lines=121-159

.. literalinclude:: ../../../desktop/src/renderer/src/utils/pendingTieReveal.ts
   :language: typescript
   :lines: 121-159
   :lineno-match:

.. CG-EXPLANATION-START id=interface:UndrawableTieDescription

**What this does.** The shape of everything the sentence-writer needs: the tie itself, a lookup from investigation id to display name (falling back to the raw id when there is no name), and the list of absent ends. The block ends with the documentation for the ``sectionPendingTies`` function below.

**Why it is here.** It gathers the three inputs the sentence needs into one bundle. The label lookup falling back to the raw id follows the translate-at-the-presentation-boundary rule — the id is always usable even when a friendly name is missing.

.. CG-EXPLANATION-END id=interface:UndrawableTieDescription

``function sectionPendingTies``
-------------------------------

.. CG-BLOCK id=function:sectionPendingTies lines=160-180

.. literalinclude:: ../../../desktop/src/renderer/src/utils/pendingTieReveal.ts
   :language: typescript
   :lines: 160-180
   :lineno-match:

.. CG-EXPLANATION-START id=function:sectionPendingTies

**What this does.** Builds the list of proposed ties on the open section, oldest first, with both ends resolved. It keeps only the not-yet-approved edges belonging to that section, resolves each end from its band row, drops any tie whose row is missing, and sorts the survivors by creation time and then id.

**Why it is here.** The docstring records the choices: it filters to unapproved edges because those are exactly what the chip counts, and to the open section because that is how the count is phrased (owner ruling 2026-08-15, every packing step follows the open section). It sorts by created-time then id so a second press lands on a different tie even when a refetch has reordered the raw list. And it drops a tie whose row is missing rather than half-describing it, because a tie the press cannot name is worse than silence.

.. CG-EXPLANATION-END id=function:sectionPendingTies

``function endpointOf``
-----------------------

.. CG-BLOCK id=function:endpointOf lines=181-212

.. literalinclude:: ../../../desktop/src/renderer/src/utils/pendingTieReveal.ts
   :language: typescript
   :lines: 181-212
   :lineno-match:

.. CG-EXPLANATION-START id=function:endpointOf

**What this does.** Turns one band row into a tie endpoint, or nothing when the row is unusable. It takes whichever of the CPT id or borehole id is set, records that as the investigation and its kind, and copies the top and base depths. The block ends with the documentation for the gate-order function below.

**Why it is here.** The comment records that a band row has an anchor XOR — exactly one of CPT id or borehole id is set — so if neither is present the row is unusable and returns nothing, which the caller then drops.

.. CG-EXPLANATION-END id=function:endpointOf

``function columnAbsenceCode``
------------------------------

.. CG-BLOCK id=function:columnAbsenceCode lines=213-232

.. literalinclude:: ../../../desktop/src/renderer/src/utils/pendingTieReveal.ts
   :language: typescript
   :lines: 213-232
   :lineno-match:

.. CG-EXPLANATION-START id=function:columnAbsenceCode

**What this does.** Returns the FIRST gate that dropped a column, checking the gates in the same order the render path applies them: unknown investigation, hidden, not in the project file, excluded by the model, excluded by the section, outside the corridor, column focus, and finally "unknown". The block ends with the documentation for the clause function below.

**Why it is here.** The docstring records that order matters more than completeness: a test hidden from the project is also trivially "not projected onto the section", because every later check reads a list the earlier gate already removed it from. Reporting the last failing gate would send the engineer to widen a corridor that is perfectly fine.

.. CG-EXPLANATION-END id=function:columnAbsenceCode

``function columnAbsenceClause``
--------------------------------

.. CG-BLOCK id=function:columnAbsenceClause lines=233-254

.. literalinclude:: ../../../desktop/src/renderer/src/utils/pendingTieReveal.ts
   :language: typescript
   :lines: 233-254
   :lineno-match:

.. CG-EXPLANATION-START id=function:columnAbsenceClause

**What this does.** Turns a gate code into a short lower-case clause that names the control which would undo it — for example "tick it again under Boreholes in model" or "press Esc to leave focus". The block ends with the comment for the depth-formatting helper below.

**Why it is here.** The docstring records that each clause ends in an action rather than a diagnosis, so the sentence tells the engineer what to do next, not just what went wrong.

.. CG-EXPLANATION-END id=function:columnAbsenceClause

``function depthSpan``
----------------------

.. CG-BLOCK id=function:depthSpan lines=255-278

.. literalinclude:: ../../../desktop/src/renderer/src/utils/pendingTieReveal.ts
   :language: typescript
   :lines: 255-278
   :lineno-match:

.. CG-EXPLANATION-START id=function:depthSpan

**What this does.** Formats one endpoint's top and base depth at a fixed number of decimals as a range like ``18.29–18.52 m``. The block ends with the documentation for the sentence-writer below.

**Why it is here.** The comment records that the fixed precision matches the band editor and packing inspector, so the two depths line up and the engineer can match the sentence against the band list by eye.

.. CG-EXPLANATION-END id=function:depthSpan

``function describeUndrawableTie``
----------------------------------

.. CG-BLOCK id=function:describeUndrawableTie lines=279-292

.. literalinclude:: ../../../desktop/src/renderer/src/utils/pendingTieReveal.ts
   :language: typescript
   :lines: 279-292
   :lineno-match:

.. CG-EXPLANATION-START id=function:describeUndrawableTie

**What this does.** Builds the one sentence a press shows when the pending tie cannot be drawn. It names both ends with their depths first; then, if any end is absent, it names each absent end again beside its reason. If nothing is absent it just says the tie is not drawn on this view.

**Why it is here.** The docstring records the shape of the sentence: both ends first because that is the tie the count was about and the engineer must recognise it, then the absent end named again beside its reason, because a pair of names alone does not say which of the two is the problem. The result is plain English, ready to hand straight to a toast.

.. CG-EXPLANATION-END id=function:describeUndrawableTie

