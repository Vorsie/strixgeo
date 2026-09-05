groundmodel.domain.services.litho_segmentation_constants
========================================================

.. CG-PAGE source=src/groundmodel/domain/services/litho_segmentation_constants.py complete=true

*Source file:* ``src/groundmodel/domain/services/litho_segmentation_constants.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-86

.. literalinclude:: ../../../src/groundmodel/domain/services/litho_segmentation_constants.py
   :language: python
   :lines: 1-86
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Defines the two lookup tables the litho segmenter uses: Robertson soil-behaviour zone (1 to 9) to a base soil class, and DOV hoofdnaam soil codes to a base soil class. A lookup table here is a dict, a set of key-to-value entries.

**Why it is here.** The docstring keeps these in a sibling file so Phase-5 tuning does not require opening the algorithm, and marks both as tuning targets under debt #117. The comments carry the geotechnical judgement behind the mappings: gravel is not reliably resolvable from a standard Robertson chart, so zone 7 maps to sand and gravel is confirmed only from borehole observation; and rock, construction material, shells, and unknown codes map to nothing so the segmenter skips or conservatively handles those layers. Zone-to-soil assignments follow Robertson (2009/2015).

.. CG-EXPLANATION-END id=module-header

