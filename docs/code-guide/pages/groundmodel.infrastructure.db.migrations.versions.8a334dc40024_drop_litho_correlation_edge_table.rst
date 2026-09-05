groundmodel.infrastructure.db.migrations.versions.8a334dc40024_drop_litho_correlation_edge_table
================================================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/migrations/versions/8a334dc40024_drop_litho_correlation_edge_table.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/migrations/versions/8a334dc40024_drop_litho_correlation_edge_table.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-27

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/8a334dc40024_drop_litho_correlation_edge_table.py
   :language: python
   :lines: 1-27
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the migration that drops the formation-level ``litho_correlation_edge`` table. Names its revision id and the migration it follows.

**Why it is here.** The docstring records this is a pre-ship cleanup (backwards-compat suspended, project_backwards_compat_suspended): all consumers were rewritten in issue #133 to derive the formation graph from the finer contact-level edges (``litho_contact_correlation_edge``), so the formation-level table is no longer referenced by any application code.

.. CG-EXPLANATION-END id=module-header

Function ``def upgrade``
------------------------

.. CG-BLOCK id=function:upgrade lines=28-32

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/8a334dc40024_drop_litho_correlation_edge_table.py
   :language: python
   :lines: 28-32
   :lineno-match:

.. CG-EXPLANATION-START id=function:upgrade

**What this does.** Drops the ``litho_correlation_edge`` table (its indexes and constraints go with it).

**Why it is here.** The table is dead code now that everything reads the contact-level edges.

.. CG-EXPLANATION-END id=function:upgrade

Function ``def downgrade``
--------------------------

.. CG-BLOCK id=function:downgrade lines=33-47

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/8a334dc40024_drop_litho_correlation_edge_table.py
   :language: python
   :lines: 33-47
   :lineno-match:

.. CG-EXPLANATION-START id=function:downgrade

**What this does.** Raises "not implemented" — the downgrade is deliberately unsupported.

**Why it is here.** The docstring records the table's data is lost on drop and re-creating it empty restores nothing; because backwards-compat is suspended pre-ship, the recovery path is to revert the application code, not to step this migration back.

.. CG-EXPLANATION-END id=function:downgrade

