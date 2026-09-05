groundmodel.infrastructure.db.migrations.versions.7a904176d0c9_body_name_to_text
================================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/migrations/versions/7a904176d0c9_body_name_to_text.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/migrations/versions/7a904176d0c9_body_name_to_text.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-23

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/7a904176d0c9_body_name_to_text.py
   :language: python
   :lines: 1-23
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the migration that widens the ``body.name`` column from a length-capped ``VARCHAR(120)`` to unbounded ``TEXT``. Names its revision id and the migration it follows.

**Why it is here.** The docstring records the CLAUDE.md schema-design rule: a body name is free-form text entered by the user, and free-form columns are ``TEXT`` (``VARCHAR(N)`` is reserved for fixed-spec codes, enums and ids) so they never surprise-truncate. No data changes — every existing value already fits (debt #126).

.. CG-EXPLANATION-END id=module-header

Function ``def upgrade``
------------------------

.. CG-BLOCK id=function:upgrade lines=24-34

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/7a904176d0c9_body_name_to_text.py
   :language: python
   :lines: 24-34
   :lineno-match:

.. CG-EXPLANATION-START id=function:upgrade

**What this does.** Changes the ``body.name`` column type to ``TEXT``, keeping it nullable.

**Why it is here.** This is the whole point of the migration — remove the length cap that could truncate a long user-entered label.

.. CG-EXPLANATION-END id=function:upgrade

Function ``def downgrade``
--------------------------

.. CG-BLOCK id=function:downgrade lines=35-44

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/7a904176d0c9_body_name_to_text.py
   :language: python
   :lines: 35-44
   :lineno-match:

.. CG-EXPLANATION-START id=function:downgrade

**What this does.** Narrows the column back to ``VARCHAR(120)``, truncating any value longer than 120 characters on the way down.

**Why it is here.** The docstring notes the truncation is unavoidable when stepping back to the capped type; it is stated plainly so a downgrade is a conscious choice.

.. CG-EXPLANATION-END id=function:downgrade

