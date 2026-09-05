groundmodel.infrastructure.exporters.dsheet_piling_exporter
===========================================================

.. CG-PAGE source=src/groundmodel/infrastructure/exporters/dsheet_piling_exporter.py complete=true

*Source file:* ``src/groundmodel/infrastructure/exporters/dsheet_piling_exporter.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-108

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/dsheet_piling_exporter.py
   :language: python
   :lines: 1-108
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The file's description of the v1 scope (supply the 1-D soil profile and nothing else), of how the 1-D column is read out of the 2-D partition, of the two structural anomalies it counts, and of the GEOLib behaviours it works around — followed by its imports: the deferred GEOLib types, the section-polygon types, the NAD parameters and source label, the ASCII folder, the D-Sheet constants, the shared NAD lookup, the closed-geometry base class, and the unit-label helpers.

**Why it is here.** D-Sheet Piling is a retaining-wall tool whose model is a wall, construction stages, water levels and — underneath all of it — one 1-D soil profile per side, and Strix knows only the profile. So v1 supplies the profile and writes everything else D-Sheet demands as an explicit TODO, never a default: a guessed phreatic level changes every earth-pressure result, and a plausible number is indistinguishable from a measured one once it is in the file (docs/exports.md). Strength, stiffness and unit weight stay at D-Sheet's own initial values unless the NAD table (NBN EN 1997-1 ANB Tabel 2.1) carries the class. A ``.shi`` is the D-Sheet input file (cp1252 ASCII); GEOLib is imported lazily to keep it off the API boot path, and the export is not yet validated inside D-Sheet — the beta testers do that.

.. CG-EXPLANATION-END id=module-header

Class ``DSheetPilingExporter`` — header
---------------------------------------

.. CG-BLOCK id=class:DSheetPilingExporter lines=109-111

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/dsheet_piling_exporter.py
   :language: python
   :lines: 109-111
   :lineno-match:

.. CG-EXPLANATION-START id=class:DSheetPilingExporter

**What this does.** Declares the D-Sheet Piling exporter as a concrete ``SectionGeometryExporter``.

**Why it is here.** Subclassing the closed-geometry base class ties it to the ``SectionPolygonSet`` input, out of which it samples a single vertical column.

.. CG-EXPLANATION-END id=class:DSheetPilingExporter

Method ``DSheetPilingExporter``. ``def __init__``
-------------------------------------------------

.. CG-BLOCK id=method:DSheetPilingExporter.__init__ lines=112-115

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/dsheet_piling_exporter.py
   :language: python
   :lines: 112-115
   :lineno-match:

.. CG-EXPLANATION-START id=method:DSheetPilingExporter.__init__

**What this does.** The set-up method; it only registers the module-named logger.

**Why it is here.** The exporter keeps no state between calls, so the logger is all there is to set up.

.. CG-EXPLANATION-END id=method:DSheetPilingExporter.__init__

Method ``DSheetPilingExporter``. ``def export``
-----------------------------------------------

.. CG-BLOCK id=method:DSheetPilingExporter.export lines=116-201

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/dsheet_piling_exporter.py
   :language: python
   :lines: 116-201
   :lineno-match:

.. CG-EXPLANATION-START id=method:DSheetPilingExporter.export

**What this does.** The entry point that builds the ``.shi`` for one position on one section. It rejects a fraction outside 0 to 1; turns the fraction into an along-section distance; samples the top-down layer stack out of the 2-D fill there; refuses if nothing is drawn at that position; builds the unique per-unit labels (logging collisions); builds the GEOLib model and stamps the run-identification block; serialises to bytes; and logs a success line before returning.

**Why it is here.** The default sample position is mid-section (a constant). A profile with no ground is a plausible, correctly-named, completely wrong deliverable, so a position with no drawn ground is REFUSED with a ValueError rather than exported (docs/exports.md: it refuses rather than shipping an empty artefact).

.. CG-EXPLANATION-END id=method:DSheetPilingExporter.export

Method ``DSheetPilingExporter``. ``def _build_model``
-----------------------------------------------------

.. CG-BLOCK id=method:DSheetPilingExporter._build_model lines=202-301

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/dsheet_piling_exporter.py
   :language: python
   :lines: 202-301
   :lineno-match:

.. CG-EXPLANATION-START id=method:DSheetPilingExporter._build_model

