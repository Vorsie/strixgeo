groundmodel.infrastructure.exporters.section_exporter
=====================================================

.. CG-PAGE source=src/groundmodel/infrastructure/exporters/section_exporter.py complete=true

*Source file:* ``src/groundmodel/infrastructure/exporters/section_exporter.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-16

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/section_exporter.py
   :language: python
   :lines: 1-16
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The file's description and its imports: the abstract-base-class tools (``ABC`` / ``abstractmethod``), the one-cross-section snapshot type it works on (``SectionSnapshot`` — a single section's geometry, projected from the geological model), and the shared logging base class.

**Why it is here.** The second of the three exporter base classes from the ``BaseExporter`` split (docs/exports.md, debt #109). This one is for artefacts scoped to ONE cross-section built from the formation picks — a section DXF, a Plaxis 2D script.

.. CG-EXPLANATION-END id=module-header

Class ``SectionExporter`` — header
----------------------------------

.. CG-BLOCK id=class:SectionExporter lines=17-23

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/section_exporter.py
   :language: python
   :lines: 17-23
   :lineno-match:

.. CG-EXPLANATION-START id=class:SectionExporter

**What this does.** Declares the abstract base class for section-scoped exporters, inheriting the logging mixin and ``ABC`` so it must be subclassed rather than used directly.

**Why it is here.** Same reasoning as the project exporter: the logger comes first (the project convention), and abstractness forces every concrete section exporter to supply its own ``export``.

.. CG-EXPLANATION-END id=class:SectionExporter

Method ``SectionExporter``. ``def export``
------------------------------------------

.. CG-BLOCK id=method:SectionExporter.export lines=24-39

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/section_exporter.py
   :language: python
   :lines: 24-39
   :lineno-match:

.. CG-EXPLANATION-START id=method:SectionExporter.export

**What this does.** The method each subclass must fill in. It takes a ``SectionSnapshot`` (one section's assembled geometry) and returns the finished file as raw bytes; the ``...`` body is a placeholder for the subclass.

**Why it is here.** Returning bytes leaves the choice of file-versus-download to the API layer, the same contract every exporter follows (docs/exports.md).

.. CG-EXPLANATION-END id=method:SectionExporter.export

