groundmodel.application.set_geotech_statistic
=============================================

.. CG-PAGE source=src/groundmodel/application/set_geotech_statistic.py complete=true

*Source file:* ``src/groundmodel/application/set_geotech_statistic.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-30

.. literalinclude:: ../../../src/groundmodel/application/set_geotech_statistic.py
   :language: python
   :lines: 1-30
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the set-statistic file. It imports the list of valid statistics and the model row, and its docstring records rulings 7 and 8.

**Why it is here.** The statistic the NAD classifier reads is selectable per geotech model (median, arithmetic, harmonic, geometric) because the choice systematically shifts classes and is part of provenance (ruling 7). Changing it marks the model stale, never silently re-deriving the bands (ruling 8): this writes exactly one column and commits, does not touch the bands, and does not stale the 3-D solids because the bands are unchanged — what goes stale is the classification, and that staleness is derived, not stored.

.. CG-EXPLANATION-END id=module-header

Class ``SetGeotechStatisticResult``
-----------------------------------

.. CG-BLOCK id=class:SetGeotechStatisticResult lines=31-50

.. literalinclude:: ../../../src/groundmodel/application/set_geotech_statistic.py
   :language: python
   :lines: 31-50
   :lineno-match:

.. CG-EXPLANATION-START id=class:SetGeotechStatisticResult

**What this does.** A frozen dataclass carrying the stored choice, what the last build classified with, and whether the bands are stale.

**Why it is here.** Staleness is derived — a build has run and its statistic differs from the choice — so the build stamps the classified-with value on success and the flag self-clears.

.. CG-EXPLANATION-END id=class:SetGeotechStatisticResult

Class ``SetGeotechStatistic`` — header
--------------------------------------

.. CG-BLOCK id=class:SetGeotechStatistic lines=51-59

.. literalinclude:: ../../../src/groundmodel/application/set_geotech_statistic.py
   :language: python
   :lines: 51-59
   :lineno-match:

.. CG-EXPLANATION-START id=class:SetGeotechStatistic

**What this does.** The use case that writes the one representative-statistic column.

**Why it is here.** Everything else is derived, so this touches exactly one column and commits.

.. CG-EXPLANATION-END id=class:SetGeotechStatistic

Method ``SetGeotechStatistic``. ``def __init__``
------------------------------------------------

.. CG-BLOCK id=method:SetGeotechStatistic.__init__ lines=60-64

.. literalinclude:: ../../../src/groundmodel/application/set_geotech_statistic.py
   :language: python
   :lines: 60-64
   :lineno-match:

.. CG-EXPLANATION-START id=method:SetGeotechStatistic.__init__

**What this does.** Stores the session.

**Why it is here.** The caller owns the session; this use case owns the commit.

.. CG-EXPLANATION-END id=method:SetGeotechStatistic.__init__

Method ``SetGeotechStatistic``. ``async def execute``
-----------------------------------------------------

.. CG-BLOCK id=method:SetGeotechStatistic.execute lines=65-111

.. literalinclude:: ../../../src/groundmodel/application/set_geotech_statistic.py
   :language: python
   :lines: 65-111
   :lineno-match:

.. CG-EXPLANATION-START id=method:SetGeotechStatistic.execute

**What this does.** Validates the statistic token, loads the model, writes the choice, commits, and returns the derived staleness.

**Why it is here.** An unknown token raises (the router maps it to a 422); the staleness is computed from the model's own stamps rather than stored.

.. CG-EXPLANATION-END id=method:SetGeotechStatistic.execute

