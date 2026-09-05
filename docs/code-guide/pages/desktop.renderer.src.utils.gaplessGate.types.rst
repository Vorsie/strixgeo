desktop.renderer.src.utils.gaplessGate.types
============================================

.. CG-PAGE source=desktop/src/renderer/src/utils/gaplessGate/types.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/gaplessGate/types.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-40

.. literalinclude:: ../../../desktop/src/renderer/src/utils/gaplessGate/types.ts
   :language: typescript
   :lines: 1-40
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the shared wire contract for the seven-clause gapless gate — the named shapes the frontend and backend both use to talk about whether a built model has any gaps or fallbacks. It explains that the report fails loudly but never blocks the build, that clauses 1 to 4 are two-dimensional and computed in the renderer while clauses 5 to 7 are three-dimensional and computed by the backend, that the backend is the single assembler that names every clause, and that every optional field is spelled ``T or null`` so an absence sent as an explicit null is not mistaken for a value.

**Why it is here.** Owner constraint 2026-08-26, quoted in the docstring: "I can't have gaps or fallbacks in the model unless users make mistakes" — and a promise nobody measures is a wish. The design decisions each guard a real failure the docstring records: naming every clause in one backend place stops the two languages drifting, and testing the value rather than the slot stops an inbound null being read as a real finding (which once put a "Show me" button on findings that stand nowhere).

.. CG-EXPLANATION-END id=module-header

``type GaplessClauseKey``
-------------------------

.. CG-BLOCK id=type:GaplessClauseKey lines=41-65

.. literalinclude:: ../../../desktop/src/renderer/src/utils/gaplessGate/types.ts
   :language: typescript
   :lines: 41-65
   :lineno-match:

.. CG-EXPLANATION-START id=type:GaplessClauseKey

**What this does.** The seven clause names in report order: area-conservation, edge-reach, cause-closure and section-closure (the 2-D four), then column-totality, stack-voids and section-reconciliation (the 3-D three). Each carries a one-line comment of the promise it keeps.

**Why it is here.** Naming the seven promises as a fixed list is what lets every clause be reported in the same order every build and referred to by name across the two languages without a magic number.

.. CG-EXPLANATION-END id=type:GaplessClauseKey

``type GaplessClauseStatus``
----------------------------

.. CG-BLOCK id=type:GaplessClauseStatus lines=66-74

.. literalinclude:: ../../../desktop/src/renderer/src/utils/gaplessGate/types.ts
   :language: typescript
   :lines: 66-74
   :lineno-match:

.. CG-EXPLANATION-START id=type:GaplessClauseStatus

**What this does.** The three answers one clause can give: ``pass``, ``fail``, or ``not-evaluated``.

**Why it is here.** The docstring insists ``not-evaluated`` is a first-class answer, not a soft pass: a litho build runs no hierarchical fill so clauses 1 to 3 have nothing to measure, and reporting that as a pass would be a lie in exactly the direction the owner's constraint cannot afford.

.. CG-EXPLANATION-END id=type:GaplessClauseStatus

``type GaplessVerdict``
-----------------------

.. CG-BLOCK id=type:GaplessVerdict lines=75-77

.. literalinclude:: ../../../desktop/src/renderer/src/utils/gaplessGate/types.ts
   :language: typescript
   :lines: 75-77
   :lineno-match:

.. CG-EXPLANATION-START id=type:GaplessVerdict

**What this does.** The build's overall verdict: ``pass``, ``fail``, or ``incomplete``.

**Why it is here.** ``incomplete`` means nothing failed but not everything was measured, and the docstring makes it deliberately not-green: an unmeasured clause is an unkept promise until it is measured.

.. CG-EXPLANATION-END id=type:GaplessVerdict

``type GaplessMeasureUnit``
---------------------------

.. CG-BLOCK id=type:GaplessMeasureUnit lines=78-80

.. literalinclude:: ../../../desktop/src/renderer/src/utils/gaplessGate/types.ts
   :language: typescript
   :lines: 78-80
   :lineno-match:

.. CG-EXPLANATION-START id=type:GaplessMeasureUnit

**What this does.** The unit a clause's number is in: metres, square metres, or a plain count.

