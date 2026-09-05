groundmodel.domain.value_objects.contact_depth
==============================================

.. CG-PAGE source=src/groundmodel/domain/value_objects/contact_depth.py complete=true

*Source file:* ``src/groundmodel/domain/value_objects/contact_depth.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-8

.. literalinclude:: ../../../src/groundmodel/domain/value_objects/contact_depth.py
   :language: python
   :lines: 1-8
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The description line, ``from __future__ import annotations``, and imports of ``dataclass`` and ``UUID``.

**Why it is here.** ``from __future__ import annotations`` lets the file mention a type by name without the cost of loading it at run time — a small, standard modernisation used across the domain. ``UUID`` is imported because a contact carries an id.

.. CG-EXPLANATION-END id=module-header

Class ``ContactDepth``
----------------------

.. CG-BLOCK id=class:ContactDepth lines=9-20

.. literalinclude:: ../../../src/groundmodel/domain/value_objects/contact_depth.py
   :language: python
   :lines: 9-20
   :lineno-match:

.. CG-EXPLANATION-START id=class:ContactDepth

**What this does.** Defines ``ContactDepth``, a frozen value object carrying just two things: a contact's ``id`` and its ``depth_top_m`` (the depth of a formation top).

**Why it is here.** It is a *narrow projection* — a deliberately tiny copy of a formation contact holding only what the no-gaps validator needs: the depth to check, and the id so a problem can point back at the offending row. Keeping the shape this narrow means the validator has no opinion on how contacts are actually stored, which keeps the pure domain free of database concerns.

.. CG-EXPLANATION-END id=class:ContactDepth

