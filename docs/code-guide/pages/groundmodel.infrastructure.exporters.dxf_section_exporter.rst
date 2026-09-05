groundmodel.infrastructure.exporters.dxf_section_exporter
=========================================================

.. CG-PAGE source=src/groundmodel/infrastructure/exporters/dxf_section_exporter.py complete=true

*Source file:* ``src/groundmodel/infrastructure/exporters/dxf_section_exporter.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-123

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/dxf_section_exporter.py
   :language: python
   :lines: 1-123
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The file's long description of the section DXF export — its coordinate system (model space, metres, X = along-section distance, Y = absolute level in the section's datum), what the DXF carries (one polyline per formation top surface, one vertical line plus name label per investigation column, a title block, a unit mapping table) and what it does not carry yet — followed by the deferred ezdxf import, the section-snapshot types, the DXF styling and line-break helpers, the section-exporter base class, the identifier pieces, and the module constants naming the investigations layer, the formation-layer prefix and the 255-character cap.

**Why it is here.** A cross-section drawn in the editor exports to a 2-D DXF an engineer drops straight into AutoCAD / Plaxis 2D / D-Sheet / GeoStudio — the integration point between Strix (which builds and edits the model) and every downstream tool (which runs the actual EC7 calculations). A *polyline* is a connected chain of straight segments, so each formation top surface becomes one polyline. A NAD-classified unit leads its layer name with the machine identifier (debt #104) so one CAD wildcard selects a whole class; unclassified units keep their name byte-identical and carry their identifiers in the layer description and the mapping table. ezdxf (the DXF-writing library) is imported lazily so pulling this exporter in at API boot does not pay its load cost (docs/exports.md).

.. CG-EXPLANATION-END id=module-header

Class ``DxfSectionExporter`` — header
-------------------------------------

.. CG-BLOCK id=class:DxfSectionExporter lines=124-126

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/dxf_section_exporter.py
   :language: python
   :lines: 124-126
   :lineno-match:

.. CG-EXPLANATION-START id=class:DxfSectionExporter

**What this does.** Declares the section DXF exporter as a concrete ``SectionExporter``.

**Why it is here.** Subclassing the section base class ties it to the ``SectionSnapshot`` input — one cross-section's assembled geometry.

.. CG-EXPLANATION-END id=class:DxfSectionExporter

Method ``DxfSectionExporter``. ``def __init__``
-----------------------------------------------

.. CG-BLOCK id=method:DxfSectionExporter.__init__ lines=127-130

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/dxf_section_exporter.py
   :language: python
   :lines: 127-130
   :lineno-match:

.. CG-EXPLANATION-START id=method:DxfSectionExporter.__init__

**What this does.** The set-up method; it only registers the module-named logger.

**Why it is here.** The exporter keeps no state between calls, so the logger is all there is to set up.

.. CG-EXPLANATION-END id=method:DxfSectionExporter.__init__

Method ``DxfSectionExporter``. ``def export``
---------------------------------------------

.. CG-BLOCK id=method:DxfSectionExporter.export lines=131-210

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/dxf_section_exporter.py
   :language: python
   :lines: 131-210
   :lineno-match:

.. CG-EXPLANATION-START id=method:DxfSectionExporter.export

**What this does.** The entry point that builds the DXF and returns the bytes. It creates a fresh R2018 drawing, stamps the project name into the header, registers the layers, draws the investigation columns, draws the formation surfaces (counting contacts dropped for having no level or no resolvable formation), draws the title block, writes the drawing to text and encodes it UTF-8, then logs — a WARNING only for the anomalous no-formation drops, plus a success line carrying identifier coverage — and returns.

**Why it is here.** The two drop reasons are different severities: a no-level contact is a designed-for condition (not every import carries a surface Z) and stays on the success tally so the warning does not cry wolf, while a no-formation contact means a formation vanished between snapshot assembly and export, which is genuinely anomalous, so it gets a WARNING. The identifier-coverage counts (how many formations are NAD-named, how many soil-tagged) make ``my geotech DXF has no NAD layer names`` diagnosable from the log alone.

.. CG-EXPLANATION-END id=method:DxfSectionExporter.export

Method ``DxfSectionExporter``. ``def _setup_layers``
----------------------------------------------------

.. CG-BLOCK id=method:DxfSectionExporter._setup_layers lines=211-299

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/dxf_section_exporter.py
   :language: python
   :lines: 211-299
   :lineno-match:

.. CG-EXPLANATION-START id=method:DxfSectionExporter._setup_layers

**What this does.** Registers the DXF layers up front — one ``Investigations`` layer plus one per formation, named ``GeoModel-<name>`` (or ``GeoModel-<identifier> - <name>`` for a classified unit), each given the formation's true colour, a matching index colour and thin weight, and a description carrying the code and the NAD class / soil code. A second formation wanting the same layer name is given a disambiguated name and a loud warning. Returns a formation-id-to-layer-name map.

**Why it is here.** Two formations can legitimately want the same layer name — duplicate names are an expected state (the seed-from-stratigraphy flow leaves them), DXF layer keys are compared case-folded, and stripping forbidden characters can collapse two names onto one — and ezdxf raises on a repeat, which used to escape as an unexplained HTTP 500. Disambiguating instead keeps each formation a surface of its own, and the warning is loud because the duplicate is in the engineer's model, not an exporter quirk. The map is what lets the drawing pass group by id, not name, so two same-named formations stay on two separate layers.

.. CG-EXPLANATION-END id=method:DxfSectionExporter._setup_layers

Method ``DxfSectionExporter``. ``def _draw_investigation_columns``
------------------------------------------------------------------

.. CG-BLOCK id=method:DxfSectionExporter._draw_investigation_columns lines=300-333

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/dxf_section_exporter.py
   :language: python
   :lines: 300-333
   :lineno-match:

.. CG-EXPLANATION-START id=method:DxfSectionExporter._draw_investigation_columns

**What this does.** For each projected column, draws a vertical line from the surface elevation down to surface minus total depth, plus a small text label of the investigation name just above the top, all on the single ``Investigations`` layer.

**Why it is here.** A column with no surface elevation is anchored at level 0, and the title block notes that those columns sit at indicative position. One shared layer lets the engineer show or hide all columns at once in CAD.

.. CG-EXPLANATION-END id=method:DxfSectionExporter._draw_investigation_columns

Method ``DxfSectionExporter``. ``def _draw_formation_surfaces``
---------------------------------------------------------------

.. CG-BLOCK id=method:DxfSectionExporter._draw_formation_surfaces lines=334-411

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/dxf_section_exporter.py
   :language: python
   :lines: 334-411
   :lineno-match:

.. CG-EXPLANATION-START id=method:DxfSectionExporter._draw_formation_surfaces

**What this does.** For each formation with contacts on the section, draws one polyline through its (along-distance, level) points sorted by distance — or a small circle marker when a formation has only a single point — while skipping and counting contacts that have no absolute level or no resolvable formation. Returns the two drop counts.

**Why it is here.** A contact with no surface Z cannot sit on the absolute-level axis, so it is skipped. Grouping on the formation id, not the name, keeps two same-named formations as two separate surfaces instead of welding their contacts into one zig-zag polyline. A single point is drawn as a circle because AutoCAD does not render a zero-length polyline visibly.

.. CG-EXPLANATION-END id=method:DxfSectionExporter._draw_formation_surfaces

Method ``DxfSectionExporter``. ``def _draw_title_block``
--------------------------------------------------------

.. CG-BLOCK id=method:DxfSectionExporter._draw_title_block lines=412-496

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/dxf_section_exporter.py
   :language: python
   :lines: 412-496
   :lineno-match:

.. CG-EXPLANATION-START id=method:DxfSectionExporter._draw_title_block

**What this does.** Draws a small text block at the bottom-left with the project and section identity (name, length, CRS, datum), a note about any no-Z columns, and — when any unit carries an identifier — the unit mapping table beneath it, positioned clear below the drawn data.

**Why it is here.** It uses plain TEXT rather than MTEXT so old AutoCAD verticals still render it. The mapping table travels with the DXF so a file on its own still states how to map its layers onto material definitions; it quotes the layer name the drawing actually carries (disambiguation included) so a row matches the CAD layer list verbatim, and a geological-model export has no identifiers and emits no table.

.. CG-EXPLANATION-END id=method:DxfSectionExporter._draw_title_block

Function ``def _layer_body``
----------------------------

.. CG-BLOCK id=function:_layer_body lines=497-528

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/dxf_section_exporter.py
   :language: python
   :lines: 497-528
   :lineno-match:

.. CG-EXPLANATION-START id=function:_layer_body

**What this does.** Composes the layer-name body for one unit — the machine identifier joined to the display name for a classified unit, otherwise the bare display name.

**Why it is here.** A classified unit leads with the identifier so one CAD wildcard (``GeoModel-NAD-06_*``) selects every instance of a class; every other level keeps its name byte-identical, its identifiers riding the layer description and the mapping table, which no downstream consumer keys on (docs/exports.md, the naming rule).

.. CG-EXPLANATION-END id=function:_layer_body

Function ``def _mapping_rows``
------------------------------

.. CG-BLOCK id=function:_mapping_rows lines=529-570

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/dxf_section_exporter.py
   :language: python
   :lines: 529-570
   :lineno-match:

.. CG-EXPLANATION-START id=function:_mapping_rows

**What this does.** Builds the mapping-table rows for the units the drawing carries — one per identifier-carrying unit — quoting the layer name the drawing actually assigned and carrying any absorbed-unit names.

**Why it is here.** Only classified units are listed, so a geological-model export yields an empty list and no table. The absorbed-unit names appear when export thinning merged same-class units (debt #104b), which keeps that erased boundary auditable in the delivered file.

.. CG-EXPLANATION-END id=function:_mapping_rows

Function ``def _formation_layer_name``
--------------------------------------

.. CG-BLOCK id=function:_formation_layer_name lines=571-590

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/dxf_section_exporter.py
   :language: python
   :lines: 571-590
   :lineno-match:

.. CG-EXPLANATION-START id=function:_formation_layer_name

**What this does.** Turns a formation name into a DXF-safe layer name: strips CR/LF, drops the forbidden characters, prepends the ``GeoModel-`` prefix, and truncates to 255 characters.

**Why it is here.** DXF forbids certain characters in a layer name; they are stripped rather than substituted because formation names rarely contain them and read better without than with a placeholder underscore. CR/LF are stripped first because a line break corrupts the line-oriented DXF stream and ezdxf's only guard against it is an ``assert`` that ``python -O`` drops.

.. CG-EXPLANATION-END id=function:_formation_layer_name

Function ``def _disambiguated_layer_name``
------------------------------------------

.. CG-BLOCK id=function:_disambiguated_layer_name lines=591-640

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/dxf_section_exporter.py
   :language: python
   :lines: 591-640
   :lineno-match:

.. CG-EXPLANATION-START id=function:_disambiguated_layer_name

**What this does.** Derives a free layer name for a formation whose name is already claimed by appending the formation's short id (the first 8 hex characters of its UUID), widening the suffix if even that is taken, and re-deriving through the sanitiser so the result stays DXF-safe and within 255 characters.

**Why it is here.** The short id tells the two colliding layers apart by something stable and traceable back to the model, rather than an arbitrary ``(2)``. The suffix is added by trimming the BODY, not the finished name, so truncation can never cut the suffix off a 255-character name and reproduce the collision it exists to resolve. It takes the ``is-taken`` predicate as an argument so the helper stays pure and unit-testable.

.. CG-EXPLANATION-END id=function:_disambiguated_layer_name

Function ``def _parse_hex_color``
---------------------------------

.. CG-BLOCK id=function:_parse_hex_color lines=641-668

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/dxf_section_exporter.py
   :language: python
   :lines: 641-668
   :lineno-match:

.. CG-EXPLANATION-START id=function:_parse_hex_color

**What this does.** Parses a ``#rrggbb`` (or three-digit ``#rgb``) string into ezdxf's RGB colour, returning ``None`` on anything it cannot parse.

**Why it is here.** The formation colour string comes from the API, and a malformed colour must NOT block the export of valid layer geometry — the caller falls back to the DXF default colour instead of raising.

.. CG-EXPLANATION-END id=function:_parse_hex_color

