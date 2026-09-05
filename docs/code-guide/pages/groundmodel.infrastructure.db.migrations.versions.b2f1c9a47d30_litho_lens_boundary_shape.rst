groundmodel.infrastructure.db.migrations.versions.b2f1c9a47d30_litho_lens_boundary_shape
========================================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/migrations/versions/b2f1c9a47d30_litho_lens_boundary_shape.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/migrations/versions/b2f1c9a47d30_litho_lens_boundary_shape.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-29

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/b2f1c9a47d30_litho_lens_boundary_shape.py
   :language: python
   :lines: 1-29
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A migration that adds user-authored lens-boundary shaping: a stable content key on the lens table, a lens-shape table, and a boundary-node table.

**Why it is here.** The docstring records (feature #163f) that the shape must survive lens re-detection, so it is keyed by a content key derived from the lens's three defining contact ids rather than by the volatile body ordinal. The shape table holds the render style and owns the boundary nodes; the boundary-node table holds the ordered control points of each boundary in section-local coordinates.

.. CG-EXPLANATION-END id=module-header

Function ``def upgrade``
------------------------

.. CG-BLOCK id=function:upgrade lines=30-102

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/b2f1c9a47d30_litho_lens_boundary_shape.py
   :language: python
   :lines: 30-102
   :lineno-match:

.. CG-EXPLANATION-START id=function:upgrade

**What this does.** Adds the content-key column (with an index) to the lens table, then creates the lens-shape and boundary-node tables with their indexes.

**Why it is here.** The content key is the stable join between a re-detected lens and its saved shape; the two new tables store the shape and its control points.

.. CG-EXPLANATION-END id=function:upgrade

Function ``def downgrade``
--------------------------

.. CG-BLOCK id=function:downgrade lines=103-109

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/b2f1c9a47d30_litho_lens_boundary_shape.py
   :language: python
   :lines: 103-109
   :lineno-match:

.. CG-EXPLANATION-START id=function:downgrade

**What this does.** Drops the boundary-node and lens-shape tables and the content-key column.

**Why it is here.** So the chain can step backwards; the reverse of the upgrade, in dependency order.

.. CG-EXPLANATION-END id=function:downgrade

