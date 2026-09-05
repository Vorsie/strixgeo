groundmodel.domain.services.litho_geo_bounding
==============================================

.. CG-PAGE source=src/groundmodel/domain/services/litho_geo_bounding.py complete=true

*Source file:* ``src/groundmodel/domain/services/litho_geo_bounding.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-39

.. literalinclude:: ../../../src/groundmodel/domain/services/litho_geo_bounding.py
   :language: python
   :lines: 1-39
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Introduces the module that flags tests too shallow to reach the deepest geological boundary, and imports the pick type it operates on. It defines a tiny numeric tolerance for treating two elevations as coincident.

**Why it is here.** The docstring records a firm owner directive of 2026-06-25: a geological boundary is a TOP, so the deepest geological unit a test reaches owns everything down to its bottom, and deep litho is therefore never truncated or dropped, only flagged. It also records that a second transform, which used to split every column at each geological line (the geological wall), was deleted at the owner's instruction (just drop the wall everywhere); a geological surface now only labels, it never divides. The module stays pure and build-only; the geological model itself is never modified.

.. CG-EXPLANATION-END id=module-header

Function ``def _elev``
----------------------

.. CG-BLOCK id=function:_elev lines=40-57

.. literalinclude:: ../../../src/groundmodel/domain/services/litho_geo_bounding.py
   :language: python
   :lines: 40-57
   :lineno-match:

.. CG-EXPLANATION-START id=function:_elev

**What this does.** Converts a depth below a pick's surface into an absolute elevation by subtracting the depth from the surface elevation.

**Why it is here.** The shallow-test test compares a test's deepest point against a geological boundary, and both must be in the same absolute-elevation frame. This one-line helper does that conversion in a single named place.

.. CG-EXPLANATION-END id=function:_elev

Class ``ShallowTestResult``
---------------------------

.. CG-BLOCK id=class:ShallowTestResult lines=58-77

.. literalinclude:: ../../../src/groundmodel/domain/services/litho_geo_bounding.py
   :language: python
   :lines: 58-77
   :lineno-match:

.. CG-EXPLANATION-START id=class:ShallowTestResult

**What this does.** A frozen data holder for the result: all the input picks, unchanged, plus the sorted ids of the tests flagged as too shallow.

**Why it is here.** The docstring explains that the picks are carried through untouched because the callers thread this same list into their next grouping pass, and that flagged tests keep all their litho per the owner directive. Returning the picks alongside the flags keeps the pipeline's ordering intact while still surfacing which tests could not floor the model.

.. CG-EXPLANATION-END id=class:ShallowTestResult

Function ``def mark_and_truncate_shallow_tests``
------------------------------------------------

.. CG-BLOCK id=function:mark_and_truncate_shallow_tests lines=78-128

.. literalinclude:: ../../../src/groundmodel/domain/services/litho_geo_bounding.py
   :language: python
   :lines: 78-128
   :lineno-match:

.. CG-EXPLANATION-START id=function:mark_and_truncate_shallow_tests

**What this does.** Groups the picks by investigation, and for each one compares its deepest point against the lowest geological boundary at that location. When the test bottoms out ABOVE that boundary it is flagged, but all its picks are kept. It returns every pick plus the flagged ids.

**Why it is here.** The comment records the full history and the current law: before 2026-06-25 this truncated a flagged test and dropped its uncorrelated deep picks, which left a geotech column shallower than its own litho (the GEO-23/125-S7 dogfeed). Now the deep litho is retained and geo-labelled by the builders' grouping pass, never dropped. The function name is kept only for call-site stability, even though it no longer truncates.

.. CG-EXPLANATION-END id=function:mark_and_truncate_shallow_tests

