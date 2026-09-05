groundmodel.infrastructure.exporters.dstability_exporter
========================================================

.. CG-PAGE source=src/groundmodel/infrastructure/exporters/dstability_exporter.py complete=true

*Source file:* ``src/groundmodel/infrastructure/exporters/dstability_exporter.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-86

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/dstability_exporter.py
   :language: python
   :lines: 1-86
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The file's description of what the D-Stability export states and deliberately does not, its list of the GEOLib behaviours it works around, and its imports: the deferred (type-checking-only) GEOLib types, the section-polygon types, the NAD parameters and their source label, the D-Stability constants, the shared NAD lookup, the closed-geometry base class, and the unit-label helpers.

**Why it is here.** D-Stability's geometry IS a set of closed soil-layer polygons, so this is the first Strix export that carries the section fill itself rather than the picks behind it: each drawn region becomes one D-Stability layer and each unit one D-Stability soil, named by its export identifier. NO design parameter is written unless the NAD table carries the class — cohesion, friction angle and both unit weights are otherwise left at GEOLib's zero, which is the product's liability line (CLAUDE.md Core Philosophy): a zero is an unmistakable blank the engineer must fill, where a plausible default would read as a value Strix stood behind. GEOLib is Deltares's Python library for the D-Series file formats; it is imported lazily inside the methods so pulling this exporter in at API boot does not pay its large import cost (docs/exports.md), and the export is not yet validated inside D-Stability — the beta testers do that.

.. CG-EXPLANATION-END id=module-header

Class ``DStabilityExporter`` — header
-------------------------------------

.. CG-BLOCK id=class:DStabilityExporter lines=87-89

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/dstability_exporter.py
   :language: python
   :lines: 87-89
   :lineno-match:

.. CG-EXPLANATION-START id=class:DStabilityExporter

**What this does.** Declares the D-Stability exporter as a concrete ``SectionGeometryExporter``.

**Why it is here.** Subclassing the closed-geometry base class ties it to the ``SectionPolygonSet`` input — the section's drawn fill, which is exactly what D-Stability's geometry is.

.. CG-EXPLANATION-END id=class:DStabilityExporter

Method ``DStabilityExporter``. ``def __init__``
-----------------------------------------------

.. CG-BLOCK id=method:DStabilityExporter.__init__ lines=90-93

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/dstability_exporter.py
   :language: python
   :lines: 90-93
   :lineno-match:

.. CG-EXPLANATION-START id=method:DStabilityExporter.__init__

**What this does.** The set-up method; it only registers the module-named logger.

**Why it is here.** The exporter keeps no state between calls, so the logger is all there is to set up.

.. CG-EXPLANATION-END id=method:DStabilityExporter.__init__

Method ``DStabilityExporter``. ``def export``
---------------------------------------------

.. CG-BLOCK id=method:DStabilityExporter.export lines=94-178

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/dstability_exporter.py
   :language: python
   :lines: 94-178
   :lineno-match:

.. CG-EXPLANATION-START id=method:DStabilityExporter.export

**What this does.** The entry point that builds the ``.stix`` archive. It logs the inputs; splits the drawn regions into those worth handing to GEOLib and counts the rest; refuses if none survive; then creates a fresh D-Stability model, stamps its project info, builds the unique per-unit labels (logging any collisions), adds one soil per unit that fills something and one layer per drawable region; refuses again if GEOLib rejected every ring; serialises the model to bytes; and logs a success line before returning.

**Why it is here.** A ``.stix`` is D-Stability's project file (a zip archive). An empty one is a plausible, correctly-named, completely wrong deliverable, so the export REFUSES with a ValueError (the route turns it into a 422) rather than shipping one when there is no closed geometry to draw (docs/exports.md: it refuses rather than shipping an empty artefact).

.. CG-EXPLANATION-END id=method:DStabilityExporter.export

Method ``DStabilityExporter``. ``def _partition_drawable``
----------------------------------------------------------

.. CG-BLOCK id=method:DStabilityExporter._partition_drawable lines=179-200

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/dstability_exporter.py
   :language: python
   :lines: 179-200
   :lineno-match:

.. CG-EXPLANATION-START id=method:DStabilityExporter._partition_drawable

**What this does.** Walks the drawn regions, keeping each one that can become a layer and counting — and warning about, with the reason — each one it drops.

