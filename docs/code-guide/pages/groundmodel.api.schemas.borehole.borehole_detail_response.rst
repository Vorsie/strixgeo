groundmodel.api.schemas.borehole.borehole_detail_response
=========================================================

.. CG-PAGE source=src/groundmodel/api/schemas/borehole/borehole_detail_response.py complete=true

*Source file:* ``src/groundmodel/api/schemas/borehole/borehole_detail_response.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-15

.. literalinclude:: ../../../src/groundmodel/api/schemas/borehole/borehole_detail_response.py
   :language: python
   :lines: 1-15
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A docstring naming the full detail tree, then imports of ``date``, ``UUID``, ``BaseModel``, ``ConfigDict``, and the four child response schemas (drill segments, field-log intervals, observations, samples).

**Why it is here.** The response-schema pattern; it composes the child schemas so one fetch returns the whole borehole tree.

.. CG-EXPLANATION-END id=module-header

Class ``BoreholeDetailResponse``
--------------------------------

.. CG-BLOCK id=class:BoreholeDetailResponse lines=16-58

.. literalinclude:: ../../../src/groundmodel/api/schemas/borehole/borehole_detail_response.py
   :language: python
   :lines: 16-58
   :lineno-match:

.. CG-EXPLANATION-START id=class:BoreholeDetailResponse

**What this does.** The complete borehole detail returned by the single-borehole fetch: header metadata (id, name, ids, location, elevation and its source, dates, method, type, depths, water table, denormalised counts) plus the lists of drill segments, field-log intervals, observations, and samples. Reads off the row via ``from_attributes``.

**Why it is here.** It is the full tree the desktop loads only when the engineer opens a detail view. The docstring records two things: the elevation source is surfaced so the editor can badge where the height came from (debt #8), and each observation's type is the raw token string the frontend maps to a label (translation at the presentation boundary).

.. CG-EXPLANATION-END id=class:BoreholeDetailResponse

