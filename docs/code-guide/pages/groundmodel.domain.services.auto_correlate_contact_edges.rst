groundmodel.domain.services.auto_correlate_contact_edges
========================================================

.. CG-PAGE source=src/groundmodel/domain/services/auto_correlate_contact_edges.py complete=true

*Source file:* ``src/groundmodel/domain/services/auto_correlate_contact_edges.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-50

.. literalinclude:: ../../../src/groundmodel/domain/services/auto_correlate_contact_edges.py
   :language: python
   :lines: 1-50
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Introduces the algorithm that proposes correlation lines between the same soil boundary seen on neighbouring investigations. It imports the maths module, the tuning values, and the shared mutual-nearest-neighbour helper. The docstring lays out the five steps: group contacts by soil, restrict to adjacent columns, pair contacts within a depth window, keep only mutual best matches, and emit the pairs.

**Why it is here.** A correlation line is the engineer's statement that a boundary seen on two columns is the same surface. This algorithm only SUGGESTS such lines for the engineer to accept; it writes them as unapproved. The docstring records the hard-won simplification of 2026-05-29: grouping by soil alone (silt to silt, sand to sand) rather than by a stricter triple, because the old triple blocked obvious same-soil correlations. It is pure, so it owns no side effects; the caller persists the suggestions.

.. CG-EXPLANATION-END id=module-header

Class ``ContactRecord``
-----------------------

.. CG-BLOCK id=class:ContactRecord lines=51-86

.. literalinclude:: ../../../src/groundmodel/domain/services/auto_correlate_contact_edges.py
   :language: python
   :lines: 51-86
   :lineno-match:

.. CG-EXPLANATION-START id=class:ContactRecord

**What this does.** A frozen data holder (a small read-only class that just bundles named values) for one contact the algorithm reasons about: its id, the formation it tops, the column it sits on, its depth, its geological parent, the soil above it, and the soil below it.

**Why it is here.** The algorithm needs a slim snapshot of each contact, not the whole database row. The docstring notes the parent and below-soil fields are kept only for provenance and no longer gate pairing, so a boundary correlates on its own soil even when a neighbour has an extra interbed. Being frozen means a snapshot cannot be quietly altered while the algorithm runs.

.. CG-EXPLANATION-END id=class:ContactRecord

Class ``InvestigationLocation``
-------------------------------

.. CG-BLOCK id=class:InvestigationLocation lines=87-103

.. literalinclude:: ../../../src/groundmodel/domain/services/auto_correlate_contact_edges.py
   :language: python
   :lines: 87-103
   :lineno-match:

.. CG-EXPLANATION-START id=class:InvestigationLocation

**What this does.** A frozen data holder for one investigation's map position: its id and its easting and northing in metres.

**Why it is here.** The algorithm measures horizontal distance between columns to size the depth window and to decide which columns are neighbours, so it needs each investigation's planar position in one small bundle keyed by the same id the contacts carry.

.. CG-EXPLANATION-END id=class:InvestigationLocation

Class ``AutoCorrelateContactParams``
------------------------------------

.. CG-BLOCK id=class:AutoCorrelateContactParams lines=104-124

.. literalinclude:: ../../../src/groundmodel/domain/services/auto_correlate_contact_edges.py
   :language: python
   :lines: 104-124
   :lineno-match:

.. CG-EXPLANATION-START id=class:AutoCorrelateContactParams

**What this does.** A frozen data holder for the three tunable inputs: the maximum column distance, the base depth window, and the distance factor that widens the window with separation. Each defaults to the value from the constants file.

**Why it is here.** Gathering the tunables in one bundle lets a caller or a test override them together without editing the algorithm. The defaults come from the constants module so the normal run needs no arguments.

.. CG-EXPLANATION-END id=class:AutoCorrelateContactParams

Class ``_ContactCandidatePair``
-------------------------------

.. CG-BLOCK id=class:_ContactCandidatePair lines=125-144

.. literalinclude:: ../../../src/groundmodel/domain/services/auto_correlate_contact_edges.py
   :language: python
   :lines: 125-144
   :lineno-match:

.. CG-EXPLANATION-START id=class:_ContactCandidatePair

