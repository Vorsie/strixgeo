groundmodel.domain.services.elevation_rollback
==============================================

.. CG-PAGE source=src/groundmodel/domain/services/elevation_rollback.py complete=true

*Source file:* ``src/groundmodel/domain/services/elevation_rollback.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-38

.. literalinclude:: ../../../src/groundmodel/domain/services/elevation_rollback.py
   :language: python
   :lines: 1-38
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Introduces the pure logic for the surface-elevation provenance column (debt #21) and imports the elevation-source enum, defining which sources count as a real imported value worth snapshotting (DOV and GEF).

**Why it is here.** Both the CPT and borehole repositories share one decision when the elevation is set or cleared, and this module is the single source of that decision so the two cannot drift. Setting always stamps MANUAL so a re-import never overwrites a manual correction; the first override of an imported value snapshots the upstream triple — value, vertical reference system, source — clearing restores and consumes the snapshot to give a graceful undo back to the surveyed value, and clearing with no snapshot drops the row to the no-elevation state. The caller pre-resolves the default vertical reference system because that lookup lives in infrastructure, which the domain must not import.

.. CG-EXPLANATION-END id=module-header

Class ``ElevationState``
------------------------

.. CG-BLOCK id=class:ElevationState lines=39-73

.. literalinclude:: ../../../src/groundmodel/domain/services/elevation_rollback.py
   :language: python
   :lines: 39-73
   :lineno-match:

.. CG-EXPLANATION-START id=class:ElevationState

**What this does.** A frozen data holder mirroring the six elevation columns of a row: the current elevation, its vertical reference system and source, plus the snapshotted original elevation, original reference system, and original source.

**Why it is here.** It is the full provenance state the rollback logic reads and writes as one unit. A held snapshot always carries an imported source, so the presence of an original source is the flag for whether one exists.

.. CG-EXPLANATION-END id=class:ElevationState

Function ``def resolve_elevation_change``
-----------------------------------------

.. CG-BLOCK id=function:resolve_elevation_change lines=74-150

.. literalinclude:: ../../../src/groundmodel/domain/services/elevation_rollback.py
   :language: python
   :lines: 74-150
   :lineno-match:

.. CG-EXPLANATION-START id=function:resolve_elevation_change

**What this does.** Computes the new six-field state for a set-or-clear request. Setting resolves the vertical reference system (falling back to the caller's default), stamps MANUAL, and snapshots the upstream triple on the first override of an imported value, otherwise carrying any existing snapshot through. Clearing restores and consumes the snapshot when one is held, and otherwise drops the row to the no-elevation state.

**Why it is here.** It returns all six fields authoritatively so the caller just writes them back. Snapshotting only on the first override, then carrying it through, is what lets a second edit still roll back to the surveyed value rather than to the engineer's first correction. This mirrors the water-table rollback exactly, the other engineer-editable provenance column, so the two behave the same.

.. CG-EXPLANATION-END id=function:resolve_elevation_change

