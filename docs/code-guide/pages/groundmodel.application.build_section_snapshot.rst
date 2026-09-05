groundmodel.application.build_section_snapshot
==============================================

.. CG-PAGE source=src/groundmodel/application/build_section_snapshot.py complete=true

*Source file:* ``src/groundmodel/application/build_section_snapshot.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-54

.. literalinclude:: ../../../src/groundmodel/application/build_section_snapshot.py
   :language: python
   :lines: 1-54
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the section snapshot builder. It imports the section snapshot value objects, the vertical-datum label helper, the borehole/CPT/section/geology/project repositories, the section-projection geometry helpers, the parse-error exception and the logger.

**Why it is here.** The docstring records the job and the layer rule: it loads the section and the active model's formations and contacts, projects every investigation onto the section line, applies the buffer filter and the section's exclusion list, and assembles the value object the section exporters consume — living in the application layer so the infrastructure-layer exporter never touches the database (CLAUDE.md Architecture).

.. CG-EXPLANATION-END id=module-header

Class ``BuildSectionSnapshot`` — header
---------------------------------------

.. CG-BLOCK id=class:BuildSectionSnapshot lines=55-57

.. literalinclude:: ../../../src/groundmodel/application/build_section_snapshot.py
   :language: python
   :lines: 55-57
   :lineno-match:

.. CG-EXPLANATION-START id=class:BuildSectionSnapshot

**What this does.** Declares the use-case class that materialises the data needed to render or export one cross-section.

**Why it is here.** Why: recorded in the class + module docstrings — the single place a section's export geometry is assembled.

.. CG-EXPLANATION-END id=class:BuildSectionSnapshot

Method ``BuildSectionSnapshot``. ``def __init__``
-------------------------------------------------

.. CG-BLOCK id=method:BuildSectionSnapshot.__init__ lines=58-62

.. literalinclude:: ../../../src/groundmodel/application/build_section_snapshot.py
   :language: python
   :lines: 58-62
   :lineno-match:

.. CG-EXPLANATION-START id=method:BuildSectionSnapshot.__init__

**What this does.** Stores the active session and names the logger.

**Why it is here.** Caller owns the session; this use case only reads.

.. CG-EXPLANATION-END id=method:BuildSectionSnapshot.__init__

Method ``BuildSectionSnapshot``. ``async def execute``
------------------------------------------------------

.. CG-BLOCK id=method:BuildSectionSnapshot.execute lines=63-293

.. literalinclude:: ../../../src/groundmodel/application/build_section_snapshot.py
   :language: python
   :lines: 63-293
   :lineno-match:

.. CG-EXPLANATION-START id=method:BuildSectionSnapshot.execute

**What this does.** Builds the section snapshot. It loads and scope-checks the section, project and model, rejects a zero-length section, projects each non-excluded CPT and borehole onto the section line keeping those within the buffer, sorts them by along-distance, keeps only the contacts whose anchor projected, computes each contact's absolute level from its anchor's surface elevation, collects the formations actually used, picks the vertical datum label, and returns the assembled snapshot with the section endpoints.

**Why it is here.** The in-corridor filter is the only render gate: classification follows the test (owner directive 2026-06-08), so a section shows the contacts of every investigation that projects into its corridor, with no per-section seeded gate — a test classified once appears on every section through it. A contact whose anchor did not project resolves to nothing and is silently skipped, which makes stale anchors tolerable. The identifier-coverage counts on the success line exist because a geotech snapshot reporting zero NAD classes means the units were never classified, not that the exporter dropped them (debt #104).

.. CG-EXPLANATION-END id=method:BuildSectionSnapshot.execute

