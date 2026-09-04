groundmodel.infrastructure.parsers.cpt.dov.dov_parser
=====================================================

.. CG-PAGE source=src/groundmodel/infrastructure/parsers/cpt/dov/dov_parser.py complete=true

*Source file:* ``src/groundmodel/infrastructure/parsers/cpt/dov/dov_parser.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-85

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/cpt/dov/dov_parser.py
   :language: python
   :lines: 1-85
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A long docstring documenting the exact shape of a DOV sounding XML — where each value lives inside it, what units it uses, and how to read the cone type — followed by the imports the parser needs, including a hardened XML reader and the GEF header and result types it reuses.

**Why it is here.** XML is a nested, tag-based text format; a *namespace* is a prefix that keeps one vocabulary's tags from clashing with another's. The docstring pins down verified facts about DOV's XML so the parser is written against reality, not a guess (its element names are Dutch and must be used as text, never as Python names). Two facts are load-bearing: DOV states friction and pore pressure in kilopascals (so the parser divides by 1000 to reach MPa), and the depth tag ``<diepte>`` is the already-corrected vertical depth, preferred over the along-rod ``<lengte>``. The XML reader is the safety-hardened ``defusedxml``, which blocks the classic malicious-XML attacks the standard library is open to. Reusing the GEF result type means a DOV import flows through the very same storage pipeline as a GEF file.

.. CG-EXPLANATION-END id=module-header

Class ``DovParser`` — header
----------------------------

.. CG-BLOCK id=class:DovParser lines=86-92

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/cpt/dov/dov_parser.py
   :language: python
   :lines: 86-92
   :lineno-match:

.. CG-EXPLANATION-START id=class:DovParser

**What this does.** Opens the DOV parser class, whose job is to turn one sounding's XML into the same result object a GEF parse produces.

**Why it is here.** By producing the identical result type, a DOV import can call the exact same save routine as a file import — no second copy of the duplicate-checking, coordinate-validation, and storage logic. It inherits the logger base class like every service.

.. CG-EXPLANATION-END id=class:DovParser

Method ``DovParser``. ``def __init__``
--------------------------------------

.. CG-BLOCK id=method:DovParser.__init__ lines=93-95

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/cpt/dov/dov_parser.py
   :language: python
   :lines: 93-95
   :lineno-match:

.. CG-EXPLANATION-START id=method:DovParser.__init__

**What this does.** Registers the logger under this module's name; there is no other state to set up.

**Why it is here.** Each parse call is self-contained, so the parser holds nothing between soundings.

.. CG-EXPLANATION-END id=method:DovParser.__init__

Method ``DovParser``. ``def parse``
-----------------------------------

.. CG-BLOCK id=method:DovParser.parse lines=96-169

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/cpt/dov/dov_parser.py
   :language: python
   :lines: 96-169
   :lineno-match:

.. CG-EXPLANATION-START id=method:DovParser.parse

**What this does.** The entry point. It reads the raw XML bytes (raising a clear ``ParseError`` if they are not valid XML), logs the document's top-level structure, finds the ``<sondering>`` (sounding) element inside the root, then reads the header, reads the measurement data, detects the CPT type, records Rf's provenance, and packages the result.

**Why it is here.** If the expected ``<sondering>`` element is missing, it logs the tags that *were* present before refusing — so a schema change at DOV shows up immediately instead of as a silent empty import. Rf is never in the DOV XML, so when it exists in the output it was always computed by us, and it is stamped ``COMPUTED`` accordingly; the elevation is stamped ``DOV`` when a ground level was present and ``NONE`` when it was not, so a later refresh can fill one in without clashing with a value a person set.

.. CG-EXPLANATION-END id=method:DovParser.parse

Method ``DovParser``. ``def _parse_header``
-------------------------------------------

.. CG-BLOCK id=method:DovParser._parse_header lines=170-197

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/cpt/dov/dov_parser.py
   :language: python
   :lines: 170-197
   :lineno-match:

.. CG-EXPLANATION-START id=method:DovParser._parse_header

**What this does.** Reads the header fields — test number, start date, company, position, and cone metadata — and builds a GEF-style header from them, stamping the project identifier as ``"DOV"`` and the known DOV coordinate systems.

**Why it is here.** Stamping ``project_id = "DOV"`` is what scopes duplicate detection to DOV imports, so the same sounding can be imported into two different projects but never twice into one. The coordinate systems are set directly because DOV always publishes in Belgian Lambert 72, so there is no per-file code to translate as there is for GEF.

.. CG-EXPLANATION-END id=method:DovParser._parse_header

Method ``DovParser``. ``def _parse_location``
---------------------------------------------

.. CG-BLOCK id=method:DovParser._parse_location lines=198-221

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/cpt/dov/dov_parser.py
   :language: python
   :lines: 198-221
   :lineno-match:

.. CG-EXPLANATION-START id=method:DovParser._parse_location

