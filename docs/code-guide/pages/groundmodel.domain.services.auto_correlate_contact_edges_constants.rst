groundmodel.domain.services.auto_correlate_contact_edges_constants
==================================================================

.. CG-PAGE source=src/groundmodel/domain/services/auto_correlate_contact_edges_constants.py complete=true

*Source file:* ``src/groundmodel/domain/services/auto_correlate_contact_edges_constants.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-40

.. literalinclude:: ../../../src/groundmodel/domain/services/auto_correlate_contact_edges_constants.py
   :language: python
   :lines: 1-40
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Defines the algorithm's four tuning values: the maximum column distance (200 m), the base depth window (0.5 m), the distance factor that widens the window with separation (0.04, a 4 percent dip), and the auto provenance tag.

**Why it is here.** Project convention keeps constants beside the code that uses them so the algorithm body has no magic numbers. The comments carry the reasoning: beyond 200 m lateral facies change dominates real correlation signal; the 0.5 m window matches typical contact-pick precision; and the 4 percent dip is the ceiling the owner set after 5 percent drew steep diagonals where a lens is the honest reading, so steeper boundaries fall through to become lens candidates instead.

.. CG-EXPLANATION-END id=module-header

