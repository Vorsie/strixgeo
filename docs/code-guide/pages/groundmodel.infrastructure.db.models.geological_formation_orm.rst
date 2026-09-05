groundmodel.infrastructure.db.models.geological_formation_orm
=============================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/models/geological_formation_orm.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/models/geological_formation_orm.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-16

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/models/geological_formation_orm.py
   :language: python
   :lines: 1-16
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The description line and the toolbox: the column types (``Boolean``, ``DateTime``, ``Integer``, ``String``, ``Text``), ``ForeignKey`` / ``Index``, ``func``, the Postgres ``JSONB`` and ``UUID`` types, ``Mapped`` / ``mapped_column`` / ``relationship``, ``Base`` and the loader-strategy constant.

**Why it is here.** The building blocks for the shared formation-vocabulary table, which serves all three model levels.

.. CG-EXPLANATION-END id=module-header

Class ``GeologicalFormationOrm``
--------------------------------

.. CG-BLOCK id=class:GeologicalFormationOrm lines=17-197

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/models/geological_formation_orm.py
   :language: python
   :lines: 17-197
   :lineno-match:

.. CG-EXPLANATION-START id=class:GeologicalFormationOrm

**What this does.** Defines the ``geological_formation`` table — a project's substrate vocabulary entry (Boom Klei, Diest Zand, ...). One wide table serves all three model levels, so besides the name / code / colour and display order it also carries the litho-unit fields (lithology token, admixtures, NAD class, the admixture-family choice), several self-referential parent links, and a couple of instance-ordinal columns. It has ``relationship`` links to its contacts and its litho layers.

**Why it is here.** Each project owns its own formation list — the same name in two projects is two rows — so a ``.gmproj`` bundle stays self-contained. The self-referential foreign keys are the three-level hierarchy: a litho or geotech unit points at its parent geological formation, all with ``ON DELETE SET NULL`` so deleting a parent demotes the child to parentless rather than destroying it. The ``color_override`` column exists because ``color`` is a machine-stamped default, so its value proves nothing about intent — nullability of the override column *is* the provenance of a deliberate engineer colour pick (owner ruling 2026-08-26). The ``nad_admixture_choice`` records the engineer's pure-vs-with-admixture answer for the Belgian NAD classification (owner ruling 2026-09-04).

.. CG-EXPLANATION-END id=class:GeologicalFormationOrm

