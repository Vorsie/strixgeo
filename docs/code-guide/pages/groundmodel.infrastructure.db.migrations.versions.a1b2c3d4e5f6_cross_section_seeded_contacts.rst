groundmodel.infrastructure.db.migrations.versions.a1b2c3d4e5f6_cross_section_seeded_contacts
============================================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/migrations/versions/a1b2c3d4e5f6_cross_section_seeded_contacts.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/migrations/versions/a1b2c3d4e5f6_cross_section_seeded_contacts.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-38

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/a1b2c3d4e5f6_cross_section_seeded_contacts.py
   :language: python
   :lines: 1-38
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the migration that adds a ``seeded_formation_contact_ids`` array column to ``cross_section``. Names its revision id and the migration it follows.

**Why it is here.** The docstring records the owner directive (2026-05-17): a freshly-drawn section shows investigations only, and formation content appears on a section ONLY where the user explicitly placed it via that section's "Seed from stratigraphy" button or manual drawing. The empty-array default means "nothing seeded yet — show investigations only". This is an intentional breaking behaviour change (pre-migration sections showed all contacts), which is allowed because backwards-compat is suspended pre-ship.

.. CG-EXPLANATION-END id=module-header

Function ``def upgrade``
------------------------

.. CG-BLOCK id=function:upgrade lines=39-51

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/a1b2c3d4e5f6_cross_section_seeded_contacts.py
   :language: python
   :lines: 39-51
   :lineno-match:

.. CG-EXPLANATION-START id=function:upgrade

**What this does.** Adds the non-null ``seeded_formation_contact_ids`` array column defaulting to an empty array.

**Why it is here.** The comment records the not-null-empty-default is safe for existing rows (Postgres fills each with an empty array), and mirrors the existing excluded-id array columns so the plumbing is consistent.

.. CG-EXPLANATION-END id=function:upgrade

Function ``def downgrade``
--------------------------

.. CG-BLOCK id=function:downgrade lines=52-54

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/a1b2c3d4e5f6_cross_section_seeded_contacts.py
   :language: python
   :lines: 52-54
   :lineno-match:

.. CG-EXPLANATION-START id=function:downgrade

**What this does.** Removes the ``seeded_formation_contact_ids`` column.

**Why it is here.** So the chain can step back.

.. CG-EXPLANATION-END id=function:downgrade

