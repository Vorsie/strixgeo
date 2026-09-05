groundmodel.infrastructure.db.migrations.versions.m7g8h9i0j1k2_add_litho_layer
==============================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/migrations/versions/m7g8h9i0j1k2_add_litho_layer.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/migrations/versions/m7g8h9i0j1k2_add_litho_layer.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-59

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/m7g8h9i0j1k2_add_litho_layer.py
   :language: python
   :lines: 1-59
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Header for the migration (revision ``m7g8h9i0j1k2``, following ``b2f1c9a47d30``) that creates the ``litho_layer`` table — one lithology interval at one investigation anchor, with a status and depth bounds — for the unified litho boundary model.

**Why it is here.** The docstring records the design spec: a layer replaces the older dual representation (an in-memory suggestion plus a per-boundary contact) for lithostratigraphic models. This migration only creates the table and its guards; the back-fill of existing contacts into layers is a later slice, so the two models coexist during the transition. The design notes cascade rules, a two-anchor rule (exactly one of borehole or CPT is set), a depth-ordering check, and whitelists on status, source and confidence.

.. CG-EXPLANATION-END id=module-header

Function ``def upgrade``
------------------------

.. CG-BLOCK id=function:upgrade lines=60-193

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/m7g8h9i0j1k2_add_litho_layer.py
   :language: python
   :lines: 60-193
   :lineno-match:

.. CG-EXPLANATION-START id=function:upgrade

**What this does.** Creates the table with its id, model and formation links, the borehole and CPT anchors, depth bounds, status, source, optional observation links, a parent geo-contact link, confidence, notes and timestamps; adds check constraints for the single-anchor rule, depth ordering, and the status, source and confidence whitelists; and adds five indexes for the dominant read patterns.

**Why it is here.** The comments map each index to a read pattern (per-anchor sorted list, status filter, per-formation list, litho-to-geo coupling), and note the timestamp defaults are kept for the same reason as the earlier empty-value fix.

.. CG-EXPLANATION-END id=function:upgrade

Function ``def downgrade``
--------------------------

.. CG-BLOCK id=function:downgrade lines=194-201

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/m7g8h9i0j1k2_add_litho_layer.py
   :language: python
   :lines: 194-201
   :lineno-match:

.. CG-EXPLANATION-START id=function:downgrade

**What this does.** Drops the five indexes and then the ``litho_layer`` table.

**Why it is here.** The reverse in dependency order.

.. CG-EXPLANATION-END id=function:downgrade

