groundmodel.api.schemas.project.gapless_build_report
====================================================

.. CG-PAGE source=src/groundmodel/api/schemas/project/gapless_build_report.py complete=true

*Source file:* ``src/groundmodel/api/schemas/project/gapless_build_report.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-34

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/gapless_build_report.py
   :language: python
   :lines: 1-34
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A docstring describing the seven-clause gapless gate and its four wire shapes, then imports the shared clause vocabularies (the clause keys, the pass/fail statuses, the measure units, and the overall verdict).

**Why it is here.** The gate answers one question per 3-D build: does the model keep the owner's guarantee of no gaps and no fallbacks except where a user made a mistake? The docstring records the load-bearing decision: it fails the REPORT loudly and never the build — the solids are written either way and the engineer is shown which section and gap to inspect. The four shapes mirror the desktop's own types field for field, and every field is additive so a client predating the gate reads nothing.

.. CG-EXPLANATION-END id=module-header

Class ``GaplessMeasureSchema``
------------------------------

.. CG-BLOCK id=class:GaplessMeasureSchema lines=35-55

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/gapless_build_report.py
   :language: python
   :lines: 35-55
   :lineno-match:

.. CG-EXPLANATION-START id=class:GaplessMeasureSchema

**What this does.** A number a finding makes a claim about: the measured value, its unit (metres, square metres, or a plain count), and an optional budget it was allowed to reach.

**Why it is here.** The budget is set only for the clauses that have a derived allowance (a vertical-quantisation budget, a hairline limit) and is null for the clauses that forbid the thing outright, which is most of them.

.. CG-EXPLANATION-END id=class:GaplessMeasureSchema

Class ``GaplessClauseEntrySchema``
----------------------------------

.. CG-BLOCK id=class:GaplessClauseEntrySchema lines=56-105

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/gapless_build_report.py
   :language: python
   :lines: 56-105
   :lineno-match:

.. CG-EXPLANATION-START id=class:GaplessClauseEntrySchema

**What this does.** One named spot where a clause was broken: a human-readable label plus whatever locators the clause knows — the section id and name, a gap index, the pair of investigations the gap sits between, an investigation id, a map position, and the measured number.

**Why it is here.** Every locator is optional because different clauses know different things, and a field is filled only when the clause genuinely knows it — nothing is guessed to fill a slot. The docstring records that the investigation pair is what a reader navigates by (the gap index alone indexes only the frame's column list), so the renderer resolves the names while the frame is in scope and this shape just carries them through. The label is printed verbatim in the engineer's own words, never a variable name.

.. CG-EXPLANATION-END id=class:GaplessClauseEntrySchema

Class ``GaplessClauseInputSchema``
----------------------------------

.. CG-BLOCK id=class:GaplessClauseInputSchema lines=106-130

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/gapless_build_report.py
   :language: python
   :lines: 106-130
   :lineno-match:

.. CG-EXPLANATION-START id=class:GaplessClauseInputSchema

**What this does.** What the renderer reports about one of the four 2-D clauses: which clause it is, its pass/fail/not-evaluated status, an optional reason when not evaluated, and the list of broken spots (empty unless it failed). It carries no clause number and no title.

**Why it is here.** Naming a clause is deliberately the backend's job, so the number and title are added there — this keeps the seven promises from drifting between the desktop's code and the backend's. Not-evaluated is a real answer, not a soft pass.

.. CG-EXPLANATION-END id=class:GaplessClauseInputSchema

Class ``GaplessClauseSchema``
-----------------------------

.. CG-BLOCK id=class:GaplessClauseSchema lines=131-147

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/gapless_build_report.py
   :language: python
   :lines: 131-147
   :lineno-match:

.. CG-EXPLANATION-START id=class:GaplessClauseSchema

**What this does.** One clause as the backend assembled it: the renderer's substance plus the clause number (1–7) and its positively-stated title.

**Why it is here.** It extends the input shape by adding the name. The number is stable across versions because it is quoted in the banner and in owner conversations, so it is part of the contract.

.. CG-EXPLANATION-END id=class:GaplessClauseSchema

Class ``GaplessBuildReportSchema``
----------------------------------

.. CG-BLOCK id=class:GaplessBuildReportSchema lines=148-168

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/gapless_build_report.py
   :language: python
   :lines: 148-168
   :lineno-match:

.. CG-EXPLANATION-START id=class:GaplessBuildReportSchema

**What this does.** The whole gate for one build: an overall verdict, all seven clauses in number order, and the time the report was assembled.

**Why it is here.** The verdict is fail if any clause failed, incomplete when none failed but at least one could not be measured (deliberately not green, because an unmeasured promise is unkept until measured), and pass only when all seven were measured and held. All seven clauses are always listed, including unmeasured ones, because a report that silently omits a clause is indistinguishable from one that passed it.

.. CG-EXPLANATION-END id=class:GaplessBuildReportSchema

