groundmodel.infrastructure.db.migrations.versions.b5c6d7e8f9a0_add_body_union
=============================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/migrations/versions/b5c6d7e8f9a0_add_body_union.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/migrations/versions/b5c6d7e8f9a0_add_body_union.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-34

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/b5c6d7e8f9a0_add_body_union.py
   :language: python
   :lines: 1-34
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A migration that creates the body-union table — the storage behind the user's "Join with…" verb.

**Why it is here.** The docstring cites the owner ruling (debt #278): a union is the positive half of the body-identity rule and the counterpart to a separation. Where a separation forbids its two anchors from sharing a body, a union requires it — a must-link constraint in layer-id space that only the user writes. It is additive and cleanly reversible: an empty table changes no behaviour, so every prior bundle restores unchanged. It is hand-written to mirror the separation table's shape (canonical-ordered layer pair, per-model uniqueness, cascade on the model and both layers).

.. CG-EXPLANATION-END id=module-header

Function ``def upgrade``
------------------------

.. CG-BLOCK id=function:upgrade lines=35-69

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/b5c6d7e8f9a0_add_body_union.py
   :language: python
   :lines: 35-69
   :lineno-match:

.. CG-EXPLANATION-START id=function:upgrade

**What this does.** Creates the body-union table and its per-model index.

**Why it is here.** Adds the store the resolver reads as must-link constraints; the index speeds finding a model's unions.

.. CG-EXPLANATION-END id=function:upgrade

Function ``def downgrade``
--------------------------

.. CG-BLOCK id=function:downgrade lines=70-73

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/b5c6d7e8f9a0_add_body_union.py
   :language: python
   :lines: 70-73
   :lineno-match:

.. CG-EXPLANATION-START id=function:downgrade

**What this does.** Drops the index and the body-union table.

**Why it is here.** So the chain can step backwards; safe because an empty union table changed nothing.

.. CG-EXPLANATION-END id=function:downgrade

