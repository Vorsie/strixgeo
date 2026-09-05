groundmodel.infrastructure.exporters.plaxis_exporter
====================================================

.. CG-PAGE source=src/groundmodel/infrastructure/exporters/plaxis_exporter.py complete=true

*Source file:* ``src/groundmodel/infrastructure/exporters/plaxis_exporter.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-72

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/plaxis_exporter.py
   :language: python
   :lines: 1-72
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The file's description and its toolbox. The description walks through the runnable Python script this exporter emits — connect to a running Plaxis 3D, start a fresh project, make one placeholder soil material per formation, make one global soil layer per formation top-down, make one borehole per investigation, and set each layer's absolute top level per borehole. The imports pull in the project snapshot types, the shared Plaxis script helpers, the project-exporter base class, and the mapping-table renderer.

**Why it is here.** Decided 2026-05-14: the target is Plaxis 2D/3D 2018 or newer, and the output is a self-contained ``.py`` script the engineer runs against their OWN Plaxis instance — so Strix needs no live Plaxis dependency when it builds or tests, and the script stays human-readable so an engineer can patch a line if their Plaxis version differs. It deliberately writes no parameter values (Phase 5) and no water table, and the export is not yet validated inside Plaxis — the beta testers do that (docs/exports.md). The four building blocks it shares with the 2D exporter live in ``plaxis_script_helpers`` so a Plaxis-API change is fixed in one place.

.. CG-EXPLANATION-END id=module-header

Class ``PlaxisExporter`` — header
---------------------------------

.. CG-BLOCK id=class:PlaxisExporter lines=73-75

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/plaxis_exporter.py
   :language: python
   :lines: 73-75
   :lineno-match:

.. CG-EXPLANATION-START id=class:PlaxisExporter

**What this does.** Declares the Plaxis 3D exporter as a concrete ``ProjectExporter``.

**Why it is here.** Subclassing the project base class ties it to the project-wide ``GroundModelSnapshot`` input — the whole model at once, which is what a 3D export needs.

.. CG-EXPLANATION-END id=class:PlaxisExporter

Method ``PlaxisExporter``. ``def __init__``
-------------------------------------------

.. CG-BLOCK id=method:PlaxisExporter.__init__ lines=76-79

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/plaxis_exporter.py
   :language: python
   :lines: 76-79
   :lineno-match:

.. CG-EXPLANATION-START id=method:PlaxisExporter.__init__

**What this does.** The set-up method; it only registers the logger under this module's name.

**Why it is here.** The exporter keeps no state between calls, so there is nothing else to set up — the project convention for a service class.

.. CG-EXPLANATION-END id=method:PlaxisExporter.__init__

Method ``PlaxisExporter``. ``def export``
-----------------------------------------

.. CG-BLOCK id=method:PlaxisExporter.export lines=80-166

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/plaxis_exporter.py
   :language: python
   :lines: 80-166
   :lineno-match:

.. CG-EXPLANATION-START id=method:PlaxisExporter.export

**What this does.** The main entry point and a map of the whole flow: log what was received; group the snapshot's layers into investigation columns by their (x, y) position; sort the formations top-down (youngest first); order the columns so the emitted script is stable across re-exports; then emit the docstring header, the connect block, and — unless the snapshot is empty — the materials, the global layers and one borehole block per column, closing with a printed summary. It logs any skipped columns and a success line and returns the script as UTF-8 bytes.

**Why it is here.** The top-down sort follows ``display_order`` (Strix stores oldest-first, so descending puts youngest on top, which is Plaxis layer 0). An empty snapshot emits a no-op script rather than nothing, and its warning names the project and which half (formations or columns) was empty, so a no-op export is attributable. A borehole dropped for having no surface elevation is raised as a WARNING, not left only as a script comment an operator who never opens the file would miss.

.. CG-EXPLANATION-END id=method:PlaxisExporter.export

Method ``PlaxisExporter``. ``def _emit_header``
-----------------------------------------------

.. CG-BLOCK id=method:PlaxisExporter._emit_header lines=167-218

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/plaxis_exporter.py
   :language: python
   :lines: 167-218
   :lineno-match:

.. CG-EXPLANATION-START id=method:PlaxisExporter._emit_header

**What this does.** Builds the script's opening docstring: a timestamp, the provenance fields (project, id, CRS, counts), the numbered how-to-run steps, the caveats (placeholder materials, stratigraphic order, NO water table, dropped no-Z columns, adjust-if-a-line-errors), and the unit mapping table.

**Why it is here.** The header is where the engineer learns what the script does and does not do — above all that no water table is set and the materials are only placeholders. The mapping table (debt #104) lets a downstream tool map each Plaxis material onto a material definition.

.. CG-EXPLANATION-END id=method:PlaxisExporter._emit_header

Method ``PlaxisExporter``. ``def _emit_boreholes``
--------------------------------------------------

.. CG-BLOCK id=method:PlaxisExporter._emit_boreholes lines=219-283

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/plaxis_exporter.py
   :language: python
   :lines: 219-283
   :lineno-match:

.. CG-EXPLANATION-START id=method:PlaxisExporter._emit_boreholes

**What this does.** For each column, reads its surface elevation (skipping and counting a column that has none), builds a formation-to-depth lookup, emits the ``g_i.borehole(x, y)`` line, and adds the per-layer level lines through the shared helper. Returns the lines plus the skipped count.

**Why it is here.** It deliberately does NOT set the borehole's ``Head``: in Plaxis that is the WATER head (phreatic level), not the top of the soil column, and writing the surface elevation into it made every exported model fully saturated (audit 2026-08-02). The column top is communicated by ``setsoillayerlevel`` instead. A skipped column leaves a comment in the script AND is counted so the caller can log it too.

.. CG-EXPLANATION-END id=method:PlaxisExporter._emit_boreholes

