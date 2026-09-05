groundmodel.infrastructure.db.models.geotech_tie_tombstone_orm
==============================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/models/geotech_tie_tombstone_orm.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/models/geotech_tie_tombstone_orm.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-14

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/models/geotech_tie_tombstone_orm.py
   :language: python
   :lines: 1-14
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The description line and a small toolbox: ``DateTime``, ``Float``, ``ForeignKey`` and ``func``, plus the Postgres ``UUID`` type, ``Mapped`` / ``mapped_column`` and ``Base``.

**Why it is here.** The pieces for a small table that remembers a deleted correlation by its place.

.. CG-EXPLANATION-END id=module-header

Class ``GeotechTieTombstoneOrm``
--------------------------------

.. CG-BLOCK id=class:GeotechTieTombstoneOrm lines=15-78

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/models/geotech_tie_tombstone_orm.py
   :language: python
   :lines: 15-78
   :lineno-match:

.. CG-EXPLANATION-START id=class:GeotechTieTombstoneOrm

**What this does.** Defines the ``geotech_tie_tombstone`` table: one packing correlation the engineer deleted, remembered by *where* it was — a ``model_id`` and ``section_id`` (both cascade-delete) plus the two endpoints as x/y/z coordinates. It deliberately has no unique constraint.

**Why it is here.** This solves a loop the owner hit twice (rulings 2026-08-17): the geotech packing bands are rebuilt with fresh ids every time, so a tombstone that named the rows a deleted tie joined would stop matching and the tie would return. Recording the *place* survives the rebuild — x/y are the investigation's map position (a test does not move) and z is the contact elevation (so it survives a collar correction). Only the engineer's deletions leave a tombstone; the machine's own housekeeping deletes leave none. There is no unique constraint on purpose: two tombstones for the same place are harmless because matching is a scan with tolerance, not an exact lookup.

.. CG-EXPLANATION-END id=class:GeotechTieTombstoneOrm

