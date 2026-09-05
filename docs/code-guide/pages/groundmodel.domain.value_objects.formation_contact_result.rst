groundmodel.domain.value_objects.formation_contact_result
=========================================================

.. CG-PAGE source=src/groundmodel/domain/value_objects/formation_contact_result.py complete=true

*Source file:* ``src/groundmodel/domain/value_objects/formation_contact_result.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-19

.. literalinclude:: ../../../src/groundmodel/domain/value_objects/formation_contact_result.py
   :language: python
   :lines: 1-19
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A short module docstring plus imports of ``dataclass``, ``datetime`` and ``UUID``. The docstring explains that this is a plain-data snapshot of a formation-contact row, returned by application use cases in place of the raw database object.

**Why it is here.** The docstring records the layering reason: a use case must not hand a live database (ORM) row up to the API, because that row is tied to an open database session and belongs to the infrastructure layer. This value object is the clean, session-free copy that is allowed to cross the boundary. Its fields are chosen to mirror exactly what the API's response schema reads.

.. CG-EXPLANATION-END id=module-header

Class ``FormationContactResult`` — header
-----------------------------------------

.. CG-BLOCK id=class:FormationContactResult lines=20-88

.. literalinclude:: ../../../src/groundmodel/domain/value_objects/formation_contact_result.py
   :language: python
   :lines: 20-88
   :lineno-match:

.. CG-EXPLANATION-START id=class:FormationContactResult

**What this does.** Defines ``FormationContactResult``, a frozen, ``slots``-based value object holding one formation contact's scalar fields: its ``id`` (primary key), the model and formation it belongs to, the borehole or CPT it is anchored to (or the synthetic x/y/elevation for an anchorless pinch-out contact), the ``depth_top_m``, provenance and confidence tags, some optional backlinks, a free-text note, and the created/updated timestamps.

**Why it is here.** A *primary key* is the id that uniquely names a row in its table. Depth here is *positive-downward*, the whole program's convention (the surface is zero, deeper is a larger number). ``slots=True`` tells Python to store the fields in a fixed compact layout instead of a per-object dictionary — a small memory and speed win for a shape created in bulk. The docstring notes the split the anchors encode: a real contact sets exactly one of ``borehole_id`` / ``cpt_id``, while a *synthetic* pinch-out contact (a boundary the engineer places where a formation thins to nothing, with no borehole behind it) sets neither and carries its own projected position instead.

.. CG-EXPLANATION-END id=class:FormationContactResult

Method ``FormationContactResult``. ``def from_orm``
---------------------------------------------------

.. CG-BLOCK id=method:FormationContactResult.from_orm lines=89-128

.. literalinclude:: ../../../src/groundmodel/domain/value_objects/formation_contact_result.py
   :language: python
   :lines: 89-128
   :lineno-match:

.. CG-EXPLANATION-START id=method:FormationContactResult.from_orm

**What this does.** A *classmethod* — a builder called on the class itself, ``FormationContactResult.from_orm(row)`` — that copies every field off a database row into a new snapshot, reading each field with ``getattr(..., None)`` so a missing attribute becomes ``None`` rather than an error.

**Why it is here.** It is the one place that converts a live database row into the clean snapshot, so the conversion is written once and reused by every use case. The lenient ``getattr`` is a test convenience: a unit test can pass a tiny stub object that sets only the few fields the test cares about, and the builder still works. Production always passes a fully-loaded row, so the defaults never actually fire there.

.. CG-EXPLANATION-END id=method:FormationContactResult.from_orm

