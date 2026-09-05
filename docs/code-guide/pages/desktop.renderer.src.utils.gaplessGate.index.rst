desktop.renderer.src.utils.gaplessGate.index
============================================

.. CG-PAGE source=desktop/src/renderer/src/utils/gaplessGate/index.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/gaplessGate/index.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-31

.. literalinclude:: ../../../desktop/src/renderer/src/utils/gaplessGate/index.ts
   :language: typescript
   :lines: 1-31
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the renderer's assembler for the gapless gate and re-exports the pieces the caller needs. It folds the per-section evidence for clauses 1 to 3 into one answer per clause and appends clause 4.

**Why it is here.** The docstring states the merge rule so it cannot silently drift: any entry anywhere makes the clause FAIL and carries every entry found; no entries with every in-scope section evaluated makes it PASS; no entries but at least one section not evaluated makes it NOT-EVALUATED — because a build that only partly measured a clause does not get to report a clean pass.

.. CG-EXPLANATION-END id=module-header

``const CLAUSE_2D_KEYS``
------------------------

.. CG-BLOCK id=const:CLAUSE_2D_KEYS lines=32-34

.. literalinclude:: ../../../desktop/src/renderer/src/utils/gaplessGate/index.ts
   :language: typescript
   :lines: 32-34
   :lineno-match:

.. CG-EXPLANATION-START id=const:CLAUSE_2D_KEYS

**What this does.** The three 2-D clause keys in order, as a small fixed list.

**Why it is here.** It fixes the order the three clauses are assembled and reported in, so the output is deterministic.

.. CG-EXPLANATION-END id=const:CLAUSE_2D_KEYS

``function mergeAcrossSections``
--------------------------------

.. CG-BLOCK id=function:mergeAcrossSections lines=35-61

.. literalinclude:: ../../../desktop/src/renderer/src/utils/gaplessGate/index.ts
   :language: typescript
   :lines: 35-61
   :lineno-match:

.. CG-EXPLANATION-START id=function:mergeAcrossSections

**What this does.** Folds one clause key's per-section evidence into a single wire answer: it gathers every section's entries; if any exist the clause fails carrying them all; if none exist and every section was evaluated it passes; otherwise it is not-evaluated with a reason that counts how many sections had no fill.

**Why it is here.** It is the literal implementation of the merge rule the module docstring pins — in particular it makes a mixed result (some sections measured, some not, none failing) not-evaluated rather than a clean pass, which is exactly the case the not-a-soft-pass distinction exists for.

.. CG-EXPLANATION-END id=function:mergeAcrossSections

``function assembleGaplessClauses2d``
-------------------------------------

.. CG-BLOCK id=function:assembleGaplessClauses2d lines=62-78

.. literalinclude:: ../../../desktop/src/renderer/src/utils/gaplessGate/index.ts
   :language: typescript
   :lines: 62-78
   :lineno-match:

.. CG-EXPLANATION-START id=function:assembleGaplessClauses2d

**What this does.** The public assembler: it groups every section's clause-1/2/3 evidence by key, merges each key across sections, and appends clause 4, returning exactly four clause inputs ready to attach to the voxel build payload.

**Why it is here.** It is the single call the build makes to get the renderer's half of the report, so the four 2-D clauses always leave the frontend as one consistent set.

.. CG-EXPLANATION-END id=function:assembleGaplessClauses2d

