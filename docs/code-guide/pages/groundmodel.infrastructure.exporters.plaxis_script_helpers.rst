groundmodel.infrastructure.exporters.plaxis_script_helpers
==========================================================

.. CG-PAGE source=src/groundmodel/infrastructure/exporters/plaxis_script_helpers.py complete=true

*Source file:* ``src/groundmodel/infrastructure/exporters/plaxis_script_helpers.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-45

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/plaxis_script_helpers.py
   :language: python
   :lines: 1-45
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The file's description of the four byte-identical building blocks the 2D and 3D Plaxis emitters share, then its imports (``re`` and the typing pieces, the identifier row type and naming helper, and two separator constants), a type variable for a generic key, and the compiled regular expression that finds any run of three or more double-quotes.

**Why it is here.** Both Plaxis exporters emit the same shape of script and share four blocks, so extracting them here means a Plaxis-API change (a renamed property) is fixed in one place, not two (debt #110 / #169). The helpers are pure functions — no input/output, no logging, no class state — so they live at module level rather than in a class.

.. CG-EXPLANATION-END id=module-header

Function ``def _space_out_quote_run``
-------------------------------------

.. CG-BLOCK id=function:_space_out_quote_run lines=46-56

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/plaxis_script_helpers.py
   :language: python
   :lines: 46-56
   :lineno-match:

.. CG-EXPLANATION-START id=function:_space_out_quote_run

**What this does.** Takes a matched run of double-quotes and returns those same quotes with a single space between each, so no three stay next to each other.

**Why it is here.** Three adjacent double-quotes can close a Python docstring; spacing them keeps every quote (the text stays faithful) while making the run unable to act as a docstring delimiter.

.. CG-EXPLANATION-END id=function:_space_out_quote_run

Function ``def sanitize_script_text``
-------------------------------------

.. CG-BLOCK id=function:sanitize_script_text lines=57-97

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/plaxis_script_helpers.py
   :language: python
   :lines: 57-97
   :lineno-match:

.. CG-EXPLANATION-START id=function:sanitize_script_text

**What this does.** Makes a user-supplied string safe to splice into a ``#`` comment or the module docstring: it collapses every line break to a single space and then breaks any run of three-or-more double-quotes.

**Why it is here.** The emitted script is meant to be RUN (``python <this_file>.py``), so any user text landing in a comment or docstring is a code-injection surface — a line break would end a comment or add a docstring line and drop injected code onto its own executable line, and a triple-quote would close the docstring. Values are already safe (they go through ``py_str``); this is the ONE guard every raw comment/docstring splice routes through. Ordinary names carry neither hazard and emit byte-identical output.

.. CG-EXPLANATION-END id=function:sanitize_script_text

Class ``_HasNameAndOrder`` — header
-----------------------------------

.. CG-BLOCK id=class:_HasNameAndOrder lines=98-106

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/plaxis_script_helpers.py
   :language: python
   :lines: 98-106
   :lineno-match:

.. CG-EXPLANATION-START id=class:_HasNameAndOrder

**What this does.** Declares the structural interface (a Protocol) a formation must satisfy for the shared emitters — only the attributes they actually read.

**Why it is here.** The 3D and 2D exporters pass DIFFERENT concrete formation types that happen to share these attributes; a Protocol expresses that shared shape without coupling the helpers to either concrete type.

.. CG-EXPLANATION-END id=class:_HasNameAndOrder

Method ``_HasNameAndOrder``. ``def name``
-----------------------------------------

.. CG-BLOCK id=method:_HasNameAndOrder.name lines=107-111

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/plaxis_script_helpers.py
   :language: python
   :lines: 107-111
   :lineno-match:

.. CG-EXPLANATION-START id=method:_HasNameAndOrder.name

**What this does.** The formation's display label.

**Why it is here.** The emitters use it as the material identification and in the script's comments.

.. CG-EXPLANATION-END id=method:_HasNameAndOrder.name

Method ``_HasNameAndOrder``. ``def display_order``
--------------------------------------------------

.. CG-BLOCK id=method:_HasNameAndOrder.display_order lines=112-116

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/plaxis_script_helpers.py
   :language: python
   :lines: 112-116
   :lineno-match:

.. CG-EXPLANATION-START id=method:_HasNameAndOrder.display_order

**What this does.** The stratigraphic-age axis, where a lower number is older.

**Why it is here.** The emitters sort on it to put the youngest formation on top (Plaxis layer 0).

.. CG-EXPLANATION-END id=method:_HasNameAndOrder.display_order

Method ``_HasNameAndOrder``. ``def nad_class``
----------------------------------------------

.. CG-BLOCK id=method:_HasNameAndOrder.nad_class lines=117-121

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/plaxis_script_helpers.py
   :language: python
   :lines: 117-121
   :lineno-match:

.. CG-EXPLANATION-START id=method:_HasNameAndOrder.nad_class

**What this does.** The Belgian NAD packing class on a geotechnical unit, or ``None`` on any other level.

**Why it is here.** It is read to build the machine identifier that names the material and fills the mapping table.

.. CG-EXPLANATION-END id=method:_HasNameAndOrder.nad_class

Method ``_HasNameAndOrder``. ``def litho_main_soil_code``
---------------------------------------------------------

.. CG-BLOCK id=method:_HasNameAndOrder.litho_main_soil_code lines=122-126

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/plaxis_script_helpers.py
   :language: python
   :lines: 122-126
   :lineno-match:

.. CG-EXPLANATION-START id=method:_HasNameAndOrder.litho_main_soil_code

**What this does.** The base lithology soil token on a litho or geotech unit, or ``None`` on a geological formation.

**Why it is here.** It is the other half of the machine identifier.

.. CG-EXPLANATION-END id=method:_HasNameAndOrder.litho_main_soil_code

Method ``_HasNameAndOrder``. ``def formation_id``
-------------------------------------------------

.. CG-BLOCK id=method:_HasNameAndOrder.formation_id lines=127-133

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/plaxis_script_helpers.py
   :language: python
   :lines: 127-133
   :lineno-match:

.. CG-EXPLANATION-START id=method:_HasNameAndOrder.formation_id

**What this does.** The source formation row id, when the snapshot carries one.

**Why it is here.** It is carried into the mapping table as the globally unique handle that resolves a class-plus-soil collision.

.. CG-EXPLANATION-END id=method:_HasNameAndOrder.formation_id

Module-level constants and statements
-------------------------------------

.. CG-BLOCK id=module-statements lines=134-136

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/plaxis_script_helpers.py
   :language: python
   :lines: 134-136
   :lineno-match:

.. CG-EXPLANATION-START id=module-statements

**What this does.** Gives the protocol a short alias, ``Formation``, used in the helper signatures below.

**Why it is here.** Purely a readable name in the type hints.

.. CG-EXPLANATION-END id=module-statements

Function ``def emit_header``
----------------------------

.. CG-BLOCK id=function:emit_header lines=137-195

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/plaxis_script_helpers.py
   :language: python
   :lines: 137-195
   :lineno-match:

.. CG-EXPLANATION-START id=function:emit_header

**What this does.** Builds the script's opening docstring — a title, a provenance/subject block, a USAGE section, an optional unit mapping table, and a NOTES section — with the variable content supplied by the caller and only the section order and the triple-quote fences fixed here. Every caller-supplied line is passed through the sanitiser.

**Why it is here.** Both exporters open with the same skeleton, so the section order lives once. The caller's lines are user-reachable (project and section names, formation display names) and land inside the docstring, so each is sanitised; the static section labels and the fences are ours and are not. An empty mapping table emits nothing, keeping a geological-model export byte-identical to the pre-#104 output.

.. CG-EXPLANATION-END id=function:emit_header

Function ``def emit_borehole_layer_levels``
-------------------------------------------

.. CG-BLOCK id=function:emit_borehole_layer_levels lines=196-285

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/plaxis_script_helpers.py
   :language: python
   :lines: 196-285
   :lineno-match:

.. CG-EXPLANATION-START id=function:emit_borehole_layer_levels

**What this does.** Returns the ``setsoillayerlevel`` lines for one borehole. Walking the formation list top-down, it computes each formation's top level at this column — its own ``surface - depth_top`` when present, else the top of the next-deeper present formation (a zero-thickness layer), else the column bottom — then emits one line per formation plus a final line for the base of the deepest layer.

**Why it is here.** A Plaxis borehole with N layers has N+1 boundaries; index N is the base of the deepest layer, and omitting it left the deepest (usually the founding) unit running to whatever base Plaxis defaulted to instead of the depth the investigation reached (audit 2026-08-02). The final line is clamped with ``min`` so a column whose recorded bottom sits shallower than its deepest contact collapses to a zero-thickness deepest layer rather than an inverted one. The function is generic over the key type because the 3D exporter keys by formation name and the 2D by formation UUID.

.. CG-EXPLANATION-END id=function:emit_borehole_layer_levels

Function ``def emit_imports_and_connect``
-----------------------------------------

.. CG-BLOCK id=function:emit_imports_and_connect lines=286-310

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/plaxis_script_helpers.py
   :language: python
   :lines: 286-310
   :lineno-match:

.. CG-EXPLANATION-START id=function:emit_imports_and_connect

**What this does.** Returns the fixed block that imports plxscripting and opens a connection to a running Plaxis through its remote scripting server, with HOST / PORT / PASSWORD placeholders and ``g_i.new()`` to start a fresh project.

**Why it is here.** ``plxscripting`` is Plaxis's own remote-scripting library, and the connection it opens is a *scripting session* through which the script drives Plaxis. The block is identical for 2D and 3D, so it lives once; the engineer fills in the placeholders before running the script.

.. CG-EXPLANATION-END id=function:emit_imports_and_connect

Function ``def emit_materials``
-------------------------------

.. CG-BLOCK id=function:emit_materials lines=311-352

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/plaxis_script_helpers.py
   :language: python
   :lines: 311-352
   :lineno-match:

.. CG-EXPLANATION-START id=function:emit_materials

**What this does.** Returns one Mohr-Coulomb placeholder soil-material block per formation — a ``g_i.soilmat()`` (a *soilmat* is a Plaxis soil material) with only its identification name and the Mohr-Coulomb model number set — collecting them in a script-side ``materials`` dictionary. The names come from ``material_names`` so two units sharing a class and a soil never collapse onto one variable or one identification.

**Why it is here.** Only the identification is set — no strength or stiffness values, which Phase 5 fills. A NAD-classified unit's identification leads with its machine identifier so the engineer can map the Plaxis material onto a material definition without leaving the material list (debt #104); every other level keeps its bare display name.

.. CG-EXPLANATION-END id=function:emit_materials

Function ``def emit_global_layers``
-----------------------------------

.. CG-BLOCK id=function:emit_global_layers lines=353-394

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/plaxis_script_helpers.py
   :language: python
   :lines: 353-394
   :lineno-match:

.. CG-EXPLANATION-START id=function:emit_global_layers

**What this does.** Returns the global soil-layer stack — one ``g_i.soillayer(0)`` per formation, top-down — each assigned its placeholder material. Layer index i in the emitted code corresponds to formations[i].

**Why it is here.** A *soillayer* here is a global horizontal layer shared by the borehole set; each borehole then sets its own top level for every layer through ``setsoillayerlevel``. The formations must already be sorted youngest-first by the caller. The formation name in the comment is user text, so it is routed through the sanitiser.

.. CG-EXPLANATION-END id=function:emit_global_layers

Function ``def material_identification``
----------------------------------------

.. CG-BLOCK id=function:material_identification lines=395-423

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/plaxis_script_helpers.py
   :language: python
   :lines: 395-423
   :lineno-match:

.. CG-EXPLANATION-START id=function:material_identification

**What this does.** Returns the Plaxis identification string for one unit: the machine identifier joined to the display name (``NAD-06_ZAND - Zand van Diest``) when the unit is classified, otherwise the bare display name.

**Why it is here.** Leading with the identifier makes the Plaxis material list directly mappable onto material definitions; unclassified units keep their pre-#104 name byte-identical, and their identifiers ride the mapping table instead.

.. CG-EXPLANATION-END id=function:material_identification

Function ``def material_names``
-------------------------------

.. CG-BLOCK id=function:material_names lines=424-485

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/plaxis_script_helpers.py
   :language: python
   :lines: 424-485
   :lineno-match:

.. CG-EXPLANATION-START id=function:material_names

**What this does.** Returns one collision-free ``(python variable, identification)`` pair per unit, positionally aligned with the formation list, giving any repeat an ordinal on BOTH halves in emission order.

**Why it is here.** Two units can legitimately share a class and soil, and two formations can share a display name (the seed-from-stratigraphy flow leaves duplicates), which used to derive the SAME variable for two materials — so the second ``g_i.soilmat()`` silently overwrote the first and a unit vanished from the imported model. Numbering repeats on both halves fixes that; the first occurrence keeps the bare names, so a duplicate-free model emits byte-identical output. The DXF exporter disambiguates with a short id instead, because a layer name is length-capped and compared case-folded where a Plaxis identification is neither and reads better with a plain ``#2``.

.. CG-EXPLANATION-END id=function:material_names

Function ``def plaxis_mapping_rows``
------------------------------------

.. CG-BLOCK id=function:plaxis_mapping_rows lines=486-519

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/plaxis_script_helpers.py
   :language: python
   :lines: 486-519
   :lineno-match:

.. CG-EXPLANATION-START id=function:plaxis_mapping_rows

**What this does.** Builds the mapping-table rows for the emitted script — one row per identifier-carrying unit — with each row's export label quoting the identification the script ACTUALLY assigns, disambiguating ordinal included.

**Why it is here.** Only classified units are listed, so a geological-model export yields an empty list and no table; quoting the real identification makes each row match the Plaxis material list verbatim.

.. CG-EXPLANATION-END id=function:plaxis_mapping_rows

Function ``def material_variable_name``
---------------------------------------

.. CG-BLOCK id=function:material_variable_name lines=520-551

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/plaxis_script_helpers.py
   :language: python
   :lines: 520-551
   :lineno-match:

.. CG-EXPLANATION-START id=function:material_variable_name

**What this does.** Turns a material identification into a safe lowercase Python variable name: non-alphanumeric characters become underscores, runs of underscores collapse, and the result is prefixed ``mat_``.

**Why it is here.** A Plaxis identification may hold spaces and Dutch accents that a Python variable name cannot. Making the name unique is NOT this function's job — two inputs can sanitise to the same name — so callers go through ``material_names``, which resolves repeats.

.. CG-EXPLANATION-END id=function:material_variable_name

Function ``def py_str``
-----------------------

.. CG-BLOCK id=function:py_str lines=552-568

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/plaxis_script_helpers.py
   :language: python
   :lines: 552-568
   :lineno-match:

.. CG-EXPLANATION-START id=function:py_str

**What this does.** Formats a Python string literal for the emitted script using ``repr``.

**Why it is here.** ``repr`` lets Unicode names (Boom Klei, Diest Zand) survive the round-trip without hand-rolled escaping that would mishandle a non-ASCII character — and it is the safe path for the VALUES spliced into the script.

.. CG-EXPLANATION-END id=function:py_str

