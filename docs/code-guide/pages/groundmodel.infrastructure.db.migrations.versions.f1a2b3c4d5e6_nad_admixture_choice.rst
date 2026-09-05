groundmodel.infrastructure.db.migrations.versions.f1a2b3c4d5e6_nad_admixture_choice
===================================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/migrations/versions/f1a2b3c4d5e6_nad_admixture_choice.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/migrations/versions/f1a2b3c4d5e6_nad_admixture_choice.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-36

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/f1a2b3c4d5e6_nad_admixture_choice.py
   :language: python
   :lines: 1-36
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Header for the migration (revision ``f1a2b3c4d5e6``, following ``c6d7e8f9a0b1``) that adds one nullable text column, ``nad_admixture_choice``, to the formation table.

**Why it is here.** The docstring records the owner ruling of 2026-09-04: when a litho unit's admixture could be read either way, the engineer is asked whether to classify it into the pure NAD class family or the with-admixture family, and the answer is saved here so a re-divide does not re-ask. NAD refers to the Belgian national annex table (NBN EN 1997-1 ANB Tabel 2.1). Empty means not answered, so the classifier keeps its automatic behaviour.

.. CG-EXPLANATION-END id=module-header

Function ``def upgrade``
------------------------

.. CG-BLOCK id=function:upgrade lines=37-41

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/f1a2b3c4d5e6_nad_admixture_choice.py
   :language: python
   :lines: 37-41
   :lineno-match:

.. CG-EXPLANATION-START id=function:upgrade

**What this does.** Adds the nullable ``nad_admixture_choice`` text column to the formation table.

**Why it is here.** The docstring notes this is a plain additive column; backwards-compatibility is suspended pre-ship, and an existing project reads back empty (today's behaviour) until the engineer answers the prompt.

.. CG-EXPLANATION-END id=function:upgrade

Function ``def downgrade``
--------------------------

.. CG-BLOCK id=function:downgrade lines=42-44

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/f1a2b3c4d5e6_nad_admixture_choice.py
   :language: python
   :lines: 42-44
   :lineno-match:

.. CG-EXPLANATION-START id=function:downgrade

**What this does.** Drops the ``nad_admixture_choice`` column.

**Why it is here.** This reverses the single-column addition.

.. CG-EXPLANATION-END id=function:downgrade