**Why it is here.** A number is meaningless without its unit, and the three the gate ever reports are lengths, areas and counts.

.. CG-EXPLANATION-END id=type:GaplessMeasureUnit

``interface GaplessMeasure``
----------------------------

.. CG-BLOCK id=interface:GaplessMeasure lines=81-99

.. literalinclude:: ../../../desktop/src/renderer/src/utils/gaplessGate/types.ts
   :language: typescript
   :lines: 81-99
   :lineno-match:

.. CG-EXPLANATION-START id=interface:GaplessMeasure

**What this does.** A number a clause is making a claim about: its value, its unit, and an optional ``budget`` for the amount that was allowed.

**Why it is here.** The docstring notes the budget is present only where a clause has a derived allowance (clause 7's quantisation slack, clause 6's hairline limit) and absent where the clause forbids the thing outright, i.e. the budget is simply zero.

.. CG-EXPLANATION-END id=interface:GaplessMeasure

``interface GaplessClauseEntry``
--------------------------------

.. CG-BLOCK id=interface:GaplessClauseEntry lines=100-145

.. literalinclude:: ../../../desktop/src/renderer/src/utils/gaplessGate/types.ts
   :language: typescript
   :lines: 100-145
   :lineno-match:

.. CG-EXPLANATION-START id=interface:GaplessClauseEntry

**What this does.** One named spot where a clause was broken: a one-line human label plus enough identity to navigate to it — the section, its name, the gap index, the two investigations the gap sits between, an investigation id, a map position, and the measurement.

**Why it is here.** The docstring is precise that a gap INDEX is only a label the sentence quotes, not a way to find the gap, because the same number means a different gap on the geotech axis — which once centred the wrong gap. So the two column NAMES travel instead, and every locator is present only when the clause can honestly know it; nothing is guessed to fill a field.

.. CG-EXPLANATION-END id=interface:GaplessClauseEntry

``interface GaplessClauseInput``
--------------------------------

.. CG-BLOCK id=interface:GaplessClauseInput lines=146-158

.. literalinclude:: ../../../desktop/src/renderer/src/utils/gaplessGate/types.ts
   :language: typescript
   :lines: 146-158
   :lineno-match:

.. CG-EXPLANATION-START id=interface:GaplessClauseInput

**What this does.** What the renderer says about one clause: its key, its status, an optional reason it could not be measured, and the list of named spots. It carries no clause number or title.

**Why it is here.** The docstring records that naming the clause is the backend's job, so the number and title are left off here where they could otherwise drift between the two languages; the reason is present only on ``not-evaluated`` because an unmeasured clause that cannot say why is itself a defect.

.. CG-EXPLANATION-END id=interface:GaplessClauseInput

``interface GaplessClause``
---------------------------

.. CG-BLOCK id=interface:GaplessClause lines=159-166

.. literalinclude:: ../../../desktop/src/renderer/src/utils/gaplessGate/types.ts
   :language: typescript
   :lines: 159-166
   :lineno-match:

.. CG-EXPLANATION-START id=interface:GaplessClause

**What this does.** One clause as the backend finally assembled it: everything the renderer said, plus the clause's stable number (1 to 7) and its title stated as a positive promise.

**Why it is here.** The number and title are added exactly once, on the backend, so the seven promises have a single home and cannot say different things in the two halves of the app.

.. CG-EXPLANATION-END id=interface:GaplessClause

``interface GaplessBuildReport``
--------------------------------

.. CG-BLOCK id=interface:GaplessBuildReport lines=167-173

.. literalinclude:: ../../../desktop/src/renderer/src/utils/gaplessGate/types.ts
   :language: typescript
   :lines: 167-173
   :lineno-match:

.. CG-EXPLANATION-START id=interface:GaplessBuildReport

**What this does.** The whole gate for one build: the overall verdict, all seven clauses in number order (even the unmeasured ones), and the instant the report was assembled.

**Why it is here.** One report per build, always carrying all seven clauses, is what lets the engineer see at a glance which promises were kept, broken, or not measured for that build.

.. CG-EXPLANATION-END id=interface:GaplessBuildReport

