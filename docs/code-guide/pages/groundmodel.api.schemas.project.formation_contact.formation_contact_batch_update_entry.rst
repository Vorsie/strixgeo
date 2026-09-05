groundmodel.api.schemas.project.formation_contact.formation_contact_batch_update_entry
======================================================================================

.. CG-PAGE source=src/groundmodel/api/schemas/project/formation_contact/formation_contact_batch_update_entry.py complete=true

*Source file:* ``src/groundmodel/api/schemas/project/formation_contact/formation_contact_batch_update_entry.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-9

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/formation_contact/formation_contact_batch_update_entry.py
   :language: python
   :lines: 1-9
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The docstring and the import of the single-update request it extends.

**Why it is here.** One-class-per-file; it builds on the single-update schema below.

.. CG-EXPLANATION-END id=module-header

Class ``FormationContactBatchUpdateEntry``
------------------------------------------

.. CG-BLOCK id=class:FormationContactBatchUpdateEntry lines=10-20

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/formation_contact/formation_contact_batch_update_entry.py
   :language: python
   :lines: 10-20
   :lineno-match:

.. CG-EXPLANATION-START id=class:FormationContactBatchUpdateEntry

**What this does.** One row of a batch update: it inherits every field and the anchor check of the single-update request and adds the target ``contact_id``.

**Why it is here.** The docstring records that inheriting keeps the anchor semantics identical to a single update — the batch endpoint is just N single updates in one transaction (an all-or-nothing unit of database work).

.. CG-EXPLANATION-END id=class:FormationContactBatchUpdateEntry

