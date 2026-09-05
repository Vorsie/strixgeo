groundmodel.application.gapless_build_report_assembler
======================================================

.. CG-PAGE source=src/groundmodel/application/gapless_build_report_assembler.py complete=true

*Source file:* ``src/groundmodel/application/gapless_build_report_assembler.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-46

.. literalinclude:: ../../../src/groundmodel/application/gapless_build_report_assembler.py
   :language: python
   :lines: 1-46
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the report-assembler file. It imports the clause constants, the hairline limit, the labeller's report types and the logger, and builds a clause-key to number map. Its docstring says this is the one place that merges all seven clauses into the stored report.

**Why it is here.** The renderer computes the four 2-D clauses and the backend the three 3-D ones, but only this class re-stamps every clause's number and title from the constants so they cannot drift between the two languages. It returns a plain dict, not the API schema, so the application layer stays clean-architecture compliant; the API validates the dict at the boundary.

.. CG-EXPLANATION-END id=module-header

Class ``GaplessBuildReportAssembler`` — header
----------------------------------------------

.. CG-BLOCK id=class:GaplessBuildReportAssembler lines=47-56

.. literalinclude:: ../../../src/groundmodel/application/gapless_build_report_assembler.py
   :language: python
   :lines: 47-56
   :lineno-match:

.. CG-EXPLANATION-START id=class:GaplessBuildReportAssembler

**What this does.** The class that builds the seven-clause report dict for one voxel build.

**Why it is here.** It has real behaviour — it logs which clauses failed and the verdict — so it inherits the logger, unlike the frozen value objects it reads.

.. CG-EXPLANATION-END id=class:GaplessBuildReportAssembler

Method ``GaplessBuildReportAssembler``. ``def __init__``
--------------------------------------------------------

.. CG-BLOCK id=method:GaplessBuildReportAssembler.__init__ lines=57-60

.. literalinclude:: ../../../src/groundmodel/application/gapless_build_report_assembler.py
   :language: python
   :lines: 57-60
   :lineno-match:

.. CG-EXPLANATION-START id=method:GaplessBuildReportAssembler.__init__

**What this does.** Sets up the module-named logger.

**Why it is here.** So its log lines read as coming from this module.

.. CG-EXPLANATION-END id=method:GaplessBuildReportAssembler.__init__

Method ``GaplessBuildReportAssembler``. ``def assemble``
--------------------------------------------------------

.. CG-BLOCK id=method:GaplessBuildReportAssembler.assemble lines=61-159

.. literalinclude:: ../../../src/groundmodel/application/gapless_build_report_assembler.py
   :language: python
   :lines: 61-159
   :lineno-match:

.. CG-EXPLANATION-START id=method:GaplessBuildReportAssembler.assemble

**What this does.** Assembles all seven clauses in order: it re-stamps the renderer's 2-D clauses (marking any missing one not-evaluated), computes the three 3-D clauses from the labeller's report (or marks them not-evaluated when no grid was labelled), derives the overall verdict, and returns the report dict.

**Why it is here.** A missing 2-D clause means a lithology build or an older client; an absent label report means the checksum-skip path. When a grid exists, clauses five and six are answered whatever happened to seven, and seven distinguishes could-not-check from nothing-to-check, because the engineer acts on those differently. Failed clauses are logged as warnings so a failure is visible in a packaged build.

.. CG-EXPLANATION-END id=method:GaplessBuildReportAssembler.assemble

Method ``GaplessBuildReportAssembler``. ``def _restamp``
--------------------------------------------------------

.. CG-BLOCK id=method:GaplessBuildReportAssembler._restamp lines=160-171

.. literalinclude:: ../../../src/groundmodel/application/gapless_build_report_assembler.py
   :language: python
   :lines: 160-171
   :lineno-match:

.. CG-EXPLANATION-START id=method:GaplessBuildReportAssembler._restamp

**What this does.** Re-stamps a renderer-supplied 2-D clause with its authoritative number and title, keeping its status, reason and entries.

**Why it is here.** The number and title always come from the constants so they cannot drift from the renderer's copy.

.. CG-EXPLANATION-END id=method:GaplessBuildReportAssembler._restamp

Method ``GaplessBuildReportAssembler``. ``def _not_evaluated``
--------------------------------------------------------------

.. CG-BLOCK id=method:GaplessBuildReportAssembler._not_evaluated lines=172-182

