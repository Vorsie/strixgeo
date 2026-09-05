groundmodel.infrastructure.db.models.litho_build_generation_orm
===============================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/models/litho_build_generation_orm.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/models/litho_build_generation_orm.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-54

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/models/litho_build_generation_orm.py
   :language: python
   :lines: 1-54
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A long module docstring plus the toolbox (``Float``, ``Integer``, ``DateTime``, ``String``, ``LargeBinary``, ``ForeignKey``, ``func``, the Postgres ``JSONB`` / ``UUID`` types, ``Mapped`` / ``mapped_column``, ``Base``). The docstring explains that this table is a 3-D build's audit trail.

**Why it is here.** The docstring records why the table exists: before it, a built mesh said *what* was built but nothing recorded *how* or *from what* — the inputs lived only in the browser and the settings only in transient view-state, so a build could not be reproduced, and a real incident had meshes carrying the wrong build's timestamp.

.. CG-EXPLANATION-END id=module-header

Class ``LithoBuildGenerationOrm``
---------------------------------

.. CG-BLOCK id=class:LithoBuildGenerationOrm lines=55-135

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/models/litho_build_generation_orm.py
   :language: python
   :lines: 55-135
   :lineno-match:

.. CG-EXPLANATION-START id=class:LithoBuildGenerationOrm

**What this does.** Defines the ``litho_build_generation`` table: one row per 3-D litho build. It stores the exact POSTed ``payload`` (the validated 2-D partitions) plus its checksum, the grid geometry and every setting that changes the output, a ``body_aliases`` map (which source body each mesh component merged), summary counts and a duration, and an optional gapless report.

**Why it is here.** This is the build's reproducibility record: a rebuild from a stored generation must produce the same meshes. The ``body_aliases`` map is *identity provenance* — which user-authored bodies make up a merged mesh — but the docstring is emphatic that it is geometry-derived build data and must never be read back as if it were the engineer's correlations. Each cached solid points here through its ``generation_id``, so every mesh names the build that made it.

.. CG-EXPLANATION-END id=class:LithoBuildGenerationOrm

