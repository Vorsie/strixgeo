groundmodel.infrastructure.exporters.project_exporter
=====================================================

.. CG-PAGE source=src/groundmodel/infrastructure/exporters/project_exporter.py complete=true

*Source file:* ``src/groundmodel/infrastructure/exporters/project_exporter.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-16

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/project_exporter.py
   :language: python
   :lines: 1-16
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The file's description and its toolbox. It imports the two pieces needed to write an *abstract base class* (a class that lays down a required shape for other classes to fill in, but that you never use on its own): ``ABC`` and ``abstractmethod``. It also imports the project-wide snapshot type it works on (``GroundModelSnapshot`` — the full project's layer geometry, gathered by the application layer) and the shared logging base class.

**Why it is here.** This is one of three exporter base classes the old single ``BaseExporter`` was split into (docs/exports.md, debt #109). Splitting by *what goes in* means each base class names exactly the one input shape it needs. This one is for exports that cover the WHOLE project at once — for example the Plaxis 3D script.

.. CG-EXPLANATION-END id=module-header

Class ``ProjectExporter`` — header
----------------------------------

.. CG-BLOCK id=class:ProjectExporter lines=17-23

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/project_exporter.py
   :language: python
   :lines: 17-23
   :lineno-match:

.. CG-EXPLANATION-START id=class:ProjectExporter

**What this does.** Declares the abstract base class for project-wide exporters. It inherits the logging mixin and ``ABC``, so it can never be used directly — only a concrete exporter that fills in its ``export`` method can.

**Why it is here.** Inheriting ``GroundModelLogger`` first is the project rule for any class that does real work, so every exporter can write to the log the same way (CLAUDE.md ``Logging via inheritance``). Being abstract forces each concrete project exporter to supply its own ``export``.

.. CG-EXPLANATION-END id=class:ProjectExporter

Method ``ProjectExporter``. ``def export``
------------------------------------------

.. CG-BLOCK id=method:ProjectExporter.export lines=24-39

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/project_exporter.py
   :language: python
   :lines: 24-39
   :lineno-match:

.. CG-EXPLANATION-START id=method:ProjectExporter.export

**What this does.** The one method every concrete subclass must write. It takes a ``GroundModelSnapshot`` and returns the finished export as raw bytes. The ``...`` body means there is no implementation here — subclasses provide it.

**Why it is here.** Returning bytes rather than writing a file keeps the exporter ignorant of where the result ends up — a file on disk, or the body of a web download. The API layer decides that, packaging the bytes through one shared converter (docs/exports.md, ``ExportArtifact`` / ``export_response``).

.. CG-EXPLANATION-END id=method:ProjectExporter.export

