groundmodel.infrastructure.parsers.cpt.gef.gef_header
=====================================================

.. CG-PAGE source=src/groundmodel/infrastructure/parsers/cpt/gef/gef_header.py complete=true

*Source file:* ``src/groundmodel/infrastructure/parsers/cpt/gef/gef_header.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-5

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/cpt/gef/gef_header.py
   :language: python
   :lines: 1-5
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A one-line description and an import of the dataclass helpers used by the block below.

**Why it is here.** The header of a GEF file is pure data — names, numbers, coordinates, and a few lookup tables — with no behaviour, so a dataclass (a plain data-holder) is exactly the right shape for it.

.. CG-EXPLANATION-END id=module-header

Class ``GEFHeader``
-------------------

.. CG-BLOCK id=class:GEFHeader lines=6-50

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/cpt/gef/gef_header.py
   :language: python
   :lines: 6-50
   :lineno-match:

.. CG-EXPLANATION-START id=class:GEFHeader

**What this does.** Holds everything the parser reads out of a GEF file's header: the project and test identifiers, the file date, the company, the position (``x``, ``y``, ``z``), the coordinate-system codes, the data-block separators, and small lookup tables that say which file column holds which measurement, in which unit, with which "this value means missing" marker. Every field has a sensible empty default, so a half-written header still produces a usable object.

**Why it is here.** The header carries two different-looking pairs of coordinate fields on purpose. ``xy_code`` and ``z_code`` are the raw codes exactly as the file wrote them; ``epsg`` and ``z_epsg`` are those codes translated into the standard EPSG numbering the rest of the program understands (EPSG is the worldwide registry of coordinate systems — Belgian Lambert 72 is EPSG 31370). The project rule is to store the raw upstream token and translate separately, so a wrong translation can always be checked back against what the file really said. The comment also flags that MEASUREMENTVAR 14 (groundwater depth) is unreliable in practice, which is why later code prefers real piezometer data over it.

.. CG-EXPLANATION-END id=class:GEFHeader

