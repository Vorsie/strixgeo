groundmodel.shared.constants.db_constraints
===========================================

.. CG-PAGE source=src/groundmodel/shared/constants/db_constraints.py complete=true

*Source file:* ``src/groundmodel/shared/constants/db_constraints.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-22

.. literalinclude:: ../../../src/groundmodel/shared/constants/db_constraints.py
   :language: python
   :lines: 1-22
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Defines one string, ``LITHO_LAYER_NO_OVERLAP_CONSTRAINT``, holding the database name of a rule that forbids two accepted litho layers overlapping in depth on the same model and investigation. A *constraint* is a rule the database enforces on every write, checked here at commit time.

**Why it is here.** The docstring records that a constraint name is the only handle PostgreSQL gives on which rule a write broke — it appears as a substring of the error text. Both the application layer (turning the violation into a domain error) and the API layer (mapping it to a status code) must match that literal, so it lives at the shared floor where both may import it; renaming the constraint in a migration then means editing this one file and nothing else.

.. CG-EXPLANATION-END id=module-header

