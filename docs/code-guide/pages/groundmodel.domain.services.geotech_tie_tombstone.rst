groundmodel.domain.services.geotech_tie_tombstone
=================================================

.. CG-PAGE source=src/groundmodel/domain/services/geotech_tie_tombstone.py complete=true

*Source file:* ``src/groundmodel/domain/services/geotech_tie_tombstone.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-57

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_tie_tombstone.py
   :language: python
   :lines: 1-57
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Introduces a module that remembers a packing tie the
engineer deleted, keyed by WHERE it was rather than which rows it joined, and
sets a same-column tolerance. It imports ``Iterable`` (anything you can loop
over), ``dataclass`` and ``UUID``.

**Why it is here.** Owner ruling 2026-08-17: *"A tie i delete stays deleted but
does not delete on the litho model"*, keyed by *"position xyz left and xyz
right and the section it was on"*. Position, not the two band rows, because the
packing bands are rebuilt by pipeline steps 1 and 4 as new rows with new ids —
so a tombstone naming band ids stops matching the instant the model is
re-derived and the deleted tie quietly returns, the loop he met twice. The
place survives the rebuild: ``x``/``y`` come from the investigation's fixed map
position (so they pin the column exactly, since a test does not move) and only
``z``, the contact's elevation, needs a tolerance.

.. CG-EXPLANATION-END id=module-header

Class ``TiePoint``
------------------

.. CG-BLOCK id=class:TiePoint lines=58-76

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_tie_tombstone.py
   :language: python
   :lines: 58-76
   :lineno-match:

.. CG-EXPLANATION-START id=class:TiePoint

**What this does.** A frozen dataclass for one end of a tie expressed as a
place, not a row: map position ``x`` and ``y``, and elevation ``z``.

**Why it is here.** ``x`` and ``y`` identify the column, because a test does
not move between presses; ``z`` is stored as elevation rather than depth below
the collar so the key still means the same thing after a collar-level
correction.

.. CG-EXPLANATION-END id=class:TiePoint

Class ``TieTombstone``
----------------------

.. CG-BLOCK id=class:TieTombstone lines=77-96

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_tie_tombstone.py
   :language: python
   :lines: 77-96
   :lineno-match:

.. CG-EXPLANATION-START id=class:TieTombstone

**What this does.** A frozen dataclass for one deleted tie: the section id plus
its two ends as :class:`TiePoint` values, held in whichever order they were
stored.

**Why it is here.** Correlations are section-scoped — *"and the section it was
on"* — so the same two bands may legitimately be tied on one section and not
another, and a deletion on one section says nothing about the other. Matching
the two ends is deliberately order-independent.

.. CG-EXPLANATION-END id=class:TieTombstone

Function ``def _same_place``
----------------------------

.. CG-BLOCK id=function:_same_place lines=97-105

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_tie_tombstone.py
   :language: python
   :lines: 97-105
   :lineno-match:

.. CG-EXPLANATION-START id=function:_same_place

**What this does.** Returns whether two ends name the same contact on the same
column: ``x`` and ``y`` within the fixed same-column tolerance, and ``z``
within the vertical tolerance the caller passes in.

**Why it is here.** The map coordinates round-trip through the database
unchanged, so their tolerance only has to absorb representation noise; the
elevation needs a real tolerance because a re-derivation can settle a boundary
a few centimetres from where it was.

.. CG-EXPLANATION-END id=function:_same_place

Function ``def tie_is_tombstoned``
----------------------------------

.. CG-BLOCK id=function:tie_is_tombstoned lines=106-141

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_tie_tombstone.py
   :language: python
   :lines: 106-141
   :lineno-match:

.. CG-EXPLANATION-START id=function:tie_is_tombstoned

**What this does.** Returns whether the engineer already deleted the tie
between two given places on a given section, comparing against every recorded
deletion and matching the two ends either way round.

**Why it is here.** A tombstone stops the MACHINE from restating a tie; it
never stops the engineer from drawing one again, which is a fresh decision that
stands. The vertical tolerance handed in is half the model's minimum band
thickness — the widest value that can never confuse one tie with its neighbour,
since two boundaries on a column can never be closer than the minimum. An
untombstoned model derives exactly as it did before.

.. CG-EXPLANATION-END id=function:tie_is_tombstoned