**What this does.** Pulls the x, y, z position out of the GML point inside the ``<ligging>`` (location) element, using a shared helper. On a structural failure it logs a warning and returns three blanks.

**Why it is here.** GML (Geography Markup Language) is the standard way coordinates are written inside this kind of XML. The structural walk through the point is shared with the borehole parser so both read coordinates the same way; only the way a failure is reported (a warning plus blanks, here) is CPT-specific. The docstring records that although DOV labels the point with a different coordinate code, the numbers are really Belgian Lambert 72, confirmed against the WFS properties.

.. CG-EXPLANATION-END id=method:DovParser._parse_location

Method ``DovParser``. ``def _parse_cone_metadata``
--------------------------------------------------

.. CG-BLOCK id=method:DovParser._parse_cone_metadata lines=222-294

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/cpt/dov/dov_parser.py
   :language: python
   :lines: 222-294
   :lineno-match:

.. CG-EXPLANATION-START id=method:DovParser._parse_cone_metadata

**What this does.** Digs down through the nested apparatus elements to read the cone's net area ratio (its a-value) and its type string, and turns the type string into a code: mechanical cones start with ``M`` (code 1), electric and piezocones start with ``E`` or ``U`` (code 0). At each level, if the expected element is absent it logs the tags that were present and returns "unknown".

**Why it is here.** The cone-type code decides a physically important routing downstream: a mechanical cone's combined reading goes to ``q_total_mpa`` while a piezocone's corrected reading goes to ``qt_mpa`` — two different quantities that are never derived from one another. Because that hinge matters, the method logs exactly what it found when the structure is not as expected, at debug level, since cone metadata is legitimately absent on some older records and is not an error. Code 0 covers both electric and piezocone; those two are told apart later from the data itself.

.. CG-EXPLANATION-END id=method:DovParser._parse_cone_metadata

Method ``DovParser``. ``def _parse_data``
-----------------------------------------

.. CG-BLOCK id=method:DovParser._parse_data lines=295-392

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/cpt/dov/dov_parser.py
   :language: python
   :lines: 295-392
   :lineno-match:

.. CG-EXPLANATION-START id=method:DovParser._parse_data

**What this does.** Reads the block of per-depth measurement rows. It walks down to the ``<penetratietest>`` element, collects the ``<meetdata>`` (measurement) rows, converts them via a helper, and builds a table with an explicitly-typed set of columns. It then computes Rf from friction and tip resistance, and drops any column that turned out to be entirely blank. Missing structure produces an error issue and an empty table rather than a crash.

**Why it is here.** The column types are pinned explicitly, on purpose. On some DOV piezocone files a channel like friction or pore pressure is blank for the first hundred-plus rows and only starts deeper down; if the table library guessed the type from the early rows it would call the column empty and then choke on the first real value, silently dropping the whole CPT. Fixing the type up front makes the parse robust to where the first reading appears. Dropping all-blank columns keeps them out of storage.

.. CG-EXPLANATION-END id=method:DovParser._parse_data

Method ``DovParser``. ``def _extract_rows``
-------------------------------------------

.. CG-BLOCK id=method:DovParser._extract_rows lines=393-458

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/cpt/dov/dov_parser.py
   :language: python
   :lines: 393-458
   :lineno-match:

.. CG-EXPLANATION-START id=method:DovParser._extract_rows

**What this does.** Turns the list of measurement elements into row records. For each row it takes the corrected depth (falling back to the along-rod length only when the corrected depth is absent), the tip resistance, and the friction, pore pressure, and Qt values — converting friction and pore pressure from kilopascals to MPa. Rows missing depth or tip resistance are counted and skipped.

**Why it is here.** DOV's single ``<Qt>`` tag means two different things by cone type — a mechanical cone's combined total resistance versus a piezocone's corrected tip resistance — so this helper routes it into ``q_total_mpa`` or ``qt_mpa`` accordingly, keeping the two physically distinct measurements in their own columns. Preferring the corrected depth honours DOV having already done the inclination correction for us.

.. CG-EXPLANATION-END id=method:DovParser._extract_rows

Method ``DovParser``. ``def _detect_type``
------------------------------------------

.. CG-BLOCK id=method:DovParser._detect_type lines=459-486

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/cpt/dov/dov_parser.py
   :language: python
   :lines: 459-486
   :lineno-match:

.. CG-EXPLANATION-START id=method:DovParser._detect_type

**What this does.** Decides the CPT kind from the cone code plus which columns actually carry data: a mechanical code wins outright; otherwise any pore-pressure reading marks a piezocone; otherwise a friction reading marks an electric cone; failing all, it is mechanical.

**Why it is here.** The cone code alone cannot separate an electric cone from a piezocone (both are code 0), so the presence of real pore-pressure data is used as the tie-breaker. Marking this a *static* method (one that needs no access to the parser's own state) signals that it decides purely from its two inputs.

.. CG-EXPLANATION-END id=method:DovParser._detect_type

