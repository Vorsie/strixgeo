groundmodel.domain.services.robertson_2015
==========================================

.. CG-PAGE source=src/groundmodel/domain/services/robertson_2015.py complete=true

*Source file:* ``src/groundmodel/domain/services/robertson_2015.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-84

.. literalinclude:: ../../../src/groundmodel/domain/services/robertson_2015.py
   :language: python
   :lines: 1-84
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Introduces the file and imports its tools (chiefly numpy, for
fast array maths) and the chart-boundary numbers it needs. This file turns the
raw numbers a CPT records into a soil-behaviour classification.

**Why it is here.** A CPT (cone penetration test) pushes an instrumented cone
into the ground and, every couple of centimetres, records how hard the tip
pushes (``qc``) and how much the sleeve rubs (``fs``). Those two numbers, treated
carefully, tell you what *kind* of ground it is. This file implements the
published method for that: the normalised parameters of Robertson (2009), the
soil-behaviour-type chart of Robertson (2015), with the peat boundary of
Lengkeek & Brinkgreve (2022). The docstring is emphatic about scope: in this
phase these results are used *only* as an input to suggest layer boundaries —
they are never saved as engineering design values, which stay Phase 5. The units
block at the top is load-bearing: mixing up kPa and MPa here would quietly
corrupt every result, so the expected unit of every quantity is written down.

.. CG-EXPLANATION-END id=module-header

Function ``def _zone_threshold``
--------------------------------

.. CG-BLOCK id=function:_zone_threshold lines=85-108

.. literalinclude:: ../../../src/groundmodel/domain/services/robertson_2015.py
   :language: python
   :lines: 85-108
   :lineno-match:

.. CG-EXPLANATION-START id=function:_zone_threshold

**What this does.** For a given friction value, reads off one of the seven
soil-behaviour chart boundary lines and returns the tip-resistance value on that
line. It works in log-scale, which is how the chart is drawn.

**Why it is here.** Robertson's soil-behaviour chart is a set of curved boundary
lines on a log-log plot. To decide which zone a point falls in you need to know
where each boundary sits at that point's friction value; this reads that off by
straight-line interpolation between the tabulated boundary points. It is a small
private helper used by the zone-assignment function below.

.. CG-EXPLANATION-END id=function:_zone_threshold

Function ``def unit_weight``
----------------------------

.. CG-BLOCK id=function:unit_weight lines=109-142

.. literalinclude:: ../../../src/groundmodel/domain/services/robertson_2015.py
   :language: python
   :lines: 109-142
   :lineno-match:

.. CG-EXPLANATION-START id=function:unit_weight

**What this does.** Estimates the soil's bulk unit weight (its heaviness per cubic
metre) from the CPT's ``qc`` and ``fs``, using the published Robertson & Cabal
(2010) formula. It returns nothing when the maths is undefined (for example when
a value is zero or negative, which a logarithm cannot take).

**Why it is here.** The stress calculation below needs to know how heavy the
ground is at each depth, and a CPT does not measure that directly — this is the
accepted way to estimate it from what the CPT *does* measure. Returning nothing
on an undefined point (instead of a wrong number) lets the caller fill the gap
from the next valid point rather than break.

.. CG-EXPLANATION-END id=function:unit_weight

Class ``StressResult``
----------------------

.. CG-BLOCK id=class:StressResult lines=143-164

.. literalinclude:: ../../../src/groundmodel/domain/services/robertson_2015.py
   :language: python
   :lines: 143-164
   :lineno-match:

.. CG-EXPLANATION-START id=class:StressResult

**What this does.** A small, read-only data holder for the stress state at one
depth: the total vertical stress, the water pressure, the effective stress (total
minus water), and the unit weight used. The ``@dataclass(frozen=True)`` line above
means "this is just a bundle of named numbers, and it cannot be changed after it
is made".

**Why it is here.** The stress numbers travel together from one step to the next,
so bundling them under clear names is safer than passing four loose numbers
around. "Frozen" guarantees a computed stress point is never accidentally edited
downstream.

.. CG-EXPLANATION-END id=class:StressResult

Function ``def stress_profile``
-------------------------------

.. CG-BLOCK id=function:stress_profile lines=165-302

.. literalinclude:: ../../../src/groundmodel/domain/services/robertson_2015.py
   :language: python
   :lines: 165-302
   :lineno-match:

.. CG-EXPLANATION-START id=function:stress_profile

**What this does.** Walks down a CPT column and computes, at every depth, how much
the ground weighs on top of that point (total stress), how much of that is carried
by water pressure, and the difference (effective stress — the part carried by the
soil grains). It handles the three positions the water table can be in — above the
ground, within the column, or below it — and fills any gaps in unit weight from
the next valid point below.

**Why it is here.** Effective stress is the foundation the whole Robertson method
stands on: the "normalisation" in the next step divides by it. The integration
uses the real spacing between measurements rather than a fixed step, because the
stored series already carries each depth. The very last line floors effective
stress at a tiny positive value, because near the surface it can reach zero, and
the normalisation divides by it and takes its logarithm — both undefined at
zero.

