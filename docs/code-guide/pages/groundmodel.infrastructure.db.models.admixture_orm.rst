groundmodel.infrastructure.db.models.admixture_orm
==================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/models/admixture_orm.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/models/admixture_orm.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-14

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/models/admixture_orm.py
   :language: python
   :lines: 1-14
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The description line and the SQLAlchemy toolbox: the column types (``Boolean``, ``String``), ``ForeignKey`` and ``Index``, the Postgres ``UUID`` type, the ``Mapped`` / ``mapped_column`` helpers that declare a column, ``relationship`` for the link to the parent, the shared ``Base``, and the shared loader-strategy constant.

**Why it is here.** These are the standard building blocks every ORM model here uses. A *column* is one field of a table; ``mapped_column`` declares one and ``Mapped[...]`` states its Python type. ``Base`` is the shared parent every model inherits from — SQLAlchemy collects all its subclasses into one set of tables. ``relationship`` is how one model reaches its related rows (here, the layer this admixture belongs to) as ordinary Python attributes.

.. CG-EXPLANATION-END id=module-header

Class ``AdmixtureOrm``
----------------------

.. CG-BLOCK id=class:AdmixtureOrm lines=15-58

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/models/admixture_orm.py
   :language: python
   :lines: 15-58
   :lineno-match:

.. CG-EXPLANATION-START id=class:AdmixtureOrm

**What this does.** Defines the ``admixture`` table (``__tablename__`` sets the table's real name). Each row has a ``id`` *primary key* (the unique row name), an ``observation_layer_id`` *foreign key* pointing at its parent layer, the ``soil_code``, ``amount`` and ``locally`` fields, and a ``relationship`` back to that layer. Two ``Index`` entries speed up lookups by parent and by soil code.

**Why it is here.** A *foreign key* records the parent row's id and asks the database to keep it honest; ``ondelete="CASCADE"`` means deleting a layer automatically deletes its admixtures, so no orphan is left behind. The domain ``Admixture`` is an identity-less value object, but a database row needs a primary key, so each gets a synthetic ``id`` — the docstring warns that identity is still structural (soil code + amount + locally), not the id. The ``soil_code`` index exists so a query like 'find every layer containing glauconite' uses the index instead of scanning the whole table.

.. CG-EXPLANATION-END id=class:AdmixtureOrm

