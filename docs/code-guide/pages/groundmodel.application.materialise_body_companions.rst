groundmodel.application.materialise_body_companions
===================================================

.. CG-PAGE source=src/groundmodel/application/materialise_body_companions.py complete=true

*Source file:* ``src/groundmodel/application/materialise_body_companions.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-52

.. literalinclude:: ../../../src/groundmodel/application/materialise_body_companions.py
   :language: python
   :lines: 1-52
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the materialise-companions file: a docstring plus imports (the per-body ``CreatePerpendicularCompanion`` use case and the body, section and correlation-edge rows). The docstring lists the gate for each body and the counted outcomes, and explains that the approved-edge set is loaded once before the body loop, and that a failing body is caught, rolled back and counted while the loop keeps going.

**Why it is here.** A companion section is a second cross-section drawn across a body so a 3-D shape is constrained in both directions. The docstring records the strict gate (every seeded contact on the primary section must already have an approved outbound correlation edge), the vacuous-truth case (a section with no contacts passes the gate — nothing can violate it), and the #212 rollback rule: because each body's companion creation owns its own commit, a failure must explicitly roll back the session so a half-staged write cannot survive into a later caller's commit. It notes the former name ``MaterialiseLensCompanions``.

.. CG-EXPLANATION-END id=module-header

Class ``MaterialiseBodyCompanionsResult``
-----------------------------------------

.. CG-BLOCK id=class:MaterialiseBodyCompanionsResult lines=53-77

.. literalinclude:: ../../../src/groundmodel/application/materialise_body_companions.py
   :language: python
   :lines: 53-77
   :lineno-match:

.. CG-EXPLANATION-START id=class:MaterialiseBodyCompanionsResult

**What this does.** A dataclass with the pass's four counts: companions created, bodies skipped for no primary section, bodies skipped because a section is unfinished (a contact lacks an approved edge), and bodies that raised an unexpected error.

**Why it is here.** The engineer needs to see not just how many companions were made but why the rest were left out, so the two skip reasons and the error count are separate fields.

.. CG-EXPLANATION-END id=class:MaterialiseBodyCompanionsResult

Class ``MaterialiseBodyCompanions`` — header
--------------------------------------------

.. CG-BLOCK id=class:MaterialiseBodyCompanions lines=78-89

.. literalinclude:: ../../../src/groundmodel/application/materialise_body_companions.py
   :language: python
   :lines: 78-89
   :lineno-match:

.. CG-EXPLANATION-START id=class:MaterialiseBodyCompanions

**What this does.** Opens the use-case class; its docstring notes it is idempotent because ``CreatePerpendicularCompanion`` silently skips a body that already has a companion.

**Why it is here.** Idempotency means a re-run makes no duplicate companions. It inherits ``GroundModelLogger`` for logging under this module's name.

.. CG-EXPLANATION-END id=class:MaterialiseBodyCompanions

Method ``MaterialiseBodyCompanions``. ``def __init__``
------------------------------------------------------

.. CG-BLOCK id=method:MaterialiseBodyCompanions.__init__ lines=90-94

.. literalinclude:: ../../../src/groundmodel/application/materialise_body_companions.py
   :language: python
   :lines: 90-94
   :lineno-match:

.. CG-EXPLANATION-START id=method:MaterialiseBodyCompanions.__init__

**What this does.** Stores the handed-in session and names the logger after this module.

**Why it is here.** The caller owns the session; ``__name__`` makes the log lines read as coming from this use case.

.. CG-EXPLANATION-END id=method:MaterialiseBodyCompanions.__init__

Method ``MaterialiseBodyCompanions``. ``async def execute``
-----------------------------------------------------------

.. CG-BLOCK id=method:MaterialiseBodyCompanions.execute lines=95-241

.. literalinclude:: ../../../src/groundmodel/application/materialise_body_companions.py
   :language: python
   :lines: 95-241
   :lineno-match:

.. CG-EXPLANATION-START id=method:MaterialiseBodyCompanions.execute

**What this does.** Runs the pass for every companion-less body in the model. It loads those bodies; loads the model's approved-edge contacts once; batch-loads the primary sections' seeded-contact lists once; then loops each body with an ``[i/total]`` progress prefix — skipping when the primary section is missing or deleted, skipping when a seeded contact has no approved edge (an empty contact list passes the gate), and otherwise calling ``CreatePerpendicularCompanion``; on an error it rolls the session back and counts the body; finally it logs and returns the counts.

**Why it is here.** The approved-edge set and the seeded lists are loaded before the loop because they are model-scoped and do not change during the pass, and the earlier per-body lookups were one database round-trip each (audit BE-APPLICATION-LITHO-17). The ``[i/total]`` prefix is the Definition-of-Done rule for progress in bulk loops. The per-body rollback on failure (#212) discards any write staged before the inner commit could fire, while already-committed companions from earlier iterations are untouched — so partial progress is kept.

.. CG-EXPLANATION-END id=method:MaterialiseBodyCompanions.execute

