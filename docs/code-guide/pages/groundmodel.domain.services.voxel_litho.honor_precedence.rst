groundmodel.domain.services.voxel_litho.honor_precedence
========================================================

.. CG-PAGE source=src/groundmodel/domain/services/voxel_litho/honor_precedence.py complete=true

*Source file:* ``src/groundmodel/domain/services/voxel_litho/honor_precedence.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-63

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/honor_precedence.py
   :language: python
   :lines: 1-63
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Introduces the rule that decides which investigation wins when two of them fall in the same voxel column, and imports the pieces it needs. A regular grid can hold only one observed log per column, so two investigations closer together than one horizontal voxel contend for it, and only one log survives; the loser is labelled from its neighbour at its own map position. The docstring spells out the four-key order: having any log at all beats having none; then a CPT beats a borehole; then the deeper one (by lowest base elevation) wins; then the lower id breaks the final tie.

**Why it is here.** The docstring records both the previous behaviour and why it was wrong: the winner used to be whichever investigation was imported first (the ids are time-ordered), and the choice even moved with the grid position from one build to the next. The owner's first instinct was that a borehole should always win, and that was reversed on measurement: the driller's descriptions are logged on a half-metre grid, so a borehole contact depth is only known to the nearest half metre, while the cone registers depth continuously and resolves three to four times more contacts — the borehole stays the better source for WHAT the soil is, but its contact geometry is the least reliable in the pair, and a voxel column is geometry. A note flags that a future investigation kind must be given an explicit place in the ranking rather than inheriting one.

.. CG-EXPLANATION-END id=module-header

Function ``def honor_rank``
---------------------------

.. CG-BLOCK id=function:honor_rank lines=64-96

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/honor_precedence.py
   :language: python
   :lines: 64-96
   :lineno-match:

.. CG-EXPLANATION-START id=function:honor_rank

**What this does.** Returns a four-part sort key for one investigation's column — has-no-log flag, kind rank (0 for a cone, 1 for a borehole, 2 for anything unknown), lowest base elevation, and the investigation id. The smallest key wins, so the caller either takes the minimum or compares candidates one against the other; both give the same answer because the key is a total order.

**Why it is here.** The docstring explains the two guarded edges. An empty log has nothing to honour, so it is ranked below every real log — even a cone with no readings must not take a column from a borehole that has some — which is the first key. And a column with no intervals is given an infinite base elevation rather than letting the minimum over an empty sequence raise an error. Because the four keys form a total order, a cell holding three or more contenders resolves to the same winner no matter what order they are folded in, so the caller never has to sort.

.. CG-EXPLANATION-END id=function:honor_rank

