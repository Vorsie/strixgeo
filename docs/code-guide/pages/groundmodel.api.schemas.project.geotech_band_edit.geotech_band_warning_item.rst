groundmodel.api.schemas.project.geotech_band_edit.geotech_band_warning_item
===========================================================================

.. CG-PAGE source=src/groundmodel/api/schemas/project/geotech_band_edit/geotech_band_warning_item.py complete=true

*Source file:* ``src/groundmodel/api/schemas/project/geotech_band_edit/geotech_band_warning_item.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-7

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/geotech_band_edit/geotech_band_warning_item.py
   :language: python
   :lines: 1-7
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the schema and imports the Pydantic tools.

**Why it is here.** The advisory-warning item embedded in the plan response; same schema pattern.

.. CG-EXPLANATION-END id=module-header

Class ``GeotechBandWarningItem``
--------------------------------

.. CG-BLOCK id=class:GeotechBandWarningItem lines=8-30

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/geotech_band_edit/geotech_band_warning_item.py
   :language: python
   :lines: 8-30
   :lineno-match:

.. CG-EXPLANATION-START id=class:GeotechBandWarningItem

**What this does.** One advisory consequence of a hand edit: a code the desktop switches on, a ready-to-show plain-language message, the depth range it concerns, and optionally the existing band it names.

**Why it is here.** The docstring states these are advisory and never blocking — a hand edit always proceeds. The message is pre-written so the desktop shows it verbatim rather than composing its own.

.. CG-EXPLANATION-END id=class:GeotechBandWarningItem

