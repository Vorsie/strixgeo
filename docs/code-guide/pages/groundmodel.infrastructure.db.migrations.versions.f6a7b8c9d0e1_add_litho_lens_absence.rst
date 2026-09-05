groundmodel.infrastructure.db.migrations.versions.f6a7b8c9d0e1_add_litho_lens_absence
=====================================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/migrations/versions/f6a7b8c9d0e1_add_litho_lens_absence.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/migrations/versions/f6a7b8c9d0e1_add_litho_lens_absence.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-45

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/f6a7b8c9d0e1_add_litho_lens_absence.py
   :language: python
   :lines: 1-45
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Header for the migration (revision ``f6a7b8c9d0e1``, following ``e5f6a7b8c9d0``) that adds ``litho_lens_absence`` — a table recording that a given investigation shows positive evidence a lens is absent at the depth it would occupy.

**Why it is here.** The docstring records the #101 Slice 2 design: there is no foreign key on the investigation id because a discriminator column names whether it is a borehole or a CPT (PostgreSQL has no way to point one foreign key at two tables); the kind is kept in a check constraint so new investigation types can be allowed by a later migration; deleting the lens removes its absence records; and a unique constraint stops a lens declaring the same investigation absent twice.

.. CG-EXPLANATION-END id=module-header

Function ``def upgrade``
------------------------

.. CG-BLOCK id=function:upgrade lines=46-111

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/f6a7b8c9d0e1_add_litho_lens_absence.py
   :language: python
   :lines: 46-111
   :lineno-match:

.. CG-EXPLANATION-START id=function:upgrade

**What this does.** Creates the table with an id, a cascading link to the lens, a polymorphic investigation id, a kind discriminator, and a timestamp; adds a check constraint limiting the kind to ``borehole`` or ``cpt``, a unique constraint on lens-plus-kind-plus-investigation, and an index by lens.

**Why it is here.** The comments explain the index serves the dominant query (all absences for one lens), and the constraints are named so they can be dropped and replaced when a new investigation type is introduced.

.. CG-EXPLANATION-END id=function:upgrade

Function ``def downgrade``
--------------------------

.. CG-BLOCK id=function:downgrade lines=112-115

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/f6a7b8c9d0e1_add_litho_lens_absence.py
   :language: python
   :lines: 112-115
   :lineno-match:

.. CG-EXPLANATION-START id=function:downgrade

**What this does.** Drops the lens index and then the ``litho_lens_absence`` table.

**Why it is here.** The reverse in dependency order.

.. CG-EXPLANATION-END id=function:downgrade

