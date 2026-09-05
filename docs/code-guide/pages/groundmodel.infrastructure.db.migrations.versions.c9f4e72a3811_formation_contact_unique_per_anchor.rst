groundmodel.infrastructure.db.migrations.versions.c9f4e72a3811_formation_contact_unique_per_anchor
==================================================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/migrations/versions/c9f4e72a3811_formation_contact_unique_per_anchor.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/migrations/versions/c9f4e72a3811_formation_contact_unique_per_anchor.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-42

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/c9f4e72a3811_formation_contact_unique_per_anchor.py
   :language: python
   :lines: 1-42
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A migration that adds two partial unique indexes to ``formation_contact``, enforcing one formation top per investigation. The header carries its revision id and the id it follows.

**Why it is here.** The docstring records a race: the rule was enforced only in the application, so copying contacts from several sources onto one target fired many parallel creates that each saw no-existing at once and all inserted, leaving duplicates and later errors. Moving the rule into the database closes the race. Because a contact is anchored by borehole or CPT but never both, one full index is impossible, so two partial indexes are used — each fires only when its anchor column is present.

.. CG-EXPLANATION-END id=module-header

Function ``def upgrade``
------------------------

.. CG-BLOCK id=function:upgrade lines=43-60

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/c9f4e72a3811_formation_contact_unique_per_anchor.py
   :language: python
   :lines: 43-60
   :lineno-match:

.. CG-EXPLANATION-START id=function:upgrade

**What this does.** Creates the two partial unique indexes on (model, formation, borehole) and (model, formation, CPT), each over rows where that anchor is present.

**Why it is here.** Two partial indexes are the way to enforce the invariant given the borehole-or-CPT anchoring; the docstring notes duplicates were deduped in the app before this ran, or the migration would fail on a unique violation.

.. CG-EXPLANATION-END id=function:upgrade

Function ``def downgrade``
--------------------------

.. CG-BLOCK id=function:downgrade lines=61-70

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/c9f4e72a3811_formation_contact_unique_per_anchor.py
   :language: python
   :lines: 61-70
   :lineno-match:

.. CG-EXPLANATION-START id=function:downgrade

**What this does.** Drops the two partial unique indexes.

**Why it is here.** The exact reverse of the upgrade.

.. CG-EXPLANATION-END id=function:downgrade

