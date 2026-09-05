groundmodel.domain.value_objects.formation_surface_input
========================================================

.. CG-PAGE source=src/groundmodel/domain/value_objects/formation_surface_input.py complete=true

*Source file:* ``src/groundmodel/domain/value_objects/formation_surface_input.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-11

.. literalinclude:: ../../../src/groundmodel/domain/value_objects/formation_surface_input.py
   :language: python
   :lines: 1-11
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The description line, ``from __future__ import annotations``, imports of ``Mapping`` (a read-only dictionary type), ``dataclass`` / ``field`` and ``UUID``, and the ``TinSurface`` shape.

**Why it is here.** It imports ``TinSurface`` because it carries a formation's cached surface, and ``Mapping`` to type the optional vertex-to-contact lookup.

.. CG-EXPLANATION-END id=module-header

Class ``FormationSurfaceInput``
-------------------------------

.. CG-BLOCK id=class:FormationSurfaceInput lines=12-37

.. literalinclude:: ../../../src/groundmodel/domain/value_objects/formation_surface_input.py
   :language: python
   :lines: 12-37
   :lineno-match:

.. CG-EXPLANATION-START id=class:FormationSurfaceInput

**What this does.** Defines ``FormationSurfaceInput``, a frozen value object bundling what the surface-crossing check needs for one formation: its ``formation_id``, display ``name``, its ``display_order`` (stratigraphic rank, lower = older), the cached ``surface`` (its TIN), and an optional ``contact_lookup`` mapping each surface vertex back to the contact that produced it.

**Why it is here.** The crossing check tests whether two formations' surfaces intersect the wrong way round (a younger formation dipping below an older one), so it needs each surface plus its stratigraphic order. The validator never rebuilds the surface — it consumes whatever the cache holds. The ``contact_lookup`` lets a detected crossing name *which picks* are wrong rather than just 'these two formations intersect'; when it is empty the crossing is still found but the banner simply cannot be clicked through to a contact.

.. CG-EXPLANATION-END id=class:FormationSurfaceInput

