groundmodel.domain.services.voxel_litho.paired_stations
=======================================================

.. CG-PAGE source=src/groundmodel/domain/services/voxel_litho/paired_stations.py complete=true

*Source file:* ``src/groundmodel/domain/services/voxel_litho/paired_stations.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-32

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/paired_stations.py
   :language: python
   :lines: 1-32
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Introduces a small helper that answers one question: which investigations do not own the voxel cell they physically stand in. A voxel is one cube-shaped cell of the 3-D grid, like a pixel in three dimensions. It imports numpy, the honour-ranking rule, and the investigation-column value object.

**Why it is here.** A regular grid fills each cell from ONE log, and where two investigations share a station the honour rule picks the winner (owner ruling 2026-07-27: has-a-log first, then a CPT beats a borehole, then the deeper one, then the id as a tiebreak) while the loser's ground carries its partner's log. A log can only be fairly scored where it actually stands, so what makes it unscoreable is its own cell being owned by someone else's log. The docstring records why this exact test was chosen over two rejected ones: a loose proximity rule flagged five perfectly scoreable logs, and an 'owns no cell anywhere' rule was too tight. This sharper test isolated two of three residual drilled-gate failures on the owner's model. Pure geometry, no logging.

.. CG-EXPLANATION-END id=module-header

Function ``def honored_cell_owners``
------------------------------------

.. CG-BLOCK id=function:honored_cell_owners lines=33-73

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/paired_stations.py
   :language: python
   :lines: 33-73
   :lineno-match:

.. CG-EXPLANATION-START id=function:honored_cell_owners

**What this does.** Replays the builder's honour assignment exactly. For every logged investigation it walks the grid cells within the honour radius and claims them; where two investigations claim the same cell, the one with the smaller honour rank keeps it. It returns a map from each cell (its row-and-column index pair) to the investigation that owns it.

**Why it is here.** It must match the labeller's own loop so the answer reflects the real build, not an approximation. The comment notes the honour rule is imported inside the function on purpose, to keep the dependency one-way and avoid a circular import if the labeller ever imports this module back. An investigation with no observed intervals is skipped: it has no log to honour. The result is a dict (a lookup table from key to value); cells nobody claims are simply absent.

.. CG-EXPLANATION-END id=function:honored_cell_owners

Function ``def paired_station_losers``
--------------------------------------

.. CG-BLOCK id=function:paired_station_losers lines=74-120

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/paired_stations.py
   :language: python
   :lines: 74-120
   :lineno-match:

.. CG-EXPLANATION-START id=function:paired_station_losers

**What this does.** Returns the ids of the logged investigations that do NOT own the cell they stand in. It first replays who owns each cell, then for each logged investigation finds the nearest grid cell to its true position and checks whether that cell's owner is itself; if not, the investigation is added to the loser set.

**Why it is here.** A log scored against a cell it does not own is being measured against a neighbour's ground, which is exactly what two residual drilled-gate failures on the owner's model were: two logs about a metre apart, each keeping outer cells but sharing the one between them, so the loser was scored against a column it does not own. A set (an unordered collection with no duplicates) collects the losers. An investigation with no observed intervals is never included, because it has nothing to honour and nothing to score, so it neither wins nor loses.

.. CG-EXPLANATION-END id=function:paired_station_losers

