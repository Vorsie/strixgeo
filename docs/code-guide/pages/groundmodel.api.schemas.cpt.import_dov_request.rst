groundmodel.api.schemas.cpt.import_dov_request
==============================================

.. CG-PAGE source=src/groundmodel/api/schemas/cpt/import_dov_request.py complete=true

*Source file:* ``src/groundmodel/api/schemas/cpt/import_dov_request.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-10

.. literalinclude:: ../../../src/groundmodel/api/schemas/cpt/import_dov_request.py
   :language: python
   :lines: 1-10
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A one-line docstring, imports of ``UUID``, ``Field`` and ``model_validator``, the strict base, and the shared bounding-box validator.

**Why it is here.** A request schema, so it inherits the strict base; the shared validator is imported so this and the borehole import enforce the identical box rule.

.. CG-EXPLANATION-END id=module-header

Class ``ImportDovRequest`` — header
-----------------------------------

.. CG-BLOCK id=class:ImportDovRequest lines=11-19

.. literalinclude:: ../../../src/groundmodel/api/schemas/cpt/import_dov_request.py
   :language: python
   :lines: 11-19
   :lineno-match:

.. CG-EXPLANATION-START id=class:ImportDovRequest

**What this does.** A bounding box (west, south, east, north, each range-guarded) plus an optional project id.

**Why it is here.** The same shape as the borehole import request, so the desktop issues both alike; each edge is bounded so an out-of-range value is a ``422`` before any work starts.

.. CG-EXPLANATION-END id=class:ImportDovRequest

Method ``ImportDovRequest``. ``def _validate_bbox``
---------------------------------------------------

.. CG-BLOCK id=method:ImportDovRequest._validate_bbox lines=20-31

.. literalinclude:: ../../../src/groundmodel/api/schemas/cpt/import_dov_request.py
   :language: python
   :lines: 20-31
   :lineno-match:

.. CG-EXPLANATION-START id=method:ImportDovRequest._validate_bbox

**What this does.** An after-parse check that runs the shared bounding-box validator and returns the model unchanged when it passes.

**Why it is here.** It rejects a reversed, zero-size, or oversized box at parse time; the raised error becomes the request's ``422``. It shares one validator with the borehole schema so both enforce the same ordering and area guard (don't-repeat rule).

.. CG-EXPLANATION-END id=method:ImportDovRequest._validate_bbox

