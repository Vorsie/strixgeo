groundmodel.application.delete_formation_contact
================================================

.. CG-PAGE source=src/groundmodel/application/delete_formation_contact.py complete=true

*Source file:* ``src/groundmodel/application/delete_formation_contact.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-45

.. literalinclude:: ../../../src/groundmodel/application/delete_formation_contact.py
   :language: python
   :lines: 1-45
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The docstring and imports for the delete-one-contact use case. The docstring notes that on a lithostratigraphic model the database foreign-key cascade removes any correlation edges that referenced the deleted contact, so the instance resolver is re-run inline to keep the ordinals coherent; body detection is not fired here.

**Why it is here.** The router already checks scope (the contact belongs to the URL model and the model to the project), so this layer trusts the call and drops the row. Non-litho models skip the resolver because geological contacts have no correlation edges. Body detection is deferred to the startup/restore body sweep (owner directive 2026-05-31).

.. CG-EXPLANATION-END id=module-header

Class ``DeleteFormationContact`` — header
-----------------------------------------

.. CG-BLOCK id=class:DeleteFormationContact lines=46-54

.. literalinclude:: ../../../src/groundmodel/application/delete_formation_contact.py
   :language: python
   :lines: 46-54
   :lineno-match:

.. CG-EXPLANATION-START id=class:DeleteFormationContact

**What this does.** The use-case class: drop one contact row and commit. For litho contacts it also re-runs the resolver so the correlation graph stays consistent after the cascade.

**Why it is here.** One class per unit of work; it inherits the shared logger.

.. CG-EXPLANATION-END id=class:DeleteFormationContact

Method ``DeleteFormationContact``. ``def __init__``
---------------------------------------------------

.. CG-BLOCK id=method:DeleteFormationContact.__init__ lines=55-61

.. literalinclude:: ../../../src/groundmodel/application/delete_formation_contact.py
   :language: python
   :lines: 55-61
   :lineno-match:

.. CG-EXPLANATION-START id=method:DeleteFormationContact.__init__

**What this does.** Stores the session and builds a geology repository and a cross-section repository over it.

**Why it is here.** The caller owns the session; the use case commits once. The cross-section repository is needed to un-seed the deleted contact from every section.

.. CG-EXPLANATION-END id=method:DeleteFormationContact.__init__

Method ``DeleteFormationContact``. ``async def execute``
--------------------------------------------------------

.. CG-BLOCK id=method:DeleteFormationContact.execute lines=62-143

.. literalinclude:: ../../../src/groundmodel/application/delete_formation_contact.py
   :language: python
   :lines: 62-143
   :lineno-match:

.. CG-EXPLANATION-START id=method:DeleteFormationContact.execute

**What this does.** Deletes one contact and reconciles. It takes the body-partition lock, reads the pre-delete row to learn its model and formation, deletes it through the repository, and — if a row was removed — marks that surface stale and mirrors to the 3-D cache. On a litho model it then re-runs the instance resolver so ordinals stay coherent after the cascade, removes the deleted contact id from every section's seeded set, and commits. It returns true when a row was removed and false when it was already gone (idempotent — both map to a no-content response).

**Why it is here.** The lock is taken before the first write because on a litho model the delete fires the mirror trigger long before the resolver takes the same lock, and unguarded that races the background body recompute in a different order — the 2026-08-23 deadlock. Litho-parent-first lock order avoids it; the lock is re-entrant so the resolver's later take stays free. Un-seeding is necessary because the explicit-content invariant has no other remover, so the id would stay seeded forever and bloat the section across delete cycles.

.. CG-EXPLANATION-END id=method:DeleteFormationContact.execute

