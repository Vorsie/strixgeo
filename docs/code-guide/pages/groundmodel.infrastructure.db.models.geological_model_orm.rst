groundmodel.infrastructure.db.models.geological_model_orm
=========================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/models/geological_model_orm.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/models/geological_model_orm.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-16

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/models/geological_model_orm.py
   :language: python
   :lines: 1-16
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The description line and the toolbox: the column types (``Boolean``, ``DateTime``, ``String``, ``Text``), ``ForeignKey`` / ``Index``, ``func``, the Postgres ``ARRAY`` / ``JSONB`` and ``UUID`` types, ``Mapped`` / ``mapped_column`` / ``relationship``, ``Base`` and the loader-strategy constant.

**Why it is here.** The building blocks for the interpretation-container table.

.. CG-EXPLANATION-END id=module-header

Class ``GeologicalModelOrm``
----------------------------

.. CG-BLOCK id=class:GeologicalModelOrm lines=17-143

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/models/geological_model_orm.py
   :language: python
   :lines: 17-143
   :lineno-match:

.. CG-EXPLANATION-START id=class:GeologicalModelOrm

**What this does.** Defines the ``geological_model`` table — one interpretation of a project's geology. It carries a name and description, an ``is_active`` flag, an ``excluded_borehole_ids`` array, a ``kind`` discriminator (geological / lithostratigraphic / geotechnical), a self-referential ``parent_model_id``, two geotech qc-statistic columns, a per-column litho-provenance JSONB map, timestamps, and ``relationship`` links to its contacts, litho layers, and cached surfaces.

**Why it is here.** A project can hold several alternative interpretations; one is flagged active for the default view. Formations are shared at the project level, so a model owns only the *assignment* of tops. The ``kind`` and ``parent_model_id`` encode the three-level hierarchy: a lithostratigraphic model refines a geological one, a geotechnical model refines a lithostratigraphic one, with ``ON DELETE RESTRICT`` so a parent cannot be deleted while a child references it. ``excluded_borehole_ids`` is *inverted scope* — empty means every borehole contributes — which suits mid-project imports that arrive after the model exists. The two statistic columns let staleness be *derived* (classified-with versus chosen), never stored, so changing the choice never silently re-derives the bands.

.. CG-EXPLANATION-END id=class:GeologicalModelOrm

