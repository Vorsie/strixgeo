groundmodel.domain.services.robertson_sbt_non_normalised
========================================================

.. CG-PAGE source=src/groundmodel/domain/services/robertson_sbt_non_normalised.py complete=true

*Source file:* ``src/groundmodel/domain/services/robertson_sbt_non_normalised.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-58

.. literalinclude:: ../../../src/groundmodel/domain/services/robertson_sbt_non_normalised.py
   :language: python
   :lines: 1-58
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Introduces the non-normalised Robertson soil-behaviour-type classifier and its constants: atmospheric reference pressure, and a table mapping the index to chart zones 7 down to 2. It imports the maths library and a sequence type.

**Why it is here.** This is a separate, simpler classifier kept apart from the frozen normalised ``robertson_2015`` so that faithful port stays pristine. The docstring gives the published formula (Robertson 2010) and explains why it exists: the normalised pipeline needs an effective-stress profile and an iterative convergence, but the non-normalised index reads the ratio of cone resistance to atmospheric pressure and the friction ratio directly, needing neither. That makes it the right classifier at shallow depth or where the stress profile is unreliable, exactly where stress normalisation itself is unreliable. Like the normalised zone, this output is only a segmentation input for litho suggestions, never a committed design parameter, and zones 1, 8 and 9 are never emitted because they cannot be told from the index alone.

.. CG-EXPLANATION-END id=module-header

Function ``def i_sbt``
----------------------

.. CG-BLOCK id=function:i_sbt lines=59-92

.. literalinclude:: ../../../src/groundmodel/domain/services/robertson_sbt_non_normalised.py
   :language: python
   :lines: 59-92
   :lineno-match:

.. CG-EXPLANATION-START id=function:i_sbt

**What this does.** Computes the non-normalised soil-behaviour-type index at one point from the cone resistance and sleeve friction. It returns nothing when friction is missing, when either reading is zero or negative, or when the friction ratio is non-positive; otherwise it applies the published formula.

**Why it is here.** The index rests on base-ten logarithms of the resistance ratio and the friction ratio, both undefined at zero or below, so every guard is a place the maths would break. Returning nothing on those rows is the honest answer — a point that cannot be classified is left blank rather than filled with a guess.

.. CG-EXPLANATION-END id=function:i_sbt

Function ``def i_sbt_to_zone``
------------------------------

.. CG-BLOCK id=function:i_sbt_to_zone lines=93-112

.. literalinclude:: ../../../src/groundmodel/domain/services/robertson_sbt_non_normalised.py
   :language: python
   :lines: 93-112
   :lineno-match:

.. CG-EXPLANATION-START id=function:i_sbt_to_zone

**What this does.** Maps an index value to a soil-behaviour zone from 7 (coarsest, densest sand) down to 2 (organic), by walking the boundary table and returning the first zone whose upper limit the value falls under; anything above the last boundary is the organic zone.

**Why it is here.** The boundaries are the same numeric thresholds as the normalised index, because Robertson designed the non-normalised index that way, so the two classifiers speak the same zone language. Zones 1, 8 and 9 are deliberately never returned — they need the full chart position, not the index alone.

.. CG-EXPLANATION-END id=function:i_sbt_to_zone

Function ``def sbt_zone_series_non_normalised``
-----------------------------------------------

.. CG-BLOCK id=function:sbt_zone_series_non_normalised lines=113-140

.. literalinclude:: ../../../src/groundmodel/domain/services/robertson_sbt_non_normalised.py
   :language: python
   :lines: 113-140
   :lineno-match:

.. CG-EXPLANATION-START id=function:sbt_zone_series_non_normalised

**What this does.** Classifies a whole CPT series into zones, one per depth point, by computing the index at each row and mapping it to a zone, leaving a row blank where the index is undefined.

**Why it is here.** It returns the same shape as the normalised zone series — one zone or nothing per row, in order — so the litho segmenter can switch between the two zone sources behind a single flag without any other change.

.. CG-EXPLANATION-END id=function:sbt_zone_series_non_normalised

