groundmodel.application.stale_investigation_caches
==================================================

.. CG-PAGE source=src/groundmodel/application/stale_investigation_caches.py complete=true

*Source file:* ``src/groundmodel/application/stale_investigation_caches.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-29

.. literalinclude:: ../../../src/groundmodel/application/stale_investigation_caches.py
   :language: python
   :lines: 1-29
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the stale-caches file. It imports the geology and litho repositories and the logger, and its docstring explains why an elevation edit invalidates two caches.

**Why it is here.** An elevation edit moves the absolute level of every contact anchored at that investigation, so both cached geometries are wrong: the geological TIN surfaces and the 3-D body solids. Earlier a fix closed only the TIN half, and the solid cache landed later in a different table with its own staleness flag that no elevation path touched, so the 3-D viewer kept showing bodies at the old level; routing both handlers through this one use case stops the two caches drifting apart again (debt #34).

.. CG-EXPLANATION-END id=module-header

Class ``StaleCacheCounts``
--------------------------

.. CG-BLOCK id=class:StaleCacheCounts lines=30-49

.. literalinclude:: ../../../src/groundmodel/application/stale_investigation_caches.py
   :language: python
   :lines: 30-49
   :lineno-match:

.. CG-EXPLANATION-START id=class:StaleCacheCounts

**What this does.** A frozen dataclass reporting how many surface rows and solid rows were flipped to stale, and across how many models.

**Why it is here.** Zero models means the investigation carries no interpretation, so nothing needed staling — a meaningful answer, not an error.

.. CG-EXPLANATION-END id=class:StaleCacheCounts

Class ``StaleInvestigationCaches`` — header
-------------------------------------------

.. CG-BLOCK id=class:StaleInvestigationCaches lines=50-52

.. literalinclude:: ../../../src/groundmodel/application/stale_investigation_caches.py
   :language: python
   :lines: 50-52
   :lineno-match:

.. CG-EXPLANATION-START id=class:StaleInvestigationCaches

**What this does.** The use case that flips every cached geometry anchored at one investigation to stale.

**Why it is here.** The single reconciliation point both elevation handlers call.

.. CG-EXPLANATION-END id=class:StaleInvestigationCaches

Method ``StaleInvestigationCaches``. ``def __init__``
-----------------------------------------------------

.. CG-BLOCK id=method:StaleInvestigationCaches.__init__ lines=53-57

.. literalinclude:: ../../../src/groundmodel/application/stale_investigation_caches.py
   :language: python
   :lines: 53-57
   :lineno-match:

.. CG-EXPLANATION-START id=method:StaleInvestigationCaches.__init__

**What this does.** Stores the session; the docstring notes it does not commit.

**Why it is here.** The caller runs this inside the same transaction as the elevation write, so a failed write cannot leave the caches marked stale and a successful one cannot leave them fresh.

.. CG-EXPLANATION-END id=method:StaleInvestigationCaches.__init__

Method ``StaleInvestigationCaches``. ``async def execute``
----------------------------------------------------------

.. CG-BLOCK id=method:StaleInvestigationCaches.execute lines=58-109

.. literalinclude:: ../../../src/groundmodel/application/stale_investigation_caches.py
   :language: python
   :lines: 58-109
   :lineno-match:

.. CG-EXPLANATION-START id=method:StaleInvestigationCaches.execute

**What this does.** Finds the model-and-formation pairs the investigation has contacts in, stales their surfaces, then stales the solids of each involved model, and reports the counts; it raises when the anchor is not exactly one of CPT or borehole.

**Why it is here.** It does not commit for the transaction-atomicity reason above. A model with no built solids is a legal no-op returning zero, so the sweep is safe on a project that has not built its 3-D model yet.

.. CG-EXPLANATION-END id=method:StaleInvestigationCaches.execute

