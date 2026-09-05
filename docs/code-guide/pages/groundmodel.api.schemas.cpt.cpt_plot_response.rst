groundmodel.api.schemas.cpt.cpt_plot_response
=============================================

.. CG-PAGE source=src/groundmodel/api/schemas/cpt/cpt_plot_response.py complete=true

*Source file:* ``src/groundmodel/api/schemas/cpt/cpt_plot_response.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-7

.. literalinclude:: ../../../src/groundmodel/api/schemas/cpt/cpt_plot_response.py
   :language: python
   :lines: 1-7
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A one-line docstring and imports of ``UUID`` and ``BaseModel``.

**Why it is here.** The response-schema pattern; the depth-series arrays for charting.

.. CG-EXPLANATION-END id=module-header

Class ``CptPlotResponse``
-------------------------

.. CG-BLOCK id=class:CptPlotResponse lines=8-58

.. literalinclude:: ../../../src/groundmodel/api/schemas/cpt/cpt_plot_response.py
   :language: python
   :lines: 8-58
   :lineno-match:

.. CG-EXPLANATION-START id=class:CptPlotResponse

**What this does.** The parallel depth-series arrays for one CPT: depths, cone resistance, sleeve friction, pore pressure, friction ratio, the corrected qt, the mechanical total resistance, the Ic curve, and the friction-ratio provenance. The friction-ratio source defaults to empty.

**Why it is here.** All arrays are parallel and shallow-to-deep, matching the raw storage order; the frontend inverts the depth axis to draw the geotechnical convention. The docstring flags that qt is *computed on read* from stored inputs and returns empty when any is missing — never invented, never stored (Data Integrity Rule 1) — and that qt and the mechanical total resistance are mutually exclusive in practice, which is the ``q_total_mpa`` versus ``qt_mpa`` distinction. Inner empties are allowed because the stored arrays can hold gaps.

.. CG-EXPLANATION-END id=class:CptPlotResponse

