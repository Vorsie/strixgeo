groundmodel.domain.services.cpt_interpretation
==============================================

.. CG-PAGE source=src/groundmodel/domain/services/cpt_interpretation.py complete=true

*Source file:* ``src/groundmodel/domain/services/cpt_interpretation.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-23

.. literalinclude:: ../../../src/groundmodel/domain/services/cpt_interpretation.py
   :language: python
   :lines: 1-23
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Introduces a PREVIEW implementation of the Robertson soil-behaviour-type index Ic and imports the maths library plus the unit-weight profile it needs. It sets one constant, atmospheric pressure in kPa.

**Why it is here.** The docstring states the scope plainly: all engineering interpretation is deferred to the final phase (Phase 5), and this module exists only so the CPT chart can render an Ic panel today. It must not be extended with more engineering calculations before Phase 5; bug fixes are fine. The modern, frozen Robertson method lives in ``robertson_2015``; this older preview is kept because a chart panel already draws from it.

.. CG-EXPLANATION-END id=module-header

Function ``def calculate_ic``
-----------------------------

.. CG-BLOCK id=function:calculate_ic lines=24-41

.. literalinclude:: ../../../src/groundmodel/domain/services/cpt_interpretation.py
   :language: python
   :lines: 24-41
   :lineno-match:

.. CG-EXPLANATION-START id=function:calculate_ic

**What this does.** Computes the soil-behaviour-type index Ic at one point from the normalised cone resistance and the friction ratio, using the published Robertson (1990) formula. Ic is a single number that places a reading on the soil-behaviour chart, running low for sands and high for clays and peat.

**Why it is here.** This is the exact published identity, written once so both the point classifier and the depth-series version below use the same arithmetic. Its inputs must be positive because the formula takes their base-ten logarithms, which are undefined at zero or below.

.. CG-EXPLANATION-END id=function:calculate_ic

Function ``def classify_soil_ic``
---------------------------------

.. CG-BLOCK id=function:classify_soil_ic lines=42-79

.. literalinclude:: ../../../src/groundmodel/domain/services/cpt_interpretation.py
   :language: python
   :lines: 42-79
   :lineno-match:

.. CG-EXPLANATION-START id=function:classify_soil_ic

**What this does.** Turns an Ic value into a human-readable soil class, from gravelly/dense sand at the low end up through sands, sand mixtures, silt mixtures and clays to organic soils at the high end. The bands are half-open, so a value sitting exactly on a breakpoint belongs to the band above it.

**Why it is here.** The breakpoints are the same ones the non-normalised classifier maps to chart zones, and the labels are pinned against a shared contract fixture that the desktop's own copy also checks itself against — one arbiter, so the Python and TypeScript labels can never drift. The docstring records a 2026-08-02 audit correction: every band had been one step too coarse, and the code no longer returns Robertson's zone 1 from the index at all, because that zone is read off the chart position, never off Ic.

.. CG-EXPLANATION-END id=function:classify_soil_ic

Function ``def calculate_ic_series``
------------------------------------

.. CG-BLOCK id=function:calculate_ic_series lines=80-154

.. literalinclude:: ../../../src/groundmodel/domain/services/cpt_interpretation.py
   :language: python
   :lines: 80-154
   :lineno-match:

.. CG-EXPLANATION-START id=function:calculate_ic_series

**What this does.** Computes Ic at every depth of a CPT using the iterative Robertson & Wride (1998) method. For each depth it works out the total and effective vertical stress from a two-layer unit-weight model split at the water table, forms the net cone resistance and friction ratio, then repeats a small calculation — guessing a stress exponent, computing Ic, updating the exponent — until the two settle. Rows with missing friction or non-positive resistance come back empty.

**Why it is here.** Normalising the readings for stress lets the same soil read the same whether it is shallow or deep, and the stress exponent depends on Ic while Ic depends on the exponent, so the method guesses and repeats until they agree. The water table defaults to the surface, which is the conservative choice when the depth to water is unknown. Every guarded skip and every floor at one kilopascal is a spot where the logarithms behind the formula would otherwise be undefined near the surface.

.. CG-EXPLANATION-END id=function:calculate_ic_series

