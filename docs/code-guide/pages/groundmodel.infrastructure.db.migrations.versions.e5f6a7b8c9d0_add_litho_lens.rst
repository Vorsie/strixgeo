groundmodel.infrastructure.db.migrations.versions.e5f6a7b8c9d0_add_litho_lens
=============================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/migrations/versions/e5f6a7b8c9d0_add_litho_lens.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/migrations/versions/e5f6a7b8c9d0_add_litho_lens.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-54

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/e5f6a7b8c9d0_add_litho_lens.py
   :language: python
   :lines: 1-54
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Header for the migration (revision ``e5f6a7b8c9d0``, following ``d4e5f6a7b8c9``) that adds the ``litho_lens`` table — a body of one lithology sitting inside a parent formation, present at some investigations and absent at others — and a *nullable* (allowed-to-be-empty) ``lens_id`` column on the contacts table.

**Why it is here.** The docstring records the owner directive of 2026-05-24 (debt #101): a lens carries its own identity so two clay drapes inside the same sand do not collide; the parent formation is mandatory; the project id is copied onto the lens so project-scoped queries need no join; and deleting a lens sets the contact's ``lens_id`` empty rather than deleting the real contact geometry.

.. CG-EXPLANATION-END id=module-header

Function ``def upgrade``
------------------------

.. CG-BLOCK id=function:upgrade lines=55-157

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/e5f6a7b8c9d0_add_litho_lens.py
   :language: python
   :lines: 55-157
   :lineno-match:

.. CG-EXPLANATION-START id=function:upgrade

**What this does.** Creates ``litho_lens`` with its id, project id (cascading foreign key), model id, mandatory parent-formation id, optional name and timestamps; adds three indexes (by model, by formation, by project); then adds the nullable ``lens_id`` foreign key on the contacts table with a partial index over only the contacts that have a lens.

**Why it is here.** The comments explain each choice: greenfield tables from #101 onward declare the project foreign key so the cascade is enforced in the database; the lens link uses set-empty-on-delete because the lens is metadata over real contacts; and the *partial index* (one that covers only rows matching a condition) skips the large majority of contacts with no lens.

.. CG-EXPLANATION-END id=function:upgrade

Function ``def downgrade``
--------------------------

.. CG-BLOCK id=function:downgrade lines=158-162

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/e5f6a7b8c9d0_add_litho_lens.py
   :language: python
   :lines: 158-162
   :lineno-match:

.. CG-EXPLANATION-START id=function:downgrade

**What this does.** Removes the contact partial index and the ``lens_id`` column, then drops the ``litho_lens`` table.

**Why it is here.** The reverse is done in dependency order — the borrowing column and its index go before the table they point at — so nothing is left referring to a table that no longer exists.

.. CG-EXPLANATION-END id=function:downgrade

