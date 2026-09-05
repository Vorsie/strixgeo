groundmodel.domain.services.geotech_edge_dedup
==============================================

.. CG-PAGE source=src/groundmodel/domain/services/geotech_edge_dedup.py complete=true

*Source file:* ``src/groundmodel/domain/services/geotech_edge_dedup.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-24

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_edge_dedup.py
   :language: python
   :lines: 1-24
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Introduces the module and its one job: remove duplicate
packing correlations so each tie is stored once. It imports ``dataclass`` (a
helper that turns a class into a plain data holder) and ``UUID`` (a
universally-unique id, the long random label every database row carries), and
lists the two public names it exports.

**Why it is here.** A single subdivide reaches the same correlation twice —
``geotech_tie_reanchor`` carries it across the band rebuild while the
derivation re-emits it from the litho model — and because the two writers store
the two endpoints in whatever order they happen to hold, a reversed pair slips
past each writer's own check and the row lands twice. The owner met this as
flagged ties he had to delete by hand after every press (2026-08-16): two lines
saying the same thing, one of them nagging.

.. CG-EXPLANATION-END id=module-header

Class ``GeotechEdgeRow``
------------------------

.. CG-BLOCK id=class:GeotechEdgeRow lines=25-69

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_edge_dedup.py
   :language: python
   :lines: 25-69
   :lineno-match:

.. CG-EXPLANATION-START id=class:GeotechEdgeRow

**What this does.** A frozen dataclass (a small read-only bundle of named
values) describing one stored packing correlation exactly as the dedup pass
needs it: the row id, the section it was drawn on, the two band ids in stored
order, which surface (``top`` or ``base``) of each band the tie names, whether
it is manual or auto, any review flag, the two bands' top depths, and whether
it is a derived hop.

**Why it is here.** ``@dataclass(frozen=True)`` gives a data holder that cannot
be changed after it is made. The docstring is blunt that the stored order of
the two ends is the very thing that cannot be relied upon, which is why the
identity helper below re-sorts them. Sides are carried because a top-to-top tie
and a base-to-base tie between the same two bands are different statements, not
duplicates.

.. CG-EXPLANATION-END id=class:GeotechEdgeRow

Function ``def _identity``
--------------------------

.. CG-BLOCK id=function:_identity lines=70-78

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_edge_dedup.py
   :language: python
   :lines: 70-78
   :lineno-match:

.. CG-EXPLANATION-START id=function:_identity

**What this does.** Returns what makes two rows the same statement regardless
of stored order: the section together with the two (band id, side) ends sorted
into a fixed order.

**Why it is here.** Because the two writers can store the ends in either order,
a duplicate can arrive reversed. Sorting the two ends by band id then side
produces one canonical key, so a forward copy and its reversed twin fall into
the same bucket and one of them can be dropped.

.. CG-EXPLANATION-END id=function:_identity

Function ``def _rank``
----------------------

.. CG-BLOCK id=function:_rank lines=79-95

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_edge_dedup.py
   :language: python
   :lines: 79-95
   :lineno-match:

.. CG-EXPLANATION-START id=function:_rank

**What this does.** A sort key for choosing which of several identical rows
survives, where a lower value wins: manual before auto, then unflagged before
flagged, then by row id.

**Why it is here.** Provenance comes first — a hand-drawn tie must still read
``manual`` after a divide, flagged or not, because the flag is a question for
the engineer and never a reason to throw away his line. Between two machine
copies the unflagged one wins, since it is the freshly derived statement while
the flag on the other belongs to a band generation that no longer exists. The
id breaks a genuine stalemate so that repeating a divide gives the same result.

.. CG-EXPLANATION-END id=function:_rank

Function ``def duplicate_edge_ids_to_drop``
-------------------------------------------

.. CG-BLOCK id=function:duplicate_edge_ids_to_drop lines=96-118

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_edge_dedup.py
   :language: python
   :lines: 96-118
   :lineno-match:

.. CG-EXPLANATION-START id=function:duplicate_edge_ids_to_drop

**What this does.** Walks every packing correlation, keeps the best-ranked
survivor for each identity in a dictionary keyed by that identity, and returns
the ids of every row that is not a survivor, in the order they were given.

**Why it is here.** This is the module's whole public purpose: decide which
rows to delete so each correlation is stored exactly once. The ordinary case is
no duplicates at all, which returns an empty list and leaves the model
untouched.

.. CG-EXPLANATION-END id=function:duplicate_edge_ids_to_drop

