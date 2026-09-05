groundmodel.application.export_artifact
=======================================

.. CG-PAGE source=src/groundmodel/application/export_artifact.py complete=true

*Source file:* ``src/groundmodel/application/export_artifact.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-24

.. literalinclude:: ../../../src/groundmodel/application/export_artifact.py
   :language: python
   :lines: 1-24
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the export-download contract file: the docstring and the import for building a frozen data holder.

**Why it is here.** The docstring records that every export endpoint runs an exporter, gets serialised bytes, and must hand the client the payload, a proposed filename and a media type — and that before this module the six export handlers repeated that same tail across two routers (debt #110). Packaging it here keeps the filename-safety rule in one place and honours the layer direction: the application layer never imports a web response class, so this stays testable without the web framework.

.. CG-EXPLANATION-END id=module-header

Function ``def safe_filename_stem``
-----------------------------------

.. CG-BLOCK id=function:safe_filename_stem lines=25-52

.. literalinclude:: ../../../src/groundmodel/application/export_artifact.py
   :language: python
   :lines: 25-52
   :lineno-match:

.. CG-EXPLANATION-START id=function:safe_filename_stem

**What this does.** Turns a user-supplied name into a safe filename stem by replacing anything that is not a letter, digit, dash, underscore or space with an underscore, trimming the ends, and falling back to a given default when nothing safe remains.

**Why it is here.** It is the single source of truth for download-filename safety across the export endpoints, stripping characters that would break a filename or the download header. Why: recorded in the docstring.

.. CG-EXPLANATION-END id=function:safe_filename_stem

Class ``ExportArtifact`` — header
---------------------------------

.. CG-BLOCK id=class:ExportArtifact lines=53-76

.. literalinclude:: ../../../src/groundmodel/application/export_artifact.py
   :language: python
   :lines: 53-76
   :lineno-match:

.. CG-EXPLANATION-START id=class:ExportArtifact

**What this does.** A frozen data holder for a finished export ready to download: the serialised bytes, the proposed filename, and the media type.

**Why it is here.** It is the boundary between the application and web layers — the web layer turns it into a response while the application layer never imports a response class, so exports stay testable without the web framework and reusable by any non-HTTP caller. It holds data only, so it does not inherit the logger.

.. CG-EXPLANATION-END id=class:ExportArtifact

Method ``ExportArtifact``. ``def build``
----------------------------------------

.. CG-BLOCK id=method:ExportArtifact.build lines=77-116

.. literalinclude:: ../../../src/groundmodel/application/export_artifact.py
   :language: python
   :lines: 77-116
   :lineno-match:

.. CG-EXPLANATION-START id=method:ExportArtifact.build

**What this does.** A constructor that packages exporter output into an artifact: it builds the safe filename stem from the name and fallback, appends the format suffix, and pairs the filename with the payload and media type.

**Why it is here.** It combines the two steps every export handler shared, with the route-specific differences — which name, its fallback, the suffix and the media type — as parameters (debt #110), so the shared filename logic lives in exactly one place.

.. CG-EXPLANATION-END id=method:ExportArtifact.build

