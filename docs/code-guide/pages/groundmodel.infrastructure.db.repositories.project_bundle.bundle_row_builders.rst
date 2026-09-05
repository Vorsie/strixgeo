groundmodel.infrastructure.db.repositories.project_bundle.bundle_row_builders
=============================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_row_builders.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_row_builders.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-52

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_row_builders.py
   :language: python
   :lines: 1-52
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A module docstring plus the toolbox. It notes that these helpers construct ORM objects from bundle dicts and touch no database themselves.

**Why it is here.** Keeping the row builders as pure constructors — build the object, do not save it — lets the restore pipeline decide when and in what order to add and flush them.

.. CG-EXPLANATION-END id=module-header

Function ``def _uuid``
----------------------

.. CG-BLOCK id=function:_uuid lines=53-70

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_row_builders.py
   :language: python
   :lines: 53-70
   :lineno-match:

.. CG-EXPLANATION-START id=function:_uuid

**What this does.** Coerces a raw bundle value into a UUID, returning ``None`` when it is absent.

**Why it is here.** Bundle values arrive as strings; this is the one place that turns an id string back into a UUID and tolerates a missing one.

.. CG-EXPLANATION-END id=function:_uuid

Function ``def _make_location``
-------------------------------

.. CG-BLOCK id=function:_make_location lines=71-98

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_row_builders.py
   :language: python
   :lines: 71-98
   :lineno-match:

.. CG-EXPLANATION-START id=function:_make_location

**What this does.** Rebuilds the PostGIS point geometry from raw x, y and EPSG values.

**Why it is here.** The geometry blob is deliberately not carried in the bundle (it is in ``_SKIP_COLUMNS``); it is reconstructed here from the plain coordinate columns, which is why those always travel.

.. CG-EXPLANATION-END id=function:_make_location

Function ``def _series_row_count``
----------------------------------

.. CG-BLOCK id=function:_series_row_count lines=99-124

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_row_builders.py
   :language: python
   :lines: 99-124
   :lineno-match:

.. CG-EXPLANATION-START id=function:_series_row_count

**What this does.** Returns the length of a CPT bundle dict's depth array, or ``None``.

**Why it is here.** The cheap pre-check the restore uses to spot an over-cap series before building it.

.. CG-EXPLANATION-END id=function:_series_row_count

Function ``def _validate_tin_payload``
--------------------------------------

.. CG-BLOCK id=function:_validate_tin_payload lines=125-200

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_row_builders.py
   :language: python
   :lines: 125-200
   :lineno-match:

.. CG-EXPLANATION-START id=function:_validate_tin_payload

**What this does.** Returns whether a restored TIN blob is structurally sound — the vertices and triangles are lists of the right shape.

**Why it is here.** A cached surface's geometry comes straight from the file, so a malformed or hostile blob must be caught before it reaches the database; a bad one is blanked and the surface is forced to rebuild.

.. CG-EXPLANATION-END id=function:_validate_tin_payload

Function ``def _cap``
---------------------

.. CG-BLOCK id=function:_cap lines=201-242

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_row_builders.py
   :language: python
   :lines: 201-242
   :lineno-match:

.. CG-EXPLANATION-START id=function:_cap

**What this does.** Truncates an oversized child array down to a cap, logging what was dropped and adding the count to the drops tally.

**Why it is here.** It is the enforcement point for the per-borehole array caps — a crafted bundle with a hundred-thousand-observation borehole is trimmed with a warning rather than allowed to allocate a runaway number of objects, and the dropped count is surfaced to the user (debt #112 / L6).

.. CG-EXPLANATION-END id=function:_cap

Function ``def _build_cpt``
---------------------------

.. CG-BLOCK id=function:_build_cpt lines=243-270

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_row_builders.py
   :language: python
   :lines: 243-270
   :lineno-match:

.. CG-EXPLANATION-START id=function:_build_cpt

**What this does.** Constructs a CPT ORM object (with its optional series) from a bundle dict.

**Why it is here.** The per-table row builder for CPTs, rebuilding the geometry from the coordinate columns as it goes.

.. CG-EXPLANATION-END id=function:_build_cpt

Function ``def _build_borehole``
--------------------------------

.. CG-BLOCK id=function:_build_borehole lines=271-369

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_row_builders.py
   :language: python
   :lines: 271-369
   :lineno-match:

.. CG-EXPLANATION-START id=function:_build_borehole

**What this does.** Constructs a borehole ORM object with its whole child tree from a bundle dict, applying the per-array size caps.

**Why it is here.** The per-table row builder for boreholes; the caps keep a single crafted borehole from allocating an implausible child tree before the first write.

.. CG-EXPLANATION-END id=function:_build_borehole

Function ``def _build_observation``
-----------------------------------

.. CG-BLOCK id=function:_build_observation lines=370-411

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_row_builders.py
   :language: python
   :lines: 370-411
   :lineno-match:

.. CG-EXPLANATION-START id=function:_build_observation

**What this does.** Constructs an observation ORM object with its layer children.

**Why it is here.** A nested piece of the borehole builder.

.. CG-EXPLANATION-END id=function:_build_observation

Function ``def _build_layer``
-----------------------------

.. CG-BLOCK id=function:_build_layer lines=412-451

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_row_builders.py
   :language: python
   :lines: 412-451
   :lineno-match:

.. CG-EXPLANATION-START id=function:_build_layer

**What this does.** Constructs an observation-layer ORM object with its admixture children.

**Why it is here.** The next level down of the borehole builder.

.. CG-EXPLANATION-END id=function:_build_layer

Function ``def _build_sample``
------------------------------

.. CG-BLOCK id=function:_build_sample lines=452-510

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_row_builders.py
   :language: python
   :lines: 452-510
   :lineno-match:

.. CG-EXPLANATION-START id=function:_build_sample

**What this does.** Constructs a sample ORM object with all six lab-test family children.

**Why it is here.** The sample branch of the borehole builder, again driven off the shared lab-family registry.

.. CG-EXPLANATION-END id=function:_build_sample

