groundmodel.api.schemas.borehole.import_borehole_dov_request
============================================================

.. CG-PAGE source=src/groundmodel/api/schemas/borehole/import_borehole_dov_request.py complete=true

*Source file:* ``src/groundmodel/api/schemas/borehole/import_borehole_dov_request.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-10

.. literalinclude:: ../../../src/groundmodel/api/schemas/borehole/import_borehole_dov_request.py
   :language: python
   :lines: 1-10
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A one-line docstring, imports of ``UUID``, ``Field`` and ``model_validator`` (a hook that checks the whole schema after its fields are parsed), the strict base, and the shared bounding-box validator.

**Why it is here.** This is a request schema, so it inherits the strict base; the shared validator is imported so this and the CPT import enforce the identical box rule.

.. CG-EXPLANATION-END id=module-header

Class ``ImportBoreholeDovRequest`` — header
-------------------------------------------

.. CG-BLOCK id=class:ImportBoreholeDovRequest lines=11-23

.. literalinclude:: ../../../src/groundmodel/api/schemas/borehole/import_borehole_dov_request.py
   :language: python
   :lines: 11-23
   :lineno-match:

.. CG-EXPLANATION-START id=class:ImportBoreholeDovRequest

**What this does.** A bounding box (west, south, east, north in decimal degrees, each range-guarded) plus an optional project id.

**Why it is here.** It mirrors the CPT import request so the desktop can issue both with the same payload shape. Each edge is bounded to valid longitude/latitude so an out-of-range value is rejected as a ``422`` before any work starts.

.. CG-EXPLANATION-END id=class:ImportBoreholeDovRequest

Method ``ImportBoreholeDovRequest``. ``def _validate_bbox``
-----------------------------------------------------------

.. CG-BLOCK id=method:ImportBoreholeDovRequest._validate_bbox lines=24-35

.. literalinclude:: ../../../src/groundmodel/api/schemas/borehole/import_borehole_dov_request.py
   :language: python
   :lines: 24-35
   :lineno-match:

.. CG-EXPLANATION-START id=method:ImportBoreholeDovRequest._validate_bbox

**What this does.** An after-parse check that runs the shared bounding-box validator and returns the model unchanged when it passes.

**Why it is here.** It rejects a reversed, zero-size, or oversized box at parse time; the validator raises an error that Pydantic turns into the request's ``422``. Sharing one validator with the CPT schema means both endpoints enforce the same ordering and area guard (don't-repeat rule).

.. CG-EXPLANATION-END id=method:ImportBoreholeDovRequest._validate_bbox