**What this does.** A frozen data holder used inside the algorithm for one candidate pairing: the two contact ids in a fixed order (smaller id first) and the absolute depth difference between them.

**Why it is here.** The mutual-nearest-neighbour step scores candidate pairs by depth difference and needs them in a canonical order so the same pair is never counted twice. This internal type carries exactly that. The leading underscore marks it private to this module.

.. CG-EXPLANATION-END id=class:_ContactCandidatePair

Class ``ContactCorrelationCandidate``
-------------------------------------

.. CG-BLOCK id=class:ContactCorrelationCandidate lines=145-163

.. literalinclude:: ../../../src/groundmodel/domain/services/auto_correlate_contact_edges.py
   :language: python
   :lines: 145-163
   :lineno-match:

.. CG-EXPLANATION-START id=class:ContactCorrelationCandidate

**What this does.** A frozen data holder for one proposed correlation edge: the two contact ids in canonical order and a source tag that is always the auto tag.

**Why it is here.** This is the algorithm's output shape. Fixing the source to auto lets the rest of the app treat these suggestions consistently, badge them, and filter them, and the application layer can save them verbatim with the not-approved flag.

.. CG-EXPLANATION-END id=class:ContactCorrelationCandidate

Function ``def _dist``
----------------------

.. CG-BLOCK id=function:_dist lines=164-179

.. literalinclude:: ../../../src/groundmodel/domain/services/auto_correlate_contact_edges.py
   :language: python
   :lines: 164-179
   :lineno-match:

.. CG-EXPLANATION-START id=function:_dist

**What this does.** Returns the straight-line distance in metres between two investigation locations.

**Why it is here.** The algorithm repeatedly needs the horizontal separation of two columns, both to size the depth window and to build the neighbour graph. This is that single calculation in one named place.

.. CG-EXPLANATION-END id=function:_dist

Function ``def _relative_neighbourhood_adjacency``
--------------------------------------------------

.. CG-BLOCK id=function:_relative_neighbourhood_adjacency lines=180-234

.. literalinclude:: ../../../src/groundmodel/domain/services/auto_correlate_contact_edges.py
   :language: python
   :lines: 180-234
   :lineno-match:

.. CG-EXPLANATION-START id=function:_relative_neighbourhood_adjacency

**What this does.** Builds the set of column pairs that count as neighbours, using the relative-neighbourhood graph. Two columns A and B are neighbours only when no third column C sits closer to both of them than they are to each other. It considers only pairs within the maximum distance, but any column can act as a blocker.

**Why it is here.** The docstring explains this generalises the rule only correlate adjacent tests to a scatter of columns, so a suggestion never jumps over an intervening test and draws spaghetti (debt #163a). For tests strung along a line it reduces to consecutive neighbours. A graph here just means points joined by links; this function decides which links exist.

.. CG-EXPLANATION-END id=function:_relative_neighbourhood_adjacency

Function ``def auto_correlate_contact_edges``
---------------------------------------------

.. CG-BLOCK id=function:auto_correlate_contact_edges lines=235-361

.. literalinclude:: ../../../src/groundmodel/domain/services/auto_correlate_contact_edges.py
   :language: python
   :lines: 235-361
   :lineno-match:

.. CG-EXPLANATION-START id=function:auto_correlate_contact_edges

**What this does.** The public entry point. It builds the location lookup, chooses the neighbour set (the caller's along-section order, or the relative-neighbourhood graph as fallback), groups contacts by soil, and for each adjacent column pair within range pairs contacts whose depth difference fits the widening window. It keeps only the mutual best matches per pair and returns the canonical-ordered suggestions.

**Why it is here.** The docstring records two decisions the comments reinforce. Grouping by soil alone came from the 2026-05-29 dogfeed, where the stricter triple blocked genuine same-soil correlations. And the mutual-nearest-neighbour step runs per column pair, not model-wide, so a boundary can link to both of its neighbours along a chain instead of one pair stealing a shared endpoint. The section workflow supplies along-section adjacency because map-plane neighbours would render as crossing ribbons on the section.

.. CG-EXPLANATION-END id=function:auto_correlate_contact_edges

