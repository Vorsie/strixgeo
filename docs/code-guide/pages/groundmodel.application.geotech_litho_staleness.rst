groundmodel.application.geotech_litho_staleness
===============================================

.. CG-PAGE source=src/groundmodel/application/geotech_litho_staleness.py complete=true

*Source file:* ``src/groundmodel/application/geotech_litho_staleness.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-47

.. literalinclude:: ../../../src/groundmodel/application/geotech_litho_staleness.py
   :language: python
   :lines: 1-47
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens a use case that answers "did the lithology move under
these packing bands?" It recomputes, per column, a short digest of today's litho
stack and names the columns whose recorded digest no longer matches.

**Why it is here.** A "use case" (also called an application service) is one class
for one unit of work, listing the steps in order; this is the read half of debt
#266. Each geotech press stamps, per column, a digest — a compact fingerprint — of
the litho stack it built that column's bands from, and this use case compares that
stamp against the litho as it stands now. The docstring records the design:
staleness is DERIVED, never stored (the same compare-on-load pattern the
qc-statistic column uses), so there is nothing to clear — re-pressing a column
re-stamps it and the warning goes away — and no false alarm on old projects (a
column with no stamp is reported separately as *unstamped*, not stale). It also
serves a later export-completeness guard, which reads this application-layer use
case directly (only a session and a model id, no request context) and gates on two
numbers: how many columns are provably stale, and how many are unstamped. What the
guard DOES about them is deliberately not decided here.

.. CG-EXPLANATION-END id=module-header

Class ``StaleGeotechColumn``
----------------------------

.. CG-BLOCK id=class:StaleGeotechColumn lines=48-65

.. literalinclude:: ../../../src/groundmodel/application/geotech_litho_staleness.py
   :language: python
   :lines: 48-65
   :lineno-match:

.. CG-EXPLANATION-START id=class:StaleGeotechColumn

**What this does.** A frozen dataclass naming one stale column: the CPT or borehole
id its bands are anchored on, and that column's display label.

**Why it is here.** The label is carried so a message can name the column the
engineer must re-press ("GEO-23/125-S17") rather than a bare id, falling back to
the id when the row cannot be resolved.

.. CG-EXPLANATION-END id=class:StaleGeotechColumn

Class ``GeotechLithoStalenessResult``
-------------------------------------

.. CG-BLOCK id=class:GeotechLithoStalenessResult lines=66-93

.. literalinclude:: ../../../src/groundmodel/application/geotech_litho_staleness.py
   :language: python
   :lines: 66-93
   :lineno-match:

.. CG-EXPLANATION-START id=class:GeotechLithoStalenessResult

**What this does.** A frozen dataclass holding the whole answer: the model asked
about, its parent litho model (or none), the stale columns sorted by label, how
many columns carry a band, and how many of those are unstamped.

**Why it is here.** It separates "provably stale" from "cannot say": the stale
list is columns whose recorded litho disagrees with the litho now, while the
unstamped count is columns banded before the stamp shipped, which read as not stale
but unknown. Sorting by label makes two reads present the same list. The parent
model is ``None`` only for a malformed model with no parent, in which case there is
nothing to compare against.

.. CG-EXPLANATION-END id=class:GeotechLithoStalenessResult

Class ``GeotechLithoStaleness`` — header
----------------------------------------

.. CG-BLOCK id=class:GeotechLithoStaleness lines=94-103

.. literalinclude:: ../../../src/groundmodel/application/geotech_litho_staleness.py
   :language: python
   :lines: 94-103
   :lineno-match:

.. CG-EXPLANATION-START id=class:GeotechLithoStaleness

**What this does.** The use-case class header. It inherits the shared logger and is
documented as read-only.

**Why it is here.** It writes nothing and never commits, so it is safe to call from
a request handler or an exporter — the docstring says exactly that. Inheriting
``GroundModelLogger`` is the project convention for any class with real logic, so
its log lines carry the module name.

.. CG-EXPLANATION-END id=class:GeotechLithoStaleness

Method ``GeotechLithoStaleness``. ``def __init__``
--------------------------------------------------

.. CG-BLOCK id=method:GeotechLithoStaleness.__init__ lines=104-109

.. literalinclude:: ../../../src/groundmodel/application/geotech_litho_staleness.py
   :language: python
   :lines: 104-109
   :lineno-match:

.. CG-EXPLANATION-START id=method:GeotechLithoStaleness.__init__

**What this does.** Stores the session and builds the litho-layer repository it
will read through.

**Why it is here.** A "repository" is the object that turns database rows into
Python objects for one table family, keeping the SQL out of the use case. Passing
the session in — rather than opening one — is what keeps the use case read-only and
callable inside someone else's transaction.

.. CG-EXPLANATION-END id=method:GeotechLithoStaleness.__init__

Method ``GeotechLithoStaleness``. ``async def execute``
-------------------------------------------------------

.. CG-BLOCK id=method:GeotechLithoStaleness.execute lines=110-204

.. literalinclude:: ../../../src/groundmodel/application/geotech_litho_staleness.py
   :language: python
   :lines: 110-204
   :lineno-match:

.. CG-EXPLANATION-START id=method:GeotechLithoStaleness.execute

**What this does.** The one public step. It loads the model (raising if the id
matches nothing), gets the columns that carry bands and their stored digests, and —
when the model has a parent — recomputes the parent's digests, keeps only the
stamps for columns that still carry bands, asks the pure domain function which
columns are stale, names them, and returns the result with its counts. Along the
way it logs stale columns at WARNING and unstamped ones at INFO.

**Why it is here.** A model with no parent is *answered*, not raised on: the
comment explains ``parent_model_id`` is nullable in the schema, so an exception
here would break the section view over a shape the database tolerates — instead
every banded column is reported as unstamped. Stamps for bands that are gone are
dropped before the comparison, because a leftover stamp would point at a re-press
with nothing to do. The stale check itself is a pure domain function, keeping the
judgement testable on paper.

.. CG-EXPLANATION-END id=method:GeotechLithoStaleness.execute

