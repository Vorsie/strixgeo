groundmodel.application.create_formation_contact
================================================

.. CG-PAGE source=src/groundmodel/application/create_formation_contact.py complete=true

*Source file:* ``src/groundmodel/application/create_formation_contact.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-50

.. literalinclude:: ../../../src/groundmodel/application/create_formation_contact.py
   :language: python
   :lines: 1-50
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The docstring and imports for the create-one-contact use case. The docstring records that the anchor rule — a contact hangs off exactly one investigation, a borehole OR a CPT, never both — is checked at three places: the request shape at the web boundary, the repository as a defence-in-depth, and a database constraint as the final net.

**Why it is here.** Wrapping a single insert in the standard use-case shape (owns its commit, logs at the boundary) gives one place to hang future editor orchestration such as running the no-gaps validator after every save. The use case deliberately does NOT re-check the anchor rule — it trusts the layers above and the database below, so the same check is not written a fourth time.

.. CG-EXPLANATION-END id=module-header

Class ``DuplicateContactError`` — header
----------------------------------------

.. CG-BLOCK id=class:DuplicateContactError lines=51-61

.. literalinclude:: ../../../src/groundmodel/application/create_formation_contact.py
   :language: python
   :lines: 51-61
   :lineno-match:

.. CG-EXPLANATION-START id=class:DuplicateContactError

**What this does.** A custom error raised when a contact for the same model, anchor and formation already exists. It carries the id of the existing contact.

**Why it is here.** The geology is that a formation has exactly one top per investigation — two "Boom clay" tops on one borehole are meaningless. Carrying the existing id lets the web layer answer with a clear conflict and lets the desktop offer "move the existing one here" instead of an opaque failure.

.. CG-EXPLANATION-END id=class:DuplicateContactError

Method ``DuplicateContactError``. ``def __init__``
--------------------------------------------------

.. CG-BLOCK id=method:DuplicateContactError.__init__ lines=62-68

.. literalinclude:: ../../../src/groundmodel/application/create_formation_contact.py
   :language: python
   :lines: 62-68
   :lineno-match:

.. CG-EXPLANATION-START id=method:DuplicateContactError.__init__

**What this does.** Builds the error message naming the existing contact id and stores that id on the error object.

**Why it is here.** The stored id is what the web layer reads to tell the desktop which contact already occupies the slot.

.. CG-EXPLANATION-END id=method:DuplicateContactError.__init__

Class ``CreateFormationContact`` — header
-----------------------------------------

.. CG-BLOCK id=class:CreateFormationContact lines=69-71

.. literalinclude:: ../../../src/groundmodel/application/create_formation_contact.py
   :language: python
   :lines: 69-71
   :lineno-match:

.. CG-EXPLANATION-START id=class:CreateFormationContact

**What this does.** The use-case class: insert one formation contact and commit the transaction.

**Why it is here.** One class per unit of work; it inherits the shared logger.

.. CG-EXPLANATION-END id=class:CreateFormationContact

Method ``CreateFormationContact``. ``def __init__``
---------------------------------------------------

.. CG-BLOCK id=method:CreateFormationContact.__init__ lines=72-77

.. literalinclude:: ../../../src/groundmodel/application/create_formation_contact.py
   :language: python
   :lines: 72-77
   :lineno-match:

.. CG-EXPLANATION-START id=method:CreateFormationContact.__init__

**What this does.** Stores the session and builds a geology repository over it.

**Why it is here.** The caller owns the session; the use case commits once. The repository is the only thing that writes rows.

.. CG-EXPLANATION-END id=method:CreateFormationContact.__init__

Method ``CreateFormationContact``. ``async def execute``
--------------------------------------------------------

.. CG-BLOCK id=method:CreateFormationContact.execute lines=78-229

.. literalinclude:: ../../../src/groundmodel/application/create_formation_contact.py
   :language: python
   :lines: 78-229
   :lineno-match:

.. CG-EXPLANATION-START id=method:CreateFormationContact.execute

**What this does.** Inserts one contact and commits. In order: it verifies the formation and each supplied anchor belong to the project; runs a fast pre-check for an existing contact on the same model/anchor/formation and raises the duplicate error (carrying the existing id) if found; calls the repository to create the row, catching a database uniqueness violation from a parallel writer and converting it to the same duplicate error after re-finding the winner; marks the formation's surface stale and mirrors that to the 3-D solid cache; commits; refreshes the row so server-side defaults are present; and returns an immutable snapshot of it.

**Why it is here.** The project-scope checks are defence-in-depth (VULN-9): the model scope is already checked by the router, so these stop a crafted request from smuggling a foreign-project formation or anchor id in the body. The duplicate check is two-layer on purpose — the fast SELECT keeps the happy path quick by short-circuiting before the insert, while the database's partial unique indexes close the race for two transactions that both pass the check before either commits; catching the resulting integrity error and reshaping it preserves the same conflict-plus-existing-id contract whichever check trips first. Marking the surface stale rather than rebuilding it is the on-click-build contract; the 3-D mirror call is a safe no-op for a geological model because solid rows are keyed by the litho model id.

.. CG-EXPLANATION-END id=method:CreateFormationContact.execute

