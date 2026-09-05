groundmodel.domain.services.geotech_litho_parent_links
======================================================

.. CG-PAGE source=src/groundmodel/domain/services/geotech_litho_parent_links.py complete=true

*Source file:* ``src/groundmodel/domain/services/geotech_litho_parent_links.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-39

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_litho_parent_links.py
   :language: python
   :lines: 1-39
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Introduces the file and imports its tools: ``Iterable`` (the
type for "a sequence you can loop over once"), the ``dataclass`` decorator (a
shorthand for a plain holder of named values), and ``UUID`` (the long unique
identifier every row carries). The file works out, for a finished geotech model,
which litho band covers each geotech packing band, and which litho body each
connected geotech body belongs under.

**Why it is here.** A geotech packing band is a subdivision of a lithological
band, so it should remember which litho band it sits inside and which litho body
that band belongs to. The docstring records the owner's ruling that this link must
be (re)derived at the geotech Build — the last whole-model operation — not at
Divide-boreholes time, because Divide runs before the engineer's final edits. It
states two rules, one per level: a geotech band's covering litho band is the
accepted litho band on the SAME investigation whose depth interval contains the
band's vertical midpoint; a geotech body's litho parent body is taken from the
shallowest member band that has a covering litho band. These functions are the
pure, testable statement of rules the Build also runs as database SQL and the
resolver runs in Python — three forms that must agree, so keeping one of them free
of any database or session lets it be unit-tested on its own.

.. CG-EXPLANATION-END id=module-header

Class ``LithoBandInterval``
---------------------------

.. CG-BLOCK id=class:LithoBandInterval lines=40-65

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_litho_parent_links.py
   :language: python
   :lines: 40-65
   :lineno-match:

.. CG-EXPLANATION-START id=class:LithoBandInterval

**What this does.** Defines a read-only record for one accepted litho band: its
own identifier, which investigation it sits on (a CPT anchor or a borehole anchor,
one of the two filled and the other empty), and its depth interval from top to
base.

**Why it is here.** The covering-band search needs exactly these facts about each
candidate litho band: which column it is on, so it can ignore bands on other
columns, and where it starts and ends, so it can test whether it contains the
geotech band's midpoint. The interval is treated as half-open — it includes the
top but stops just short of the base — so two touching bands never both claim a
point that lands exactly on their shared boundary.

.. CG-EXPLANATION-END id=class:LithoBandInterval

Function ``def covering_litho_band_id``
---------------------------------------

.. CG-BLOCK id=function:covering_litho_band_id lines=66-113

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_litho_parent_links.py
   :language: python
   :lines: 66-113
   :lineno-match:

.. CG-EXPLANATION-START id=function:covering_litho_band_id

**What this does.** Takes a geotech band's depth interval and its column anchor,
computes the band's midpoint depth, and walks the candidate litho bands. It
returns the identifier of the first litho band on the SAME column whose interval
contains that midpoint, or nothing when none does.

**Why it is here.** This is the band-level rule from the docstring turned into
code — the same midpoint rule the ``c9d0e1f2a3b4`` migration used to backfill the
link and the Build re-derives. Because litho bands on one column are contiguous
and non-overlapping, at most one can contain the midpoint, so the first match is
the answer and the search can stop there. It skips bands on other columns with a
same-anchor test, so it can be handed the whole model's litho bands without
pre-filtering. Returning nothing is the honest "no litho band covers this" state —
a true orphan — never a guessed parent.

.. CG-EXPLANATION-END id=function:covering_litho_band_id

Class ``GeotechBodyMember``
---------------------------

.. CG-BLOCK id=class:GeotechBodyMember lines=114-139

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_litho_parent_links.py
   :language: python
   :lines: 114-139
   :lineno-match:

.. CG-EXPLANATION-START id=class:GeotechBodyMember

**What this does.** Defines a read-only record for one member band of a geotech
body: its own identifier, its top depth, whether it has a covering litho band at
all, and the litho body that covering band belongs to (which may be empty).

**Why it is here.** The body-level rule needs to pick the shallowest member that
is covered, so it needs each member's top depth and a flag saying whether it is
covered. The band identifier is kept as the tie-break when two members start at
the same depth, matching the ordering the database SQL uses. The covering litho
body is allowed to be empty for two distinct reasons the docstring spells out:
the member has no covering band, or the covering litho band has not itself been
resolved into a body yet.

.. CG-EXPLANATION-END id=class:GeotechBodyMember

Function ``def geotech_body_litho_parent_id``
---------------------------------------------

.. CG-BLOCK id=function:geotech_body_litho_parent_id lines=140-165

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_litho_parent_links.py
   :language: python
   :lines: 140-165
   :lineno-match:

.. CG-EXPLANATION-START id=function:geotech_body_litho_parent_id

**What this does.** Keeps only the body's members that have a covering litho band,
returns nothing if none do, otherwise sorts the covered members by top depth
(shallowest first, ties broken on identifier) and returns the shallowest one's
covering litho body.

**Why it is here.** This is the body-level rule, mirroring the resolver's step
that stamps a geotech body's litho parent. The shallowest covered member wins
outright: the code never skips down to a deeper member just because the shallowest
one's covering litho band has no body yet, so the answer it returns may itself be
empty. That deliberate honesty keeps the pure function, the resolver's Python
form, and the Build's SQL form all agreeing on the same parent.

.. CG-EXPLANATION-END id=function:geotech_body_litho_parent_id

