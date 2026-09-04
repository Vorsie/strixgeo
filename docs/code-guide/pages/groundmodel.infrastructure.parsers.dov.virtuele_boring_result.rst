groundmodel.infrastructure.parsers.dov.virtuele_boring_result
=============================================================

.. CG-PAGE source=src/groundmodel/infrastructure/parsers/dov/virtuele_boring_result.py complete=true

*Source file:* ``src/groundmodel/infrastructure/parsers/dov/virtuele_boring_result.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-19

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/dov/virtuele_boring_result.py
   :language: python
   :lines: 1-19
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A docstring, then the import of the dataclass helper used by the two data-holders below.

**Why it is here.** The service returns two parallel lists — the layers present at a point, and the catalogue describing each unit — and this file's types hold the merged, self-describing result. Storing the name, description, and colour on every layer row is a small redundancy that keeps the shape easy to consume: a row describes itself, and a renderer can iterate it without carrying the catalogue.

.. CG-EXPLANATION-END id=module-header

Class ``VirtueleBoringLayer``
-----------------------------

.. CG-BLOCK id=class:VirtueleBoringLayer lines=20-66

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/dov/virtuele_boring_result.py
   :language: python
   :lines: 20-66
   :lineno-match:

.. CG-EXPLANATION-START id=class:VirtueleBoringLayer

**What this does.** An unchangeable data-holder for one modelled layer at one point: its code and Dutch name, a short description, its top, base, and thickness in metres against the Belgian vertical datum, an optional colour, and an optional reference link.

**Why it is here.** The elevations are absolute (positive above sea level, negative below), and the thickness is computed by DOV and passed through unchanged. The comment warns that this code is the service's own internal numbering, not the four-digit catalogue code used elsewhere in the platform, so the two must be bridged through the name if ever cross-referenced.

.. CG-EXPLANATION-END id=class:VirtueleBoringLayer

Class ``VirtueleBoringResult``
------------------------------

.. CG-BLOCK id=class:VirtueleBoringResult lines=67-90

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/dov/virtuele_boring_result.py
   :language: python
   :lines: 67-90
   :lineno-match:

.. CG-EXPLANATION-START id=class:VirtueleBoringResult

**What this does.** An unchangeable data-holder for a whole point-pick: the model code and the point, both echoed back, plus the ordered list of layers found there.

**Why it is here.** Echoing the model and point back lets a consumer confirm what was asked without re-threading the call site. The layers are ordered top to bottom, and layers absent at the point are simply left out — this is a real stack at a point, not a fixed-size catalogue.

.. CG-EXPLANATION-END id=class:VirtueleBoringResult