.. CG-EXPLANATION-END id=function:stress_profile

Class ``QtnResult``
-------------------

.. CG-BLOCK id=class:QtnResult lines=303-324

.. literalinclude:: ../../../src/groundmodel/domain/services/robertson_2015.py
   :language: python
   :lines: 303-324
   :lineno-match:

.. CG-EXPLANATION-START id=class:QtnResult

**What this does.** A read-only bundle of the four converged Robertson numbers at
one depth: the normalised tip resistance (Qtn), the normalised friction ratio
(F), the soil-behaviour index (Ic), and the stress exponent (n) the method
settled on.

**Why it is here.** These four are produced together by the iterative calculation
below and consumed together by the zone assignment, so they travel as one named
bundle.

.. CG-EXPLANATION-END id=class:QtnResult

Function ``def qtn_f_ic_series``
--------------------------------

.. CG-BLOCK id=function:qtn_f_ic_series lines=325-420

.. literalinclude:: ../../../src/groundmodel/domain/services/robertson_2015.py
   :language: python
   :lines: 325-420
   :lineno-match:

.. CG-EXPLANATION-START id=function:qtn_f_ic_series

**What this does.** For each depth, computes the normalised Robertson parameters
by repeating a small calculation until it settles (converges). "Normalising"
means adjusting the raw readings for how deep — and therefore how squeezed — the
soil is, so that the same soil reads the same whether it is shallow or deep. The
exact published formulas are written in the docstring. Points where the maths is
undefined come back as nothing.

**Why it is here.** The soil-behaviour index Ic depends on the stress exponent n,
but n depends on Ic — a chicken-and-egg loop — so the method guesses, recomputes,
and repeats until the two agree (in practice a handful of rounds). Each guarded
skip (missing friction, non-positive net resistance) is a spot where the
logarithms behind the formulas would be undefined, so those points are honestly
returned as "no result" rather than a made-up number.

.. CG-EXPLANATION-END id=function:qtn_f_ic_series

Function ``def sbt_zone_series``
--------------------------------

.. CG-BLOCK id=function:sbt_zone_series lines=421-501

.. literalinclude:: ../../../src/groundmodel/domain/services/robertson_2015.py
   :language: python
   :lines: 421-501
   :lineno-match:

.. CG-EXPLANATION-START id=function:sbt_zone_series

**What this does.** Turns each depth's converged numbers into a soil-behaviour
zone from 1 to 9 (from "sensitive fine-grained" up through clays and silts to
"gravelly to dense sand"), by placing the point against the seven chart boundary
lines plus the separate peat boundary.

**Why it is here.** This is the actual chart look-up — the point-in-zone decision
of Robertson (2015), with the peat extension of Lengkeek & Brinkgreve (2022)
written in exactly as published. The long chain of conditions is the chart's zone
ladder spelled out; the final catch-all is unreachable in practice and is there
only to guarantee every point gets an answer.

.. CG-EXPLANATION-END id=function:sbt_zone_series

Function ``def relative_density_sand``
--------------------------------------

.. CG-BLOCK id=function:relative_density_sand lines=502-556

.. literalinclude:: ../../../src/groundmodel/domain/services/robertson_2015.py
   :language: python
   :lines: 502-556
   :lineno-match:

.. CG-EXPLANATION-START id=function:relative_density_sand

**What this does.** Estimates a *sand's* relative density (how tightly packed it
is, as a percentage) from the tip resistance and effective stress, using the
published Jamiolkowski et al. (2003) formula. It returns nothing when the maths is
undefined, and rejects an obviously wrong compression factor.

**Why it is here.** Relative density is what turns a "this is sand" into "this is
*loose* / *dense* sand" — the packing information the geotech stage needs. The
formula is only valid for clean sand, so the docstring is explicit that the
*caller* must check the point really is clean sand before trusting the result;
this function only guards the arithmetic. The compression factor defaults to the
average quartz-sand value, with the calcareous and quartz extremes noted.

.. CG-EXPLANATION-END id=function:relative_density_sand

Function ``def ic_series_2015``
-------------------------------

.. CG-BLOCK id=function:ic_series_2015 lines=557-617

.. literalinclude:: ../../../src/groundmodel/domain/services/robertson_2015.py
   :language: python
   :lines: 557-617
   :lineno-match:

.. CG-EXPLANATION-START id=function:ic_series_2015

**What this does.** A convenience wrapper that takes plain depth / qc / fs lists
and a water-table depth and returns the soil-behaviour index Ic at every point,
running the whole pipeline above internally.

**Why it is here.** It gives the rest of the app a single, simple call for "just
give me Ic down this CPT", with the same shape as the older preview it replaced,
so both the layer segmenter and the CPT detail chart draw Ic from the same modern
method (debt #22). The trick with the elevations — setting the ground to 0 and the
water table to minus the water depth — makes the stress calculation need only the
*depth* to water, not a surveyed ground level, which many CPTs do not carry.

.. CG-EXPLANATION-END id=function:ic_series_2015

