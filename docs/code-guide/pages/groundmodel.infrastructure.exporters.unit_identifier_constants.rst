groundmodel.infrastructure.exporters.unit_identifier_constants
==============================================================

.. CG-PAGE source=src/groundmodel/infrastructure/exporters/unit_identifier_constants.py complete=true

*Source file:* ``src/groundmodel/infrastructure/exporters/unit_identifier_constants.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-79

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/unit_identifier_constants.py
   :language: python
   :lines: 1-79
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Defines every fixed value of the export unit-identifier scheme: the ``NAD-`` prefix that leads a geotechnical unit's token, the two-digit zero-pad width for the class number, the separators (an underscore between class and soil, a dash-with-spaces between identifier and display name), the ``#`` used to number a duplicate Plaxis material, the set of characters DXF forbids in a layer name, and all the mapping-table headings, spacers and joins — including the two columns that appear only sometimes (``Absorbed units`` and ``Geo``).

**Why it is here.** The identifier scheme is a published contract an engineer keys a CAD script on, and the very same token must appear identically in every artefact, so the tokens live in one file rather than inline in each exporter (CLAUDE.md constants rule; docs/exports.md ``Unit identifiers``). The class is zero-padded to two digits because CAD layer managers and Plaxis material lists sort as text, so without the pad ``NAD-21`` would sort before ``NAD-6`` and the list would read scrambled. The forbidden-character set is defined here alone so the DXF exporter and the identifier builder can never drift apart.

.. CG-EXPLANATION-END id=module-header

