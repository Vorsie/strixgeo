groundmodel.domain.value_objects.elevation_source
=================================================

.. CG-PAGE source=src/groundmodel/domain/value_objects/elevation_source.py complete=true

*Source file:* ``src/groundmodel/domain/value_objects/elevation_source.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-5

.. literalinclude:: ../../../src/groundmodel/domain/value_objects/elevation_source.py
   :language: python
   :lines: 1-5
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The description line and one import of ``StrEnum``.

**Why it is here.** The elevation-provenance value is stored in a database column, so a string-valued enum fits.

.. CG-EXPLANATION-END id=module-header

Class ``ElevationSource``
-------------------------

.. CG-BLOCK id=class:ElevationSource lines=6-37

.. literalinclude:: ../../../src/groundmodel/domain/value_objects/elevation_source.py
   :language: python
   :lines: 6-37
   :lineno-match:

.. CG-EXPLANATION-START id=class:ElevationSource

**What this does.** Defines ``ElevationSource``, a StrEnum with four members — ``DOV``, ``GEF``, ``MANUAL``, ``NONE`` — recording where a CPT's or borehole's surface elevation came from.

**Why it is here.** It is stored next to ``elevation_m`` so that re-importing a file (the refresh-on-duplicate path) can overwrite an elevation that came from the file, but must NOT overwrite one the engineer typed in by hand. This is the owner ruling that a surveyed collar outranks the automatic value; ``MANUAL`` is the flag that protects it (debt #8). ``NONE`` (and a NULL column on an old row) both mean no elevation is recorded.

.. CG-EXPLANATION-END id=class:ElevationSource

