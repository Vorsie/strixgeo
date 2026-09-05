groundmodel.application.auto_correlate_contact_edges
====================================================

.. CG-PAGE source=src/groundmodel/application/auto_correlate_contact_edges.py complete=true

*Source file:* ``src/groundmodel/application/auto_correlate_contact_edges.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-54

.. literalinclude:: ../../../src/groundmodel/application/auto_correlate_contact_edges.py
   :language: python
   :lines: 1-54
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The opening docstring and imports for the use case that auto-correlates contacts. The docstring says it loads contacts, investigation locations and lithology context, calls the pure-domain auto-correlate algorithm, and saves the net-new edges as unapproved; the imports pull in the section-projection helper, the scope guard, the pure-domain auto-correlate algorithm and its constants, the pinch-out crossing detector, and the row types it reads and writes.

**Why it is here.** A correlation edge is a recorded statement that two contacts are the same boundary across two columns. The docstring records the key restraint: this use case saves edges with approval set to false, and does NOT run the resolver or lens detection, because auto edges are only suggestions until the engineer accepts them. This upholds the rule that the engine may propose ties but never adds an accepted tie on its own.

.. CG-EXPLANATION-END id=module-header

Class ``AutoCorrelateContactResult``
------------------------------------

.. CG-BLOCK id=class:AutoCorrelateContactResult lines=55-81

.. literalinclude:: ../../../src/groundmodel/application/auto_correlate_contact_edges.py
   :language: python
   :lines: 55-81
   :lineno-match:

.. CG-EXPLANATION-START id=class:AutoCorrelateContactResult

**What this does.** A dataclass reporting the batch outcome: how many net-new edges were created, how many candidates were skipped because an edge already existed, the crossing pinch-out lens candidates found, and how many candidate edges were dropped because they were part of a crossing.

**Why it is here.** The counts and the dropped crossings are surfaced so the caller can render the pinch-outs as lens ghosts and can tell the engineer that nothing was created because the edges already existed. A crossing is not a flat correlation — two ties that cross imply one unit pinches out between the columns — so both crossing edges are withheld and reported as a lens candidate instead of drawn as a steep diagonal.

.. CG-EXPLANATION-END id=class:AutoCorrelateContactResult

Class ``AutoCorrelateContactEdges`` — header
--------------------------------------------

.. CG-BLOCK id=class:AutoCorrelateContactEdges lines=82-96

.. literalinclude:: ../../../src/groundmodel/application/auto_correlate_contact_edges.py
   :language: python
   :lines: 82-96
   :lineno-match:

.. CG-EXPLANATION-START id=class:AutoCorrelateContactEdges

**What this does.** The use-case class header, inheriting the logger.

**Why it is here.** The docstring records that it is idempotent (existing edges of any source or approval state are skipped), that auto edges insert unapproved, and that the resolver and lens detector do not fire here — the Accept flow is their trigger. The caller owns the single commit.

.. CG-EXPLANATION-END id=class:AutoCorrelateContactEdges

Method ``AutoCorrelateContactEdges``. ``def __init__``
------------------------------------------------------

.. CG-BLOCK id=method:AutoCorrelateContactEdges.__init__ lines=97-101

.. literalinclude:: ../../../src/groundmodel/application/auto_correlate_contact_edges.py
   :language: python
   :lines: 97-101
   :lineno-match:

.. CG-EXPLANATION-START id=method:AutoCorrelateContactEdges.__init__

**What this does.** The setup step: stores the caller's database session.

**Why it is here.** The caller owns the session and the commit boundary; this use case commits once at the end.

.. CG-EXPLANATION-END id=method:AutoCorrelateContactEdges.__init__

Method ``AutoCorrelateContactEdges``. ``async def execute``
-----------------------------------------------------------

.. CG-BLOCK id=method:AutoCorrelateContactEdges.execute lines=102-370

.. literalinclude:: ../../../src/groundmodel/application/auto_correlate_contact_edges.py
   :language: python
   :lines: 102-370
   :lineno-match:

.. CG-EXPLANATION-START id=method:AutoCorrelateContactEdges.execute

**What this does.** The entry point. It requires a section, scope-guards the model and checks it is lithostratigraphic, loads every contact with its formation's soil code, builds per-column contact stacks and derives the soil below each contact, loads all project investigation locations, builds the along-section adjacency of consecutive columns, runs the pure-domain auto-correlate algorithm, detects crossings and drops those edges, then bulk-inserts the remaining flat candidates ignoring any that already exist, and commits.

**Why it is here.** Every gate has its recorded reason. A section is required (owner directive 2026-06-08) because the section both drives the left-to-right adjacency gate and is stamped on each edge; a missing section raises a value-error the router maps to 422. The litho-only check rejects a geological model, which has no litho soil structure to group by. Adjacency is the section's consecutive projected columns, not the map-plane nearest neighbours, because a map-adjacent pair can cross an intervening column and render as a spaghetti ribbon on the section (dogfeed 2026-05-29). Crossing edges are dropped and surfaced as pinch-outs (auto-lens: drop plus lens). The insert uses the database ignore-on-conflict against the named unique constraint, which is what makes a re-run idempotent — an existing triple is skipped, not duplicated — and each auto edge is written unapproved so the lens detector ignores it until the engineer accepts.

.. CG-EXPLANATION-END id=method:AutoCorrelateContactEdges.execute

Method ``AutoCorrelateContactEdges``. ``async def _section_along_adjacency``
----------------------------------------------------------------------------

.. CG-BLOCK id=method:AutoCorrelateContactEdges._section_along_adjacency lines=371-420

.. literalinclude:: ../../../src/groundmodel/application/auto_correlate_contact_edges.py
   :language: python
   :lines: 371-420
   :lineno-match:

.. CG-EXPLANATION-START id=method:AutoCorrelateContactEdges._section_along_adjacency

**What this does.** A private helper that projects every contact-bearing in-corridor investigation onto the section line, orders them by distance along the line, and returns the set of immediate-neighbour pairs.

**Why it is here.** This is the section editor's notion of adjacent — consecutive columns left-to-right — which the engineer expects correlations to follow, in contrast to the map-plane nearest-neighbour graph. Only investigations that actually have a contact in the model are projected, so a contactless column never splits two contact-bearing neighbours apart.

.. CG-EXPLANATION-END id=method:AutoCorrelateContactEdges._section_along_adjacency

