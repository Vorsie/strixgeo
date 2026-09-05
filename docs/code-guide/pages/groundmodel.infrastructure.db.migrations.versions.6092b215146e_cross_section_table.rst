groundmodel.infrastructure.db.migrations.versions.6092b215146e_cross_section_table
==================================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/migrations/versions/6092b215146e_cross_section_table.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/migrations/versions/6092b215146e_cross_section_table.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-46

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/6092b215146e_cross_section_table.py
   :language: python
   :lines: 1-46
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the migration that creates the ``cross_section`` table — a 2-D slice the user draws through a project to view investigations projected onto a vertical strip and edit the model along that line. Names its revision id and the migration it follows.

**Why it is here.** The docstring records sections are project-scoped, not model-scoped, so two alternative interpretations can both render against the same section without duplicating it; the endpoints are plain doubles (not PostGIS) because a section is a two-vertex line that needs no spatial query at v1, matching the x/y/epsg pattern the CPT and borehole tables already use.

.. CG-EXPLANATION-END id=module-header

Function ``def upgrade``
------------------------

.. CG-BLOCK id=function:upgrade lines=47-123

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/6092b215146e_cross_section_table.py
   :language: python
   :lines: 47-123
   :lineno-match:

.. CG-EXPLANATION-START id=function:upgrade

**What this does.** Creates the ``cross_section`` table: the two line endpoints and their EPSG, the projection buffer, the vertical-exaggeration display hint, arrays of excluded borehole and CPT ids, optional view-window depths, and a display order; plus an index on the project id.

**Why it is here.** The inline comments record the deliberate choices: EPSG is not-null because a section without a coordinate system cannot project an investigation; the exaggeration and view window are saved per section so the .strix bundle reopens with the same proportions on another machine; empty exclusion arrays mean "draw every investigation within the buffer".

.. CG-EXPLANATION-END id=function:upgrade

Function ``def downgrade``
--------------------------

.. CG-BLOCK id=function:downgrade lines=124-127

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/6092b215146e_cross_section_table.py
   :language: python
   :lines: 124-127
   :lineno-match:

.. CG-EXPLANATION-START id=function:downgrade

**What this does.** Drops the project-id index and the ``cross_section`` table.

**Why it is here.** So the chain can step back.

.. CG-EXPLANATION-END id=function:downgrade

