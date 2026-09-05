groundmodel.infrastructure.db.migrations.versions.l6f7a8b9c0d1_add_litho_contact_correlation_edge
=================================================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/migrations/versions/l6f7a8b9c0d1_add_litho_contact_correlation_edge.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/migrations/versions/l6f7a8b9c0d1_add_litho_contact_correlation_edge.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-45

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/l6f7a8b9c0d1_add_litho_contact_correlation_edge.py
   :language: python
   :lines: 1-45
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Header for the migration (revision ``l6f7a8b9c0d1``, following ``k5e6f7a8b9c0``) that creates ``litho_contact_correlation_edge`` — a table of boundary-to-boundary correlation edges, joining individual contacts rather than whole formations.

**Why it is here.** The docstring records this is Phase 1 of debt #133 (owner directive 2026-05-25); it coexists with the older formation-level correlation table. The design choices mirror that table — cascading deletes, a fixed endpoint order with a unique triple, a no-self-loop check, and the same provenance tokens — and it keeps the timestamp defaults permanent to avoid the empty-value bug fixed in revision ``k5e6f7a8b9c0``.

.. CG-EXPLANATION-END id=module-header

Function ``def upgrade``
------------------------

.. CG-BLOCK id=function:upgrade lines=46-119

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/l6f7a8b9c0d1_add_litho_contact_correlation_edge.py
   :language: python
   :lines: 46-119
   :lineno-match:

.. CG-EXPLANATION-START id=function:upgrade

**What this does.** Creates the table with an id, model link, the two contact endpoints, a source token and two timestamps; adds check constraints for the fixed order, no self-loop and the source values, a unique constraint on the triple, and an index by model.

**Why it is here.** The comments repeat the shared conventions: the use case normalises the endpoint pair before every insert and the checks are defence in depth, while the index serves the common list-all-edges-for-a-model query.

.. CG-EXPLANATION-END id=function:upgrade

Function ``def downgrade``
--------------------------

.. CG-BLOCK id=function:downgrade lines=120-123

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/l6f7a8b9c0d1_add_litho_contact_correlation_edge.py
   :language: python
   :lines: 120-123
   :lineno-match:

.. CG-EXPLANATION-START id=function:downgrade

**What this does.** Drops the model index and then the table.

**Why it is here.** The reverse in dependency order.

.. CG-EXPLANATION-END id=function:downgrade

