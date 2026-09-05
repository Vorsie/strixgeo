groundmodel.application.litho_generation_payload
================================================

.. CG-PAGE source=src/groundmodel/application/litho_generation_payload.py complete=true

*Source file:* ``src/groundmodel/application/litho_generation_payload.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-40

.. literalinclude:: ../../../src/groundmodel/application/litho_generation_payload.py
   :language: python
   :lines: 1-40
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the generation-payload reader. It imports the three domain input types (section, column, region) and its docstring explains it is the inverse of the build's payload writer.

**Why it is here.** The stored payload is the 3-D build's own input, kept verbatim so a reproduce or replay runs exactly what ran. Symmetry with the writer is load-bearing: the writer takes its field names from the value objects rather than hand-listing them, because hand-listed names silently dropped the 2-D classification at three points once (debt #256), and this reader holds the same line by splatting the stored mapping into the constructors. A payload that does not match the current types raises rather than being silently rebuilt with defaults the build never used.

.. CG-EXPLANATION-END id=module-header

Function ``def sections_from_generation_payload``
-------------------------------------------------

.. CG-BLOCK id=function:sections_from_generation_payload lines=41-76

.. literalinclude:: ../../../src/groundmodel/application/litho_generation_payload.py
   :language: python
   :lines: 41-76
   :lineno-match:

.. CG-EXPLANATION-START id=function:sections_from_generation_payload

**What this does.** Rehydrates a stored payload into a list of domain section partitions, checking it is a mapping with a sections list and raising a clear error otherwise.

**Why it is here.** The payload is typed loosely because a row written by an older or foreign builder is untrusted input that must fail loudly, not be coerced; a bare string is excluded from the sequence check so text does not parse as many sections.

.. CG-EXPLANATION-END id=function:sections_from_generation_payload

Function ``def _section``
-------------------------

.. CG-BLOCK id=function:_section lines=77-91

.. literalinclude:: ../../../src/groundmodel/application/litho_generation_payload.py
   :language: python
   :lines: 77-91
   :lineno-match:

.. CG-EXPLANATION-START id=function:_section

**What this does.** Rehydrates one section, its columns and its regions, splatting the remaining fields into the section constructor.

**Why it is here.** Splatting rather than naming fields is the symmetry rule again: a field added to the value object survives a write-then-read round trip with no edit here.

.. CG-EXPLANATION-END id=function:_section

Function ``def _column``
------------------------

.. CG-BLOCK id=function:_column lines=92-98

.. literalinclude:: ../../../src/groundmodel/application/litho_generation_payload.py
   :language: python
   :lines: 92-98
   :lineno-match:

.. CG-EXPLANATION-START id=function:_column

**What this does.** Rehydrates one section column by splatting the stored mapping into its constructor.

**Why it is here.** Same splat-not-list rule; a non-mapping raises a clear typed error.

.. CG-EXPLANATION-END id=function:_column

Function ``def _region``
------------------------

.. CG-BLOCK id=function:_region lines=99-113

.. literalinclude:: ../../../src/groundmodel/application/litho_generation_payload.py
   :language: python
   :lines: 99-113
   :lineno-match:

.. CG-EXPLANATION-START id=function:_region

**What this does.** Rehydrates one region, restoring its tuple-of-tuples polygon and its layer-id tuple.

**Why it is here.** Same splat rule for the plain fields; the polygon and layer ids need explicit handling because JSON has no tuples.

.. CG-EXPLANATION-END id=function:_region

Function ``def _point``
-----------------------

.. CG-BLOCK id=function:_point lines=114-121

.. literalinclude:: ../../../src/groundmodel/application/litho_generation_payload.py
   :language: python
   :lines: 114-121
   :lineno-match:

.. CG-EXPLANATION-START id=function:_point

**What this does.** Restores one polygon point from a stored two-value list into a fraction-and-elevation pair.

**Why it is here.** JSON stores a point as a two-element list; this is the one place the nested-tuple shape the domain declares is rebuilt, and a wrong length raises.

.. CG-EXPLANATION-END id=function:_point

Function ``def _as_list``
-------------------------

.. CG-BLOCK id=function:_as_list lines=122-126

.. literalinclude:: ../../../src/groundmodel/application/litho_generation_payload.py
   :language: python
   :lines: 122-126
   :lineno-match:

.. CG-EXPLANATION-START id=function:_as_list

**What this does.** Asserts a stored field is a list, naming the field when it is not.

**Why it is here.** A small guard so a malformed payload fails with a message that names the bad field rather than an opaque error deep in a constructor.

.. CG-EXPLANATION-END id=function:_as_list

