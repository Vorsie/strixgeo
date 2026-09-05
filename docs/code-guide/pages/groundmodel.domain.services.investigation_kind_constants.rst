groundmodel.domain.services.investigation_kind_constants
========================================================

.. CG-PAGE source=src/groundmodel/domain/services/investigation_kind_constants.py complete=true

*Source file:* ``src/groundmodel/domain/services/investigation_kind_constants.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-26

.. literalinclude:: ../../../src/groundmodel/domain/services/investigation_kind_constants.py
   :language: python
   :lines: 1-26
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Defines the two investigation kinds a litho layer can hang off — the text tokens for a CPT and a borehole — and lists them as the module's public names.

**Why it is here.** A litho layer anchors to exactly one investigation, and several consumers need to tell a cone from a borehole without re-deriving it from which foreign key is empty: the body layer pick carries the kind so the coordinate-resolving branch keeps it, and the voxel honour rule ranks a cone above a borehole when the two share one grid cell. The tokens live here, describing an investigation rather than a voxel rule or a pick, so the repository does not have to import a 3-D-builder module just to fill a generic field. They are lowercase domain tokens matching the column names, translated only if ever shown.

.. CG-EXPLANATION-END id=module-header

