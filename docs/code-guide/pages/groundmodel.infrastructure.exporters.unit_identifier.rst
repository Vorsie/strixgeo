groundmodel.infrastructure.exporters.unit_identifier
====================================================

.. CG-PAGE source=src/groundmodel/infrastructure/exporters/unit_identifier.py complete=true

*Source file:* ``src/groundmodel/infrastructure/exporters/unit_identifier.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-78

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/unit_identifier.py
   :language: python
   :lines: 1-78
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The file's long description of the identifier scheme — the four token shapes (``NAD-06_ZAND``, ``NAD-06``, ``ZAND``, or none), why the ``NAD-`` prefix is spelled out, why the class is zero-padded, why the soil follows the class, and why the token is stripped DXF-safe — followed by the import of every mapping-table constant.

**Why it is here.** Until this module existed the exporters emitted display names only, so a downstream tool could read a geotech export but could not map its units onto material definitions: the two machine-usable fields — the NAD packing class and the base lithology soil code — never left Strix (docs/exports.md, ``Unit identifiers``; this is the v1.0 gate's export step). This module is the single scheme every exporter shares.

.. CG-EXPLANATION-END id=module-header

Class ``UnitMappingRow``
------------------------

.. CG-BLOCK id=class:UnitMappingRow lines=79-126

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/unit_identifier.py
   :language: python
   :lines: 79-126
   :lineno-match:

.. CG-EXPLANATION-START id=class:UnitMappingRow

**What this does.** A frozen data holder for one row of the unit mapping table: the export label the artefact actually carries, the NAD class, the soil code, the display name, the source formation UUID, and two optional lists — units absorbed by export thinning, and the geological formations a body crosses.

**Why it is here.** It holds data only, no behaviour, so it does not inherit the logger (CLAUDE.md). The ``export_label`` is stored verbatim, ordinal disambiguation included, so the table describes what the file really contains rather than the scheme's intent; the formation UUID is the only globally unique handle, carried so a downstream script can tell apart two units that share a class and a soil.

.. CG-EXPLANATION-END id=class:UnitMappingRow

Function ``def unit_identifier``
--------------------------------

.. CG-BLOCK id=function:unit_identifier lines=127-156

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/unit_identifier.py
   :language: python
   :lines: 127-156
   :lineno-match:

.. CG-EXPLANATION-START id=function:unit_identifier

**What this does.** Builds the machine token for one unit from whichever identifiers it carries: ``NAD-06_ZAND`` (class and soil), ``NAD-06`` (class only), ``ZAND`` (soil only), or ``None`` when it has neither.

**Why it is here.** ``None`` is the exporters' signal to fall back to display-name-only behaviour. The class is zero-padded to two digits so a text-sorting CAD or Plaxis list reads in class order, and the soil follows the class so the token is a stable prefix a single wildcard (``NAD-06_*``) can select on.

.. CG-EXPLANATION-END id=function:unit_identifier

Function ``def naming_identifier``
----------------------------------

.. CG-BLOCK id=function:naming_identifier lines=157-183

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/unit_identifier.py
   :language: python
   :lines: 157-183
   :lineno-match:

.. CG-EXPLANATION-START id=function:naming_identifier

**What this does.** Returns the identifier only when the unit carries a NAD class; otherwise returns ``None``.

**Why it is here.** This is the ONE place the naming rule lives: a unit's export NAME changes only when it carries a NAD class. The DXF layer name, the Plaxis material identification and the Plaxis variable name all ask this function, so the three can never disagree about which units were renamed (docs/exports.md, ``The naming rule``).

.. CG-EXPLANATION-END id=function:naming_identifier

Function ``def format_mapping_table``
-------------------------------------

.. CG-BLOCK id=function:format_mapping_table lines=184-265

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/unit_identifier.py
   :language: python
   :lines: 184-265
   :lineno-match:

.. CG-EXPLANATION-START id=function:format_mapping_table

**What this does.** Renders the mapping rows as aligned plain-text lines — a title, a heading row, a rule row, then one line per unit — padding each column to its widest cell. It adds the ``Geo`` column only when some unit crosses more than one formation, and the ``Absorbed units`` column only when something was thinned, and it returns an empty list when there are no rows.

**Why it is here.** One renderer serves both the DXF (one model-space text entity per line) and the Plaxis script (its docstring header), so an engineer who receives either artefact reads the same table. The two extra columns appear only when they carry information, so an unthinned, geology-agnostic export renders byte-identically to before those features existed. An empty rows list returns nothing at all, because an empty-bodied table would read as a bug rather than as ``nothing to map`` (a geological-model export has no identifiers).

.. CG-EXPLANATION-END id=function:format_mapping_table

Function ``def _normalised_soil_code``
--------------------------------------

.. CG-BLOCK id=function:_normalised_soil_code lines=266-271

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/unit_identifier.py
   :language: python
   :lines: 266-271
   :lineno-match:

.. CG-EXPLANATION-START id=function:_normalised_soil_code

**What this does.** Upper-cases the soil token and drops any DXF-illegal character, returning ``None`` if nothing is left.

**Why it is here.** The soil vocabulary is a closed five-token set (ZAND / KLEI / SILT / GRIND / VEEN), so stripping illegal characters can never collapse two distinct codes onto one, and the cleaned result is always safe to splice straight into a DXF layer name.

.. CG-EXPLANATION-END id=function:_normalised_soil_code

