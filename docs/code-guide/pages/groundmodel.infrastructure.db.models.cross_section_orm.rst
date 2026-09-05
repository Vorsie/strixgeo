groundmodel.infrastructure.db.models.cross_section_orm
======================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/models/cross_section_orm.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/models/cross_section_orm.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-21

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/models/cross_section_orm.py
   :language: python
   :lines: 1-21
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The description line and the toolbox: the column types (``Boolean``, ``DateTime``, ``Double``, ``Integer``, ``String``, ``Text``), ``ForeignKey`` / ``Index``, ``func``, the Postgres ``ARRAY`` / ``JSONB`` and ``UUID`` types, ``Mapped`` / ``mapped_column``, and ``Base``. A small string constant names the ``body`` table to avoid a circular import.

**Why it is here.** ``JSONB`` is a Postgres column that stores a whole JSON object in one field — used here for a schema-less bag of display toggles. Naming the ``body`` table as a plain string sidesteps the fact that the body table also points back at the section, which would otherwise be a chicken-and-egg import.

.. CG-EXPLANATION-END id=module-header

Class ``CrossSectionOrm``
-------------------------

.. CG-BLOCK id=class:CrossSectionOrm lines=22-141

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/models/cross_section_orm.py
   :language: python
   :lines: 22-141
   :lineno-match:

.. CG-EXPLANATION-START id=class:CrossSectionOrm

**What this does.** Defines the ``cross_section`` table: a 2-D slice the user draws through a project. It stores the line endpoints (plain numbers plus an EPSG code), the projection buffer, vertical exaggeration, arrays of explicitly-excluded and explicitly-seeded investigation ids, optional view-window depths, a display order, a JSONB view-state bag, an optional companion-body link, and timestamps.

**Why it is here.** A section is the editing surface for all three model levels (CLAUDE.md Commercial Direction), and it is *project-scoped*, not model-scoped, so one section can render any of the project's models. The ``seeded_formation_contact_ids`` array is the *explicit-content invariant* made concrete (owner directive): a section shows only the contacts whose id is in this set, so a model-level contact in the corridor stays invisible until the engineer seeds or draws it. The endpoints stay plain numbers rather than a PostGIS line because v1 needs no spatial query on sections and it keeps the point-shape vocabulary consistent across tables.

.. CG-EXPLANATION-END id=class:CrossSectionOrm

