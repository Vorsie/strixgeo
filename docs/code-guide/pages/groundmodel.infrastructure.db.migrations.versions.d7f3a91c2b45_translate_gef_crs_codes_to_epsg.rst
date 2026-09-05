groundmodel.infrastructure.db.migrations.versions.d7f3a91c2b45_translate_gef_crs_codes_to_epsg
==============================================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/migrations/versions/d7f3a91c2b45_translate_gef_crs_codes_to_epsg.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/migrations/versions/d7f3a91c2b45_translate_gef_crs_codes_to_epsg.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-85

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/d7f3a91c2b45_translate_gef_crs_codes_to_epsg.py
   :language: python
   :lines: 1-85
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A migration that repairs CPT rows whose stored coordinate-system codes are GEF codelist codes rather than real EPSG codes. A coordinate reference system (CRS) is the map grid coordinates are measured in; EPSG is the standard numbering of those systems. The header carries its revision id, the id it follows, a ``DATA_REWRITE = True`` flag, and two literal code-mapping constants.

**Why it is here.** The docstring records the audit finding: the parser used to store the number from the GEF header as if it were an EPSG code, when it is really a GEF codelist code. The parser now translates it, but that fixed only new imports, so a project could hold two conventions for the same physical system and every EPSG-keyed consumer treated them as different. This migration re-stamps the old rows. The mapping is kept literal, not imported from the parser, because a migration must reproduce the mapping as it was when it ran.

.. CG-EXPLANATION-END id=module-header

Function ``def upgrade``
------------------------

.. CG-BLOCK id=function:upgrade lines=86-103

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/d7f3a91c2b45_translate_gef_crs_codes_to_epsg.py
   :language: python
   :lines: 86-103
   :lineno-match:

.. CG-EXPLANATION-START id=function:upgrade

**What this does.** For each horizontal code, re-stamps the stored geometry's system id first and then the ``epsg`` column; for the vertical code, re-stamps ``z_epsg`` and the elevation-rollback snapshot ``original_z_epsg``.

**Why it is here.** The geometry is re-stamped before ``epsg`` because it is keyed on the system id still on the row. The elevation-rollback snapshot must travel with it, the docstring notes, or clearing a manual elevation edit would restore a GEF-code datum. The docstring also explains why mapping by value is safe here: none of the source values is a CRS this application could legitimately hold.

.. CG-EXPLANATION-END id=function:upgrade

Function ``def downgrade``
--------------------------

.. CG-BLOCK id=function:downgrade lines=104-111

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/d7f3a91c2b45_translate_gef_crs_codes_to_epsg.py
   :language: python
   :lines: 104-111
   :lineno-match:

.. CG-EXPLANATION-START id=function:downgrade

**What this does.** Does nothing.

**Why it is here.** The docstring explains the reverse is undecidable: after the repair, a row reading 31370 could be a repaired GEF import or a DOV import that always read 31370, and re-tagging both would corrupt the second group.

.. CG-EXPLANATION-END id=function:downgrade

