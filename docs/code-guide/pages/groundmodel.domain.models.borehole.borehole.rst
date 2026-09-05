groundmodel.domain.models.borehole.borehole
===========================================

.. CG-PAGE source=src/groundmodel/domain/models/borehole/borehole.py complete=true

*Source file:* ``src/groundmodel/domain/models/borehole/borehole.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-9

.. literalinclude:: ../../../src/groundmodel/domain/models/borehole/borehole.py
   :language: python
   :lines: 1-9
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The file's one-line description and its toolbox. ``dataclass`` and ``field`` come from Python's ``dataclasses`` module — a *dataclass* is a class whose only job is to hold a few named values together, with the repetitive boilerplate written for you. ``date`` is the calendar-date type. ``UUID`` is the type of a unique identifier, and ``uuid7`` is a function that makes a fresh one.

**Why it is here.** A *UUID* (universally unique identifier) is a long random-looking code used as a name that will essentially never collide with another, so two machines can each mint ids for their own rows and never clash. ``uuid7`` is chosen over the more familiar ``uuid4`` because a uuid7 sorts in the order it was created, which keeps database indexes tidy.

.. CG-EXPLANATION-END id=module-header

Class ``Borehole``
------------------

.. CG-BLOCK id=class:Borehole lines=10-84

.. literalinclude:: ../../../src/groundmodel/domain/models/borehole/borehole.py
   :language: python
   :lines: 10-84
   :lineno-match:

.. CG-EXPLANATION-START id=class:Borehole

**What this does.** Defines the ``Borehole`` shape: a physical hole in the ground. It carries the hole's name, its position (``location_x`` / ``location_y`` plus the ``epsg`` code that says which coordinate system those numbers are in), its ground-surface elevation and vertical datum, total drilled depth, dates, and the source-vocabulary description fields DOV supplies (drilling method, type, purpose, municipality, executor, water-table depth). The ``id`` field is filled in automatically by ``uuid7`` when a borehole is created.

**Why it is here.** The docstring states the CLAUDE.md domain rule plainly: a borehole is *not a test*. A hole is drilled, and the tests, samples and observations it carries are separate things linked to it by a *foreign key* — a field on a child row that stores the parent's ``id``, the way a paper form cites a file number. Almost every field is written ``| None`` with a default, which marks it *optional* (the value is 'either this type, or nothing'), because real source data is often incomplete. The ``epsg`` code — an *EPSG* number names a coordinate system, e.g. 31370 for Belgian Lambert 72, 4326 for WGS84 — is stored right next to the coordinates because a bare x/y with no system attached cannot be placed on the map alongside data from another provider.

.. CG-EXPLANATION-END id=class:Borehole

