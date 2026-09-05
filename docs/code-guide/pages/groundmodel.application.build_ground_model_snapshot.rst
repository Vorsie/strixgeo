groundmodel.application.build_ground_model_snapshot
===================================================

.. CG-PAGE source=src/groundmodel/application/build_ground_model_snapshot.py complete=true

*Source file:* ``src/groundmodel/application/build_ground_model_snapshot.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-58

.. literalinclude:: ../../../src/groundmodel/application/build_ground_model_snapshot.py
   :language: python
   :lines: 1-58
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the whole-model snapshot builder. It imports the snapshot value objects it produces, the borehole/CPT/geology/project repositories, the parse-error exception and the logger, and defines a fallback thickness for the deepest layer.

**Why it is here.** The docstring records that this is the project-wide counterpart of the section snapshot: it keeps every CPT and borehole in its own (easting, northing, elevation) frame, which is the shape Plaxis 3-D wants because that tool re-interpolates between boreholes itself. The exporter never sees the database — it receives the finished value object. The half-metre fallback is chosen small enough that an engineer will notice and fix it, yet large enough that the layer is not degenerate.

.. CG-EXPLANATION-END id=module-header

Class ``BuildGroundModelSnapshot`` — header
-------------------------------------------

.. CG-BLOCK id=class:BuildGroundModelSnapshot lines=59-61

.. literalinclude:: ../../../src/groundmodel/application/build_ground_model_snapshot.py
   :language: python
   :lines: 59-61
   :lineno-match:

.. CG-EXPLANATION-START id=class:BuildGroundModelSnapshot

**What this does.** Declares the use-case class that materialises the data needed to export a whole geological model.

**Why it is here.** Why: recorded in the class + module docstrings — the single place the project-wide snapshot is assembled so every project exporter sees one consistent shape.

.. CG-EXPLANATION-END id=class:BuildGroundModelSnapshot

Method ``BuildGroundModelSnapshot``. ``def __init__``
-----------------------------------------------------

.. CG-BLOCK id=method:BuildGroundModelSnapshot.__init__ lines=62-66

.. literalinclude:: ../../../src/groundmodel/application/build_ground_model_snapshot.py
   :language: python
   :lines: 62-66
   :lineno-match:

.. CG-EXPLANATION-START id=method:BuildGroundModelSnapshot.__init__

**What this does.** Stores the active session and names the logger.

**Why it is here.** The caller owns the session; this use case only reads.

.. CG-EXPLANATION-END id=method:BuildGroundModelSnapshot.__init__

Method ``BuildGroundModelSnapshot``. ``async def execute``
----------------------------------------------------------

.. CG-BLOCK id=method:BuildGroundModelSnapshot.execute lines=67-242

.. literalinclude:: ../../../src/groundmodel/application/build_ground_model_snapshot.py
   :language: python
   :lines: 67-242
   :lineno-match:

.. CG-EXPLANATION-START id=method:BuildGroundModelSnapshot.execute

**What this does.** Builds the snapshot. It loads and scope-checks the project and model, loads the formations and contacts, loads every CPT and borehole, resolves the horizontal coordinate system (preferring the project default, falling back to the first investigation that carries one), groups the contacts by their anchor, and emits one layer row per (column, contact) pair plus one display row per formation actually used. Columns with no surface elevation are dropped with a warning, and the result is returned sorted.

**Why it is here.** The scope check (model must belong to the project) is the by-id project guard the API contract requires. Columns without a Z are dropped rather than half-placed because Plaxis 3-D needs an elevation to place a borehole; the count is reported so the drop is not silent. The coordinate-system fallback is defensive against legacy databases even though the .gmproj v3 contract now requires the project to carry one.

.. CG-EXPLANATION-END id=method:BuildGroundModelSnapshot.execute

Method ``BuildGroundModelSnapshot``. ``def _column_layers``
-----------------------------------------------------------

.. CG-BLOCK id=method:BuildGroundModelSnapshot._column_layers lines=243-293

.. literalinclude:: ../../../src/groundmodel/application/build_ground_model_snapshot.py
   :language: python
   :lines: 243-293
   :lineno-match:

.. CG-EXPLANATION-START id=method:BuildGroundModelSnapshot._column_layers

**What this does.** Builds the layer list for one investigation column. It sorts the contacts top-down and derives each layer's base depth from the next-deeper contact, using the recorded total depth for the deepest layer or the fallback thickness when it is unknown, and drops any degenerate zero-thickness layer.

**Why it is here.** Deriving each base from the next contact is how a stack of tops becomes a stack of layers. Equal-depth rows are dropped because the snapshot's layer contract skips them, guarding against two contacts sharing a depth that the dedupe pass should have cleaned — the code does not trust that upstream.

.. CG-EXPLANATION-END id=method:BuildGroundModelSnapshot._column_layers