**Why it is here.** A dropped region is a hole in the deliverable, so it is counted and named in the log rather than silently swallowed (the project's logging discipline).

.. CG-EXPLANATION-END id=method:DStabilityExporter._partition_drawable

Method ``DStabilityExporter``. ``def _undrawable_reason``
---------------------------------------------------------

.. CG-BLOCK id=method:DStabilityExporter._undrawable_reason lines=201-218

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/dstability_exporter.py
   :language: python
   :lines: 201-218
   :lineno-match:

.. CG-EXPLANATION-START id=method:DStabilityExporter._undrawable_reason

**What this does.** Names why one region cannot become a layer — its unit is not in the section's unit list, it has fewer than three vertices, or its area is effectively zero (the ring is a line) — or returns ``None`` when the region is fine.

**Why it is here.** The area floor is matched to the 2-D drawing engine's own zero-area floor so a region the editor treats as real is never dropped here, and naming the reason is what lets the engineer see why a region was left out of the file.

.. CG-EXPLANATION-END id=method:DStabilityExporter._undrawable_reason

Method ``DStabilityExporter``. ``def _stamp_project_info``
----------------------------------------------------------

.. CG-BLOCK id=method:DStabilityExporter._stamp_project_info lines=219-231

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/dstability_exporter.py
   :language: python
   :lines: 219-231
   :lineno-match:

.. CG-EXPLANATION-START id=method:DStabilityExporter._stamp_project_info

**What this does.** Writes the Strix provenance into the file's project-info block: the project and section names, the ``StrixGeo`` producer stamp, and a Remarks line carrying the vertical datum, the horizontal-axis definition, and the parameters-not-exported disclaimer.

**Why it is here.** The disclaimer is stated INSIDE the artefact because the file outlives the conversation that produced it. It writes ``datastructure.projectinfo`` directly because GEOLib's ``set_meta_property`` mutates a process-wide singleton shared by every model in the process.

.. CG-EXPLANATION-END id=method:DStabilityExporter._stamp_project_info

Method ``DStabilityExporter``. ``def _emit_soils``
--------------------------------------------------

.. CG-BLOCK id=method:DStabilityExporter._emit_soils lines=232-278

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/dstability_exporter.py
   :language: python
   :lines: 232-278
   :lineno-match:

.. CG-EXPLANATION-START id=method:DStabilityExporter._emit_soils

**What this does.** Adds one D-Stability soil per unit that actually fills a drawn region, keyed by its unique label; looks up the unit's NAD parameters and, when present, writes them and stamps the source-table label onto the soil's Notes; then logs how many soils were parameterised versus left at GEOLib's blank defaults.

**Why it is here.** GEOLib's Soil constructor forbids a notes key, so the provenance label is set on the persisted soil AFTER it is added (the Notes field round-trips into the archive). The parameters, when present, come from NBN EN 1997-1 ANB Tabel 2.1; when the class is absent from the table the soil is left at GEOLib's blank zeros — never an invented default (docs/exports.md: a design parameter is written only when the NAD table carries the unit's class).

.. CG-EXPLANATION-END id=method:DStabilityExporter._emit_soils

Method ``DStabilityExporter``. ``def _emit_layers``
---------------------------------------------------

.. CG-BLOCK id=method:DStabilityExporter._emit_layers lines=279-321

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/dstability_exporter.py
   :language: python
   :lines: 279-321
   :lineno-match:

.. CG-EXPLANATION-START id=method:DStabilityExporter._emit_layers

**What this does.** Adds one D-Stability layer per drawable region, converting the ring's points to GEOLib points, keying the layer on the unit's label, and writing the machine-identity note; a region GEOLib itself still refuses (a self-intersecting ring) is dropped and counted.

**Why it is here.** GEOLib runs each ring through a shapely repair; a repaired self-intersecting ring is not a single simple polygon, and picking one half of a repaired bow-tie would invent ground nobody drew, so dropping and counting it is the honest answer.

.. CG-EXPLANATION-END id=method:DStabilityExporter._emit_layers

Function ``def _build_soil``
----------------------------

.. CG-BLOCK id=function:_build_soil lines=322-373

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/dstability_exporter.py
   :language: python
   :lines: 322-373
   :lineno-match:

.. CG-EXPLANATION-START id=function:_build_soil

**What this does.** Builds the GEOLib soil for a unit: name and code only when it has no NAD parameters, or name, code, Mohr-Coulomb cohesion and friction angle, and both unit weights when it does.

**Why it is here.** When parameterised, the shear model is set to Mohr-Coulomb both ABOVE and BELOW the phreatic level so the strength is actually used under the water table (GEOLib's default below-water model is otherwise a different, undrained ``Su`` model). When not, every strength and weight field is left at GEOLib's blank initial value — never an invented default.

.. CG-EXPLANATION-END id=function:_build_soil

Function ``def _layer_note``
----------------------------

.. CG-BLOCK id=function:_layer_note lines=374-383

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/dstability_exporter.py
   :language: python
   :lines: 374-383
   :lineno-match:

.. CG-EXPLANATION-START id=function:_layer_note

**What this does.** Renders the layer's machine-identity note from the template — the unit name, NAD class, soil code and formation id, with ``n/a`` wherever a field is absent.

**Why it is here.** The layer's own label carries the display name; the note carries the machine identity a downstream script keys on, including the formation id that resolves a class-plus-soil collision.

.. CG-EXPLANATION-END id=function:_layer_note

Function ``def _ring_area``
---------------------------

.. CG-BLOCK id=function:_ring_area lines=384-392

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/dstability_exporter.py
   :language: python
   :lines: 384-392
   :lineno-match:

.. CG-EXPLANATION-START id=function:_ring_area

**What this does.** Computes the absolute area of a ring by the shoelace formula, regardless of which direction the points wind.

**Why it is here.** It is the cheap area test the drawability check uses to reject a ring that is really a line, before the region ever reaches GEOLib.

.. CG-EXPLANATION-END id=function:_ring_area