**What this does.** Assembles the GEOLib model and returns it with the count of parameterised soils. It sets the earth-pressure method; adds one soil per distinct unit in the stack (with NAD parameters when present, else GEOLib's blank defaults), logging the parameterised count; adds one construction stage; builds the soil profile from the layer stack and attaches it to BOTH sides; adds the surface at the sampled ground level to both sides; and adds the placeholder water level to both sides.

**Why it is here.** Both sides get the same profile because Strix knows one ground model — D-Sheet's left/right split is an excavation concept the engineer introduces, not something the section states. GEOLib always writes a water-level block, so the water table cannot be omitted, only NAMED ``TODO set water level`` at GEOLib's own 0.00 — and never set to the ground surface, the audit-2026-08-02 mistake that made every model fully saturated. The parameterised count drives which run-identification line is written.

.. CG-EXPLANATION-END id=method:DSheetPilingExporter._build_model

Method ``DSheetPilingExporter``. ``def _stamp_run_identification``
------------------------------------------------------------------

.. CG-BLOCK id=method:DSheetPilingExporter._stamp_run_identification lines=302-350

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/dsheet_piling_exporter.py
   :language: python
   :lines: 302-350
   :lineno-match:

.. CG-EXPLANATION-START id=method:DSheetPilingExporter._stamp_run_identification

**What this does.** Writes the provenance and TODO text into the ``[RUN IDENTIFICATION]`` block, within its three-line budget: a provenance line (project, section, sample position, datum), a missing-inputs TODO, and a parameters line that either says the parameters are at D-Sheet defaults or names the source table when some soils carried NAD parameters. Every free-text label is ASCII-folded, and it warns if more than three lines were written.

**Why it is here.** This block is the only place a ``.shi`` lets Strix state provenance, and D-Sheet's GUI shows only three lines, so a fourth would be in the file but invisible. The labels are folded because the file is cp1252 but readers pick their own encoding — a section named ``A-A'`` broke the parse on Linux. When soils carry parameters, this is where their source (NBN EN 1997-1 ANB Tabel 2.1) is named, because a ``.shi`` soil block has no per-soil free-text field.

.. CG-EXPLANATION-END id=method:DSheetPilingExporter._stamp_run_identification

Method ``DSheetPilingExporter``. ``def _sample_column``
-------------------------------------------------------

.. CG-BLOCK id=method:DSheetPilingExporter._sample_column lines=351-433

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/dsheet_piling_exporter.py
   :language: python
   :lines: 351-433
   :lineno-match:

.. CG-EXPLANATION-START id=method:DSheetPilingExporter._sample_column

**What this does.** Reads the top-down layer stack out of the 2-D fill at one along-section position. It intersects the vertical sample line with every valid region to get the elevation intervals inside each, cuts those intervals at every boundary elevation, attributes each resulting slab to the region covering its midpoint, merges runs of the same unit, and returns the stack. Holes (no region covers a slab) and overlaps (more than one does) are counted and warned.

**Why it is here.** Cutting at every boundary and attributing by midpoint makes an overlap deterministic and a hole visible. D-Sheet's profile can express neither a void nor an overlap, so both are surfaced in the log rather than silently absorbed — a hole would be swallowed by the layer above it, an overlap resolved arbitrarily.

.. CG-EXPLANATION-END id=method:DSheetPilingExporter._sample_column

Function ``def _build_soil``
----------------------------

.. CG-BLOCK id=function:_build_soil lines=434-472

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/dsheet_piling_exporter.py
   :language: python
   :lines: 434-472
   :lineno-match:

.. CG-EXPLANATION-START id=function:_build_soil

**What this does.** Builds a D-Sheet soil for a profile layer, with the export label used as BOTH the soil name and code: no parameters when the class is not in the table, or Mohr-Coulomb cohesion and friction angle plus both unit weights when it is.

**Why it is here.** D-Sheet references a profile layer's soil by name, so the label serves as both name and code. When not parameterised the soil is left at GEOLib's own blank initial values — never an invented default.

.. CG-EXPLANATION-END id=function:_build_soil

Function ``def _merge_runs``
----------------------------

.. CG-BLOCK id=function:_merge_runs lines=473-484

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/dsheet_piling_exporter.py
   :language: python
   :lines: 473-484
   :lineno-match:

.. CG-EXPLANATION-START id=function:_merge_runs

**What this does.** Collapses consecutive slabs of the same unit into one layer.

**Why it is here.** Two adjacent slabs of the same unit are one layer to any practical purpose, so merging keeps the exported profile as short as the geology really is.

.. CG-EXPLANATION-END id=function:_merge_runs

Function ``def _vertical_spans``
--------------------------------

.. CG-BLOCK id=function:_vertical_spans lines=485-529

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/dsheet_piling_exporter.py
   :language: python
   :lines: 485-529
   :lineno-match:

.. CG-EXPLANATION-START id=function:_vertical_spans

**What this does.** Returns the elevation intervals where the vertical line at a given along-distance lies inside one ring, using the even-odd rule over the ring's edge crossings with a half-open horizontal test.

**Why it is here.** The even-odd rule lets a non-convex region correctly contribute two separate intervals, and the half-open test counts a vertex that sits exactly on the sample line once rather than twice. Two deliberate consequences: a sample landing exactly on a column belongs to the gap to its RIGHT (so the two gaps sharing that column never both contribute), and a sample on the fill's right-most edge yields nothing — so ``fraction=1.0`` on a section whose last column sits at the line's end has no profile, and the caller then refuses with a message naming the position.

.. CG-EXPLANATION-END id=function:_vertical_spans

Function ``def _ring_area``
---------------------------

.. CG-BLOCK id=function:_ring_area lines=530-538

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/dsheet_piling_exporter.py
   :language: python
   :lines: 530-538
   :lineno-match:

.. CG-EXPLANATION-START id=function:_ring_area

**What this does.** Computes the absolute area of a ring by the shoelace formula, regardless of winding direction.

**Why it is here.** It is the same cheap area test the D-Stability exporter uses, applied here to skip a region that is really a line before the sampler bothers with it.

.. CG-EXPLANATION-END id=function:_ring_area

