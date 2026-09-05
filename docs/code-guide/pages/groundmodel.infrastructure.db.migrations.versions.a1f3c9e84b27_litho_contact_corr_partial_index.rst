groundmodel.infrastructure.db.migrations.versions.a1f3c9e84b27_litho_contact_corr_partial_index
===============================================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/migrations/versions/a1f3c9e84b27_litho_contact_corr_partial_index.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/migrations/versions/a1f3c9e84b27_litho_contact_corr_partial_index.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-24

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/a1f3c9e84b27_litho_contact_corr_partial_index.py
   :language: python
   :lines: 1-24
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A migration that adds a *partial index* — a lookup structure covering only the rows matching a condition — on the correlation-edge table's model reference, restricted to approved edges.

**Why it is here.** The docstring records the audit finding: the resolver and section render filter approved edges for a model, so an index carrying only the approved rows is smaller and more selective than a plain index that also covers the speculative auto-generated edges.

.. CG-EXPLANATION-END id=module-header

Function ``def upgrade``
------------------------

.. CG-BLOCK id=function:upgrade lines=25-35

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/a1f3c9e84b27_litho_contact_corr_partial_index.py
   :language: python
   :lines: 25-35
   :lineno-match:

.. CG-EXPLANATION-START id=function:upgrade

**What this does.** Creates the partial index on the model reference, restricted to approved rows.

**Why it is here.** Makes the common "approved edges for this model" query fast without indexing the unapproved ones.

.. CG-EXPLANATION-END id=function:upgrade

Function ``def downgrade``
--------------------------

.. CG-BLOCK id=function:downgrade lines=36-41

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/a1f3c9e84b27_litho_contact_corr_partial_index.py
   :language: python
   :lines: 36-41
   :lineno-match:

.. CG-EXPLANATION-START id=function:downgrade

**What this does.** Drops the partial index.

**Why it is here.** So the chain can step backwards; the reverse of the create.

.. CG-EXPLANATION-END id=function:downgrade

