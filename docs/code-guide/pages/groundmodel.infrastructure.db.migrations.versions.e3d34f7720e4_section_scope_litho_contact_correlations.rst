groundmodel.infrastructure.db.migrations.versions.e3d34f7720e4_section_scope_litho_contact_correlations
=======================================================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/migrations/versions/e3d34f7720e4_section_scope_litho_contact_correlations.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/migrations/versions/e3d34f7720e4_section_scope_litho_contact_correlations.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-25

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/e3d34f7720e4_section_scope_litho_contact_correlations.py
   :language: python
   :lines: 1-25
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens one *migration* — a small, ordered, replayable script that changes the database's shape so an older database can be brought up to what a newer build expects. It names its own *revision id* (its unique code-name, ``e3d34f7720e4``) and its *down_revision* (``e1c2d3a4b5f6``, the migration that runs just before it); these ids form one ordered chain that is the schema's whole history. A ``DATA_REWRITE = True`` flag is set at the top.

**Why it is here.** The docstring records the flag's purpose: this migration deletes existing user rows, so the flag lets the migrator name it among the pending data-rewriting migrations that must be backed up first (production-readiness audit H2b). Correlation edges are the user-drawn links that say two boundaries belong to the same layer across a section.

.. CG-EXPLANATION-END id=module-header

Function ``def upgrade``
------------------------

.. CG-BLOCK id=function:upgrade lines=26-63

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/e3d34f7720e4_section_scope_litho_contact_correlations.py
   :language: python
   :lines: 26-63
   :lineno-match:

.. CG-EXPLANATION-START id=function:upgrade

**What this does.** The *upgrade* step (the forward change). It deletes every correlation-edge row, drops the old uniqueness rule, adds a ``section_id`` *column* (a new field on every row) that may not be empty, links it to the cross-section table by a *foreign key* (a column that must point at a real row in another table) that cascades on delete, adds an *index* (a lookup shortcut) on it, and re-creates the uniqueness rule now including the section.

**Why it is here.** The docstring records the owner directive of 2026-06-08: existing edges carry no section link to back-fill, and re-correlating per section is one click, so the table is emptied first to make the not-empty column safe to add. The point of the change is that a correlation now belongs to one specific cross-section rather than the whole model.

.. CG-EXPLANATION-END id=function:upgrade

Function ``def downgrade``
--------------------------

.. CG-BLOCK id=function:downgrade lines=64-94

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/e3d34f7720e4_section_scope_litho_contact_correlations.py
   :language: python
   :lines: 64-94
   :lineno-match:

.. CG-EXPLANATION-START id=function:downgrade

**What this does.** The *downgrade* step (the reverse change). It empties the table again, removes the section uniqueness rule, index, and foreign key, drops the ``section_id`` column, and restores the narrower model-level uniqueness rule.

**Why it is here.** The docstring explains the clean-slate: after the upgrade two rows may legally differ only by their section, so re-imposing the narrower rule on that data would fail; deleting the rows first avoids the clash. Accepting the data loss is fine because backwards-compatibility is suspended pre-ship.

.. CG-EXPLANATION-END id=function:downgrade

