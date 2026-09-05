groundmodel.infrastructure.db.migrations.versions.8a3f2c91d456_cross_section_view_state
=======================================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/migrations/versions/8a3f2c91d456_cross_section_view_state.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/migrations/versions/8a3f2c91d456_cross_section_view_state.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-32

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/8a3f2c91d456_cross_section_view_state.py
   :language: python
   :lines: 1-32
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the migration that adds a ``view_state`` JSON column to the ``cross_section`` table. Names its revision id and the migration it follows.

**Why it is here.** The docstring records per-section display preferences (CPT channel toggles, borehole interpretation toggles, future scale locks) need a persistent home so they ride in the bundle on Save and reopen identically on another machine; without the column the section panel falls back to defaults on every open and the last view is silently discarded. Schema-less JSON matches the project-level ``view_state`` pattern so toggles evolve without a migration each time.

.. CG-EXPLANATION-END id=module-header

Function ``def upgrade``
------------------------

.. CG-BLOCK id=function:upgrade lines=33-44

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/8a3f2c91d456_cross_section_view_state.py
   :language: python
   :lines: 33-44
   :lineno-match:

.. CG-EXPLANATION-START id=function:upgrade

**What this does.** Adds the nullable ``view_state`` JSON column to ``cross_section``.

**Why it is here.** Nullable so existing rows read as empty and the frontend applies its documented defaults.

.. CG-EXPLANATION-END id=function:upgrade

Function ``def downgrade``
--------------------------

.. CG-BLOCK id=function:downgrade lines=45-47

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/8a3f2c91d456_cross_section_view_state.py
   :language: python
   :lines: 45-47
   :lineno-match:

.. CG-EXPLANATION-START id=function:downgrade

**What this does.** Drops the column, losing any persisted per-section preferences.

**Why it is here.** So the chain can step back; the docstring states plainly that stepping back discards the preferences.

.. CG-EXPLANATION-END id=function:downgrade

