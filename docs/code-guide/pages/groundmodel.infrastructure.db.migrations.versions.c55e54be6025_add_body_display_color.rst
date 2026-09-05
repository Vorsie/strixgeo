groundmodel.infrastructure.db.migrations.versions.c55e54be6025_add_body_display_color
=====================================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/migrations/versions/c55e54be6025_add_body_display_color.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/migrations/versions/c55e54be6025_add_body_display_color.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-18

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/c55e54be6025_add_body_display_color.py
   :language: python
   :lines: 1-18
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A short migration that adds one nullable column, ``display_color``, to the ``body`` table. The header carries its revision id and the id it follows.

**Why it is here.** Why: not recorded — ask the owner

.. CG-EXPLANATION-END id=module-header

Function ``def upgrade``
------------------------

.. CG-BLOCK id=function:upgrade lines=19-23

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/c55e54be6025_add_body_display_color.py
   :language: python
   :lines: 19-23
   :lineno-match:

.. CG-EXPLANATION-START id=function:upgrade

**What this does.** Adds the nullable ``display_color`` text column to ``body``.

**Why it is here.** Why: not recorded — ask the owner

.. CG-EXPLANATION-END id=function:upgrade

Function ``def downgrade``
--------------------------

.. CG-BLOCK id=function:downgrade lines=24-26

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/c55e54be6025_add_body_display_color.py
   :language: python
   :lines: 24-26
   :lineno-match:

.. CG-EXPLANATION-START id=function:downgrade

**What this does.** Drops the ``display_color`` column.

**Why it is here.** The exact reverse of the upgrade.

.. CG-EXPLANATION-END id=function:downgrade

