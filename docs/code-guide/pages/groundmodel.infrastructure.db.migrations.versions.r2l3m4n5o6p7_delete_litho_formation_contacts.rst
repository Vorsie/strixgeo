groundmodel.infrastructure.db.migrations.versions.r2l3m4n5o6p7_delete_litho_formation_contacts
==============================================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/migrations/versions/r2l3m4n5o6p7_delete_litho_formation_contacts.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/migrations/versions/r2l3m4n5o6p7_delete_litho_formation_contacts.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-102

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/r2l3m4n5o6p7_delete_litho_formation_contacts.py
   :language: python
   :lines: 1-102
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Header for the migration (revision ``r2l3m4n5o6p7``, following ``q1k2l3m4n5o6``) that deletes the historical contact-mirror rows for litho models. It sets ``DATA_REWRITE = True`` and defines the disable-trigger, delete, and re-materialise SQL statements.

**Why it is here.** The docstring records that every accepted litho boundary now lives natively in the layer table and the contact row is a vestigial mirror nothing reads; this migration prunes the historical mirrors. Two guards are documented: the forward trigger is disabled during the delete so it does not wipe the layers the delete is trying to preserve, and synthetic pinch-out contacts are excluded because they have no layer counterpart. The flag names it among the data-rewriting migrations the migrator backs up first (audit H2b).

.. CG-EXPLANATION-END id=module-header

Function ``def upgrade``
------------------------

.. CG-BLOCK id=function:upgrade lines=103-109

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/r2l3m4n5o6p7_delete_litho_formation_contacts.py
   :language: python
   :lines: 103-109
   :lineno-match:

.. CG-EXPLANATION-START id=function:upgrade

**What this does.** Disables the forward trigger, deletes the litho-model contact rows (keeping synthetic pinch-outs), then re-enables the trigger.

**Why it is here.** The docstring explains each SQL runs as its own statement because the async driver rejects multi-statement strings, and the disable-delete-enable wrap protects the layers.

.. CG-EXPLANATION-END id=function:upgrade

Function ``def downgrade``
--------------------------

.. CG-BLOCK id=function:downgrade lines=110-114

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/r2l3m4n5o6p7_delete_litho_formation_contacts.py
   :language: python
   :lines: 110-114
   :lineno-match:

.. CG-EXPLANATION-START id=function:downgrade

**What this does.** Disables the trigger, re-materialises contact mirrors from the surviving accepted layers, then re-enables the trigger.

**Why it is here.** The docstring notes this mirrors the reverse-trigger logic in bulk for the litho scope, rebuilding the contact rows the delete removed.

.. CG-EXPLANATION-END id=function:downgrade

