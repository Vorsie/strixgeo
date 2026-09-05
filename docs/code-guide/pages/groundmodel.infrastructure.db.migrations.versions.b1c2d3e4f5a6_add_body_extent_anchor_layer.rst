groundmodel.infrastructure.db.migrations.versions.b1c2d3e4f5a6_add_body_extent_anchor_layer
===========================================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/migrations/versions/b1c2d3e4f5a6_add_body_extent_anchor_layer.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/migrations/versions/b1c2d3e4f5a6_add_body_extent_anchor_layer.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-34

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/b1c2d3e4f5a6_add_body_extent_anchor_layer.py
   :language: python
   :lines: 1-34
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A migration that adds two nullable anchor-layer foreign-key columns (left and right) to the body table.

**Why it is here.** The docstring records these are the spatial source of truth for where a body's lateral cap renders — the layer the user or detector anchored each side to — replacing a lossy re-derive-at-render-time path that produced wrong-column and half-width bugs. Both are nullable (legacy bodies and to-target caps have no anchor, so the renderer keeps its edge-member fallback) and set themselves empty on the layer's deletion so removing a layer never deletes a body. The resolver re-attaches an anchored cap after an instance renumber, which is what makes a user-claimed open survive (debt #195).

.. CG-EXPLANATION-END id=module-header

Function ``def upgrade``
------------------------

.. CG-BLOCK id=function:upgrade lines=35-52

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/b1c2d3e4f5a6_add_body_extent_anchor_layer.py
   :language: python
   :lines: 35-52
   :lineno-match:

.. CG-EXPLANATION-START id=function:upgrade

**What this does.** Adds the two nullable anchor-layer columns and their foreign keys.

**Why it is here.** Records each cap's anchor explicitly so the renderer no longer has to guess the column and interval from body geometry.

.. CG-EXPLANATION-END id=function:upgrade

Function ``def downgrade``
--------------------------

.. CG-BLOCK id=function:downgrade lines=53-57

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/b1c2d3e4f5a6_add_body_extent_anchor_layer.py
   :language: python
   :lines: 53-57
   :lineno-match:

.. CG-EXPLANATION-START id=function:downgrade

**What this does.** Drops the two anchor foreign keys and columns.

**Why it is here.** So the chain can step backwards; the reverse of the upgrade.

.. CG-EXPLANATION-END id=function:downgrade

