groundmodel.domain.services.auto_correlate_helpers
==================================================

.. CG-PAGE source=src/groundmodel/domain/services/auto_correlate_helpers.py complete=true

*Source file:* ``src/groundmodel/domain/services/auto_correlate_helpers.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-21

.. literalinclude:: ../../../src/groundmodel/domain/services/auto_correlate_helpers.py
   :language: python
   :lines: 1-21
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Introduces the one surviving shared helper for the auto-correlate algorithms, the generic mutual-nearest-neighbour reducer, and imports the type tools it needs. It notes the old formation-level helpers were removed once nothing but their own test still used them.

**Why it is here.** The docstring records that the formation-level auto-correlate module is gone and only this generic reducer remains live, consumed by the contact-level algorithm. Keeping it pure (no database, no logging) means it can be reused and tested on its own.

.. CG-EXPLANATION-END id=module-header

Function ``def _mnn_by_id``
---------------------------

.. CG-BLOCK id=function:_mnn_by_id lines=22-68

.. literalinclude:: ../../../src/groundmodel/domain/services/auto_correlate_helpers.py
   :language: python
   :lines: 22-68
   :lineno-match:

.. CG-EXPLANATION-START id=function:_mnn_by_id

**What this does.** A generic mutual-nearest-neighbour reduction. Each candidate item is projected to two endpoint ids and a lower-is-better score. An item survives only when it is the best-scoring candidate at BOTH of its endpoints. Ties are broken by the opposite endpoint's id so the answer is deterministic.

**Why it is here.** When several candidate pairings share an endpoint, only the mutually-best one should survive, or the same boundary would be tied to two partners. Writing this as a generic core, with the caller supplying the id and score functions, means both the contact-level algorithm and any future caller share one correct implementation rather than each rolling its own. A dict here is a lookup table from key to value; the two dicts track the best candidate seen at each endpoint.

.. CG-EXPLANATION-END id=function:_mnn_by_id

