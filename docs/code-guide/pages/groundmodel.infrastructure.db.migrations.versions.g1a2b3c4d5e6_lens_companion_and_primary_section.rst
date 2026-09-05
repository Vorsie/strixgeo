groundmodel.infrastructure.db.migrations.versions.g1a2b3c4d5e6_lens_companion_and_primary_section
=================================================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/migrations/versions/g1a2b3c4d5e6_lens_companion_and_primary_section.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/migrations/versions/g1a2b3c4d5e6_lens_companion_and_primary_section.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-46

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/g1a2b3c4d5e6_lens_companion_and_primary_section.py
   :language: python
   :lines: 1-46
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Header for the migration (revision ``g1a2b3c4d5e6``, following ``f6a7b8c9d0e1``) that adds a primary-section link to the lens table and two companion columns to the cross-section table.

**Why it is here.** The docstring records this is Slice 4 of debt #101, perpendicular companion sections: the lens records which section it was defined on so the companion-creation step can find its geometry directly; the cross-section records which lens it was auto-created as a companion for, plus a boolean badge that stays true even after the lens is deleted. All additions are nullable or defaulted so no existing row is affected.

.. CG-EXPLANATION-END id=module-header

Function ``def upgrade``
------------------------

.. CG-BLOCK id=function:upgrade lines=47-102

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/g1a2b3c4d5e6_lens_companion_and_primary_section.py
   :language: python
   :lines: 47-102
   :lineno-match:

.. CG-EXPLANATION-START id=function:upgrade

**What this does.** Adds the nullable ``primary_section_id`` to the lens with a set-empty-on-delete foreign key; adds the nullable ``companion_lens_id`` to the cross-section with a set-empty-on-delete foreign key; and adds an ``is_lens_companion`` boolean defaulting to false.

**Why it is here.** The docstring explains the set-empty-on-delete choice keeps a lens or section alive when its partner is deleted rather than cascading the delete, and the boolean lets the UI show a 'was a lens companion' badge without an extra query.

.. CG-EXPLANATION-END id=function:upgrade

Function ``def downgrade``
--------------------------

.. CG-BLOCK id=function:downgrade lines=103-109

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/g1a2b3c4d5e6_lens_companion_and_primary_section.py
   :language: python
   :lines: 103-109
   :lineno-match:

.. CG-EXPLANATION-START id=function:downgrade

**What this does.** Removes the two cross-section additions and their foreign key, then the lens's primary-section foreign key and column.

**Why it is here.** The reverse in dependency order.

.. CG-EXPLANATION-END id=function:downgrade

