groundmodel.infrastructure.exporters.plaxis_section_exporter
============================================================

.. CG-PAGE source=src/groundmodel/infrastructure/exporters/plaxis_section_exporter.py complete=true

*Source file:* ``src/groundmodel/infrastructure/exporters/plaxis_section_exporter.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-79

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/plaxis_section_exporter.py
   :language: python
   :lines: 1-79
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The file's description of the Plaxis 2D per-section exporter — the section-scoped sibling of the 3D exporter — and the script it emits, then its imports: the section-snapshot types, the shared Plaxis helpers, the section-exporter base class, and the mapping-table renderer.

**Why it is here.** Where the 3D exporter places one borehole per investigation at its (x, y), this one consumes a ``SectionSnapshot`` (investigations already projected onto the section line) and places one borehole per column at its along-section distance, because a Plaxis 2D borehole takes a single coordinate (debt #29). It keeps the same characterisation-only stance — no parameters, no water table, no round-trip validation against a real Plaxis (the beta testers do that; docs/exports.md). Columns with no surface elevation are dropped and counted, and the shared building blocks live in ``plaxis_script_helpers``.

.. CG-EXPLANATION-END id=module-header

Class ``PlaxisSectionExporter`` — header
----------------------------------------

.. CG-BLOCK id=class:PlaxisSectionExporter lines=80-82

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/plaxis_section_exporter.py
   :language: python
   :lines: 80-82
   :lineno-match:

.. CG-EXPLANATION-START id=class:PlaxisSectionExporter

**What this does.** Declares the Plaxis 2D exporter as a concrete ``SectionExporter``.

**Why it is here.** Subclassing the section base class ties it to the one-section ``SectionSnapshot`` input — the section view's own projected geometry.

.. CG-EXPLANATION-END id=class:PlaxisSectionExporter

Method ``PlaxisSectionExporter``. ``def __init__``
--------------------------------------------------

.. CG-BLOCK id=method:PlaxisSectionExporter.__init__ lines=83-86

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/plaxis_section_exporter.py
   :language: python
   :lines: 83-86
   :lineno-match:

.. CG-EXPLANATION-START id=method:PlaxisSectionExporter.__init__

**What this does.** The set-up method; it only registers the module-named logger.

**Why it is here.** The exporter keeps no state between calls, so the logger is all there is to set up.

.. CG-EXPLANATION-END id=method:PlaxisSectionExporter.__init__

Method ``PlaxisSectionExporter``. ``def export``
------------------------------------------------

.. CG-BLOCK id=method:PlaxisSectionExporter.export lines=87-181

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/plaxis_section_exporter.py
   :language: python
   :lines: 87-181
   :lineno-match:

.. CG-EXPLANATION-START id=method:PlaxisSectionExporter.export

**What this does.** The entry point and the whole flow: log the inputs; sort the formations top-down; build a depth lookup keyed by (investigation, formation), recomputing each level from the column's own surface so the column shares one datum; keep only the investigations that have a surface elevation (sorted left-to-right along the section) and count the rest; emit the header, the connect block and — unless empty — the materials, global layers and one borehole per column, with a printed summary; log identifier coverage and a success line; return UTF-8 bytes.

**Why it is here.** Without a surface Z a Plaxis borehole cannot be placed on the level axis (every level is absolute), so such columns are dropped — the same rule as the 3D exporter — and counted for the summary. The identifier-coverage log (how many materials are NAD-named, how many soil-tagged) makes ``my geotech script has no NAD material names`` diagnosable from the log alone: a zero means the units were never classified, not that the exporter dropped them.

.. CG-EXPLANATION-END id=method:PlaxisSectionExporter.export

Method ``PlaxisSectionExporter``. ``def _emit_header``
------------------------------------------------------

.. CG-BLOCK id=method:PlaxisSectionExporter._emit_header lines=182-246

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/plaxis_section_exporter.py
   :language: python
   :lines: 182-246
   :lineno-match:

.. CG-EXPLANATION-START id=method:PlaxisSectionExporter._emit_header

**What this does.** Builds the docstring header — a timestamp, the provenance fields (project, section, length, CRS, datum, counts), the numbered how-to-run steps and the caveats, adding a note about any dropped no-Z columns — plus the unit mapping table.

**Why it is here.** The header states that the X axis is along-section distance, that the materials are placeholders, and that NO water table is set (the same audit-2026-08-02 caveat as the 3D exporter). The mapping table lets the engineer map each material onto a material definition.

.. CG-EXPLANATION-END id=method:PlaxisSectionExporter._emit_header

Method ``PlaxisSectionExporter``. ``def _emit_boreholes``
---------------------------------------------------------

.. CG-BLOCK id=method:PlaxisSectionExporter._emit_boreholes lines=247-314

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/plaxis_section_exporter.py
   :language: python
   :lines: 247-314
   :lineno-match:

.. CG-EXPLANATION-START id=method:PlaxisSectionExporter._emit_boreholes

**What this does.** For each exportable column, computes the column bottom (the recorded total depth, else the deepest contact, else the surface) and emits a ``g_i.borehole(x)`` line at the along-section distance plus the per-layer level lines through the shared helper.

**Why it is here.** It deliberately does not set ``Head`` (the water level, not the column top — audit 2026-08-02), and the investigation name in the comment is user text, so it is sanitised. The column bottom feeds the shared inherit cascade for any formation absent at this column.

.. CG-EXPLANATION-END id=method:PlaxisSectionExporter._emit_boreholes

