groundmodel.infrastructure.parsers.dov.dov_wfs_bbox
===================================================

.. CG-PAGE source=src/groundmodel/infrastructure/parsers/dov/dov_wfs_bbox.py complete=true

*Source file:* ``src/groundmodel/infrastructure/parsers/dov/dov_wfs_bbox.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-53

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/dov/dov_wfs_bbox.py
   :language: python
   :lines: 1-53
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A docstring, then the imports for a shared helper that walks a rectangle, splitting it when it holds too many features.

**Why it is here.** Every DOV WFS client faced the same problem: a reply is capped at a maximum number of features, so a busy rectangle has to be quartered until each piece fits, and duplicates at the split boundaries removed. That pattern is pulled into this one shared helper; each client keeps only what differs — its layer name, its filter, and how it builds and skips rows.

.. CG-EXPLANATION-END id=module-header

Function ``async def collect_wfs_features_recursive``
-----------------------------------------------------

.. CG-BLOCK id=function:collect_wfs_features_recursive lines=54-158

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/dov/dov_wfs_bbox.py
   :language: python
   :lines: 54-158
   :lineno-match:

.. CG-EXPLANATION-START id=function:collect_wfs_features_recursive

**What this does.** Asks how many features are in a rectangle; if none, returns empty; if within the cap (or at the depth limit) it fetches them; otherwise it splits the rectangle into four quarters, does the same for each, and merges the results with duplicates removed.

**Why it is here.** The depth limit stops the splitting from going on forever on impossibly dense data — at that point it warns, naming the rectangle so the operator can see where features are being missed, and returns what it could get. De-duplicating by permkey is needed because a feature sitting right on a split line shows up in more than one quarter. The counting and fetching are handed in by the caller so this helper stays free of any one client's request details.

.. CG-EXPLANATION-END id=function:collect_wfs_features_recursive