.. literalinclude:: ../../../src/groundmodel/application/gapless_build_report_assembler.py
   :language: python
   :lines: 172-182
   :lineno-match:

.. CG-EXPLANATION-START id=method:GaplessBuildReportAssembler._not_evaluated

**What this does.** Builds a not-evaluated clause dict carrying the honest reason and no entries.

**Why it is here.** A clause nobody could measure this build is labelled as such rather than silently passed or failed.

.. CG-EXPLANATION-END id=method:GaplessBuildReportAssembler._not_evaluated

Method ``GaplessBuildReportAssembler``. ``def _clause``
-------------------------------------------------------

.. CG-BLOCK id=method:GaplessBuildReportAssembler._clause lines=183-195

.. literalinclude:: ../../../src/groundmodel/application/gapless_build_report_assembler.py
   :language: python
   :lines: 183-195
   :lineno-match:

.. CG-EXPLANATION-START id=method:GaplessBuildReportAssembler._clause

**What this does.** Builds a computed 3-D clause dict, pass or fail, with entries only when it failed.

**Why it is here.** The shared shape for the three backend clauses so each reads consistently.

.. CG-EXPLANATION-END id=method:GaplessBuildReportAssembler._clause

Method ``GaplessBuildReportAssembler``. ``def _column_totality``
----------------------------------------------------------------

.. CG-BLOCK id=method:GaplessBuildReportAssembler._column_totality lines=196-207

.. literalinclude:: ../../../src/groundmodel/application/gapless_build_report_assembler.py
   :language: python
   :lines: 196-207
   :lineno-match:

.. CG-EXPLANATION-START id=method:GaplessBuildReportAssembler._column_totality

**What this does.** Clause five: fails when any column inside the footprint carries no labelled voxel, with a budget of zero empty columns.

**Why it is here.** Every column inside the model footprint must carry material, so a single empty one is a broken promise.

.. CG-EXPLANATION-END id=method:GaplessBuildReportAssembler._column_totality

Method ``GaplessBuildReportAssembler``. ``def _stack_voids``
------------------------------------------------------------

.. CG-BLOCK id=method:GaplessBuildReportAssembler._stack_voids lines=208-224

.. literalinclude:: ../../../src/groundmodel/application/gapless_build_report_assembler.py
   :language: python
   :lines: 208-224
   :lineno-match:

.. CG-EXPLANATION-START id=method:GaplessBuildReportAssembler._stack_voids

**What this does.** Clause six: fails when any column stack has an interior void larger than the hairline limit, reporting the worst.

**Why it is here.** A void above the hairline limit is a real hole in the model, distinct from a sub-hairline seam that is a rendering artefact.

.. CG-EXPLANATION-END id=method:GaplessBuildReportAssembler._stack_voids

Method ``GaplessBuildReportAssembler``. ``def _section_reconciliation``
-----------------------------------------------------------------------

.. CG-BLOCK id=method:GaplessBuildReportAssembler._section_reconciliation lines=225-260

.. literalinclude:: ../../../src/groundmodel/application/gapless_build_report_assembler.py
   :language: python
   :lines: 225-260
   :lineno-match:

.. CG-EXPLANATION-START id=method:GaplessBuildReportAssembler._section_reconciliation

**What this does.** Clause seven: for each section it compares the area the 3-D model holds against the area the 2-D fill classed, listing any section that diverges beyond its allowance.

**Why it is here.** This is the promise that the 3-D model holds the ground its sections classed; the entry names the worst-diverging place and notes samples excluded for being outside the footprint, so the engineer can see where and how much.

.. CG-EXPLANATION-END id=method:GaplessBuildReportAssembler._section_reconciliation

Method ``GaplessBuildReportAssembler``. ``def _verdict``
--------------------------------------------------------

.. CG-BLOCK id=method:GaplessBuildReportAssembler._verdict lines=261-268

.. literalinclude:: ../../../src/groundmodel/application/gapless_build_report_assembler.py
   :language: python
   :lines: 261-268
   :lineno-match:

.. CG-EXPLANATION-START id=method:GaplessBuildReportAssembler._verdict

**What this does.** Derives the overall verdict: fail if any clause failed, incomplete if any was not evaluated, otherwise pass.

**Why it is here.** One rule folds the seven clause statuses into the single banner verdict the engineer reads.

.. CG-EXPLANATION-END id=method:GaplessBuildReportAssembler._verdict

