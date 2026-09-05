groundmodel.application.geotech_tie_status
==========================================

.. CG-PAGE source=src/groundmodel/application/geotech_tie_status.py complete=true

*Source file:* ``src/groundmodel/application/geotech_tie_status.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-30

.. literalinclude:: ../../../src/groundmodel/application/geotech_tie_status.py
   :language: python
   :lines: 1-30
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens a module that answers one question — how much
packing-correlation work is still waiting for the engineer — by counting a geotech
model's ties by their approval state.

**Why it is here.** The docstring lays out the four-step geotech pipeline (owner
ruling 2026-08-04): subdivide CPTs into bands, auto-correlate (which only
PROPOSES ties), accept (per tie or all of them), then divide boreholes (allowed
only once the accepting is done). Two callers need the same counts — the
tie-status endpoint (one address the desktop window can call), so a button can say
why it is disabled, and the divide gate, so pressing it early fails with the
pending count instead of dividing on half-reviewed evidence. The counting is one
grouped query — a single query that tallies the rows by category inside the
database rather than fetching them all and counting in Python — cheap enough to
ask after every accept.

.. CG-EXPLANATION-END id=module-header

Class ``GeotechTieStatus``
--------------------------

.. CG-BLOCK id=class:GeotechTieStatus lines=31-63

.. literalinclude:: ../../../src/groundmodel/application/geotech_tie_status.py
   :language: python
   :lines: 31-63
   :lineno-match:

.. CG-EXPLANATION-START id=class:GeotechTieStatus

**What this does.** A ``dataclass`` — a small object whose only job is to hold
named values together — carrying four numbers: how many ties are pending
(proposed, not yet accepted), how many are accepted, how many accepted ties carry
a review flag (a note that says an accepted tie needs a second look), and a
per-section breakdown of the pending ones.

**Why it is here.** ``frozen=True`` makes it read-only once built, so a count
cannot be changed by accident after it is measured. The per-section breakdown was
added for the section-scoped pipeline (owner 2026-08-15): the auto-correlate and
accept steps act on the open section, but divide-boreholes stays model-wide, so
the toolbar must be able to say WHICH other sections are still holding the divide
shut, and to report the section the engineer is standing on rather than a
model-wide total he cannot act on from there. Flagged ties are a subset of the
accepted ties and gate nothing — the count exists only so the interface can nudge.

.. CG-EXPLANATION-END id=class:GeotechTieStatus

Function ``async def load_geotech_tie_status``
----------------------------------------------

.. CG-BLOCK id=function:load_geotech_tie_status lines=64-119

.. literalinclude:: ../../../src/groundmodel/application/geotech_tie_status.py
   :language: python
   :lines: 64-119
   :lineno-match:

.. CG-EXPLANATION-START id=function:load_geotech_tie_status

**What this does.** Runs one grouped query that tallies the model's ties by
approval, by whether they carry a review reason, and by section, then adds the
section rows back up into the three model totals while keeping the per-section
pending breakdown. Returns all four numbers; everything is zero and the breakdown
empty for a model with no ties, which is the state right after subdividing.

**Why it is here.** Putting the section in the GROUP BY means the per-section
breakdown costs no second query — the totals are summed out of the same rows, as
the comment states. It is ``async`` so the query can be awaited without blocking
other work.

.. CG-EXPLANATION-END id=function:load_geotech_tie_status

