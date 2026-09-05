groundmodel.infrastructure.db.migrations.versions.c6d7e8f9a0b1_add_sample_geotech_body_fk
=========================================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/migrations/versions/c6d7e8f9a0b1_add_sample_geotech_body_fk.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/migrations/versions/c6d7e8f9a0b1_add_sample_geotech_body_fk.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-42

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/c6d7e8f9a0b1_add_sample_geotech_body_fk.py
   :language: python
   :lines: 1-42
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A migration that turns a bare id column, ``sample.geotech_body_id``, into a real foreign key, and clears any that already point at a deleted body. The header carries its revision id, the id it follows, and a ``DATA_REWRITE = True`` flag.

**Why it is here.** The docstring records a readiness-audit finding: the id column had no foreign key, yet bodies are deleted, so a deleted body left a dangling pointer on every sample it grouped. The fix clears those danglers and adds a proper foreign key set to clear the pointer when the body is deleted, mirroring the sibling ``litho_layer.body_id``. The ``DATA_REWRITE`` flag tells the migrator this step edits user rows, so it names the migration in its pre-migration backup.

.. CG-EXPLANATION-END id=module-header

Function ``def upgrade``
------------------------

.. CG-BLOCK id=function:upgrade lines=43-64

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/c6d7e8f9a0b1_add_sample_geotech_body_fk.py
   :language: python
   :lines: 43-64
   :lineno-match:

.. CG-EXPLANATION-START id=function:upgrade

**What this does.** First sets ``geotech_body_id`` to empty on every sample whose value points at a body that no longer exists, then adds the foreign key set to clear the pointer on body deletion.

**Why it is here.** Order matters: PostgreSQL validates existing rows when adding a foreign key, so a dangling id would make the add fail — the docstring states this explicitly.

.. CG-EXPLANATION-END id=function:upgrade

Function ``def downgrade``
--------------------------

.. CG-BLOCK id=function:downgrade lines=65-67

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/c6d7e8f9a0b1_add_sample_geotech_body_fk.py
   :language: python
   :lines: 65-67
   :lineno-match:

.. CG-EXPLANATION-START id=function:downgrade

**What this does.** Drops the foreign-key constraint; the cleared danglers stay cleared.

**Why it is here.** The docstring notes the danglers were invalid pointers, so leaving them empty is correct even after the constraint is gone.

.. CG-EXPLANATION-END id=function:downgrade

