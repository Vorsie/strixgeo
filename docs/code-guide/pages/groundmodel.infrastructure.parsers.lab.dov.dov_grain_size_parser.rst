groundmodel.infrastructure.parsers.lab.dov.dov_grain_size_parser
================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/parsers/lab/dov/dov_grain_size_parser.py complete=true

*Source file:* ``src/groundmodel/infrastructure/parsers/lab/dov/dov_grain_size_parser.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-130

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/lab/dov/dov_grain_size_parser.py
   :language: python
   :lines: 1-130
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A long docstring giving a real annotated example of a grain-size observation XML and its quirks, then the imports.

**Why it is here.** The docstring pins the schema from a verified live example and flags the traps: each curve row lists its percentage before its diameter (counter-intuitive, but the parser reads by tag name so order does not matter); the filter string really has a trailing space; and the pre-treatment blocks are doubly nested with a same-named inner element. It also records what the parser leaves alone — it does not reorder the curve, does not re-validate the filter the orchestrator already applied, and does not re-read the sample metadata.

.. CG-EXPLANATION-END id=module-header

Class ``DovGrainSizeParser`` — header
-------------------------------------

.. CG-BLOCK id=class:DovGrainSizeParser lines=131-152

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/lab/dov/dov_grain_size_parser.py
   :language: python
   :lines: 131-152
   :lineno-match:

.. CG-EXPLANATION-START id=class:DovGrainSizeParser

**What this does.** Opens the grain-size parser class, whose job is to turn one observation XML — plus the caller's sample id — into a structured grain-size result.

**Why it is here.** Like the other parsers it raises only on unreadable XML or a missing observation element; every other problem becomes a finding so a malformed observation can be skipped without dropping the rest of the import.

.. CG-EXPLANATION-END id=class:DovGrainSizeParser

Method ``DovGrainSizeParser``. ``def __init__``
-----------------------------------------------

.. CG-BLOCK id=method:DovGrainSizeParser.__init__ lines=153-156

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/lab/dov/dov_grain_size_parser.py
   :language: python
   :lines: 153-156
   :lineno-match:

.. CG-EXPLANATION-START id=method:DovGrainSizeParser.__init__

**What this does.** Registers the logger under this module's name.

**Why it is here.** Each parse is self-contained, so there is nothing else to set up.

.. CG-EXPLANATION-END id=method:DovGrainSizeParser.__init__

Method ``DovGrainSizeParser``. ``def parse``
--------------------------------------------

.. CG-BLOCK id=method:DovGrainSizeParser.parse lines=157-292

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/lab/dov/dov_grain_size_parser.py
   :language: python
   :lines: 157-292
   :lineno-match:

.. CG-EXPLANATION-START id=method:DovGrainSizeParser.parse

**What this does.** The entry point. It reads the XML, finds the observation element, sanity-checks that the test type matches grain-size (a warning, not a refusal), reads the method and date, extracts the curve and the pre-treatment flags, then builds the grain-size entity. If the domain type rejects the curve it records an error finding and builds an empty entity instead.

**Why it is here.** The sample id is a required keyword argument so a caller cannot forget it and silently link the curve to no sample. The domain type validates the curve strictly — matching array lengths, percentages in range, strictly increasing diameters — and rather than letting a violation crash, the parser turns it into a finding and still returns a (empty) result so the import continues.

.. CG-EXPLANATION-END id=method:DovGrainSizeParser.parse

Method ``DovGrainSizeParser``. ``def _parse_curve``
---------------------------------------------------

.. CG-BLOCK id=method:DovGrainSizeParser._parse_curve lines=293-385

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/lab/dov/dov_grain_size_parser.py
   :language: python
   :lines: 293-385
   :lineno-match:

.. CG-EXPLANATION-START id=method:DovGrainSizeParser._parse_curve

**What this does.** Pulls the two parallel lists — diameters and percentage-larger — out of the value series, in source order. Rows missing or non-numeric in either value are skipped with a warning, and a missing or empty series produces a warning and two empty lists.

**Why it is here.** It reads each value by tag name, so DOV's counter-intuitive ordering of the two values within a row does not matter. Returning empty lists rather than crashing keeps the result constructible, with the empty curve later flagged as an error.

.. CG-EXPLANATION-END id=method:DovGrainSizeParser._parse_curve

Method ``DovGrainSizeParser``. ``def _parse_treatments``
--------------------------------------------------------

.. CG-BLOCK id=method:DovGrainSizeParser._parse_treatments lines=386-430

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/lab/dov/dov_grain_size_parser.py
   :language: python
   :lines: 386-430
   :lineno-match:

.. CG-EXPLANATION-START id=method:DovGrainSizeParser._parse_treatments

**What this does.** Reads the pre-treatment blocks and maps them to two flags: whether lime was removed and whether organic matter was removed, each true, false, or unknown.

**Why it is here.** These pre-treatments change what a grain-size curve means, so they are captured as typed flags. An unrecognised treatment or an unrecognised yes/no value is logged rather than crashing, because DOV could add a new pre-treatment kind and it should be visible for a follow-up, not fatal.

.. CG-EXPLANATION-END id=method:DovGrainSizeParser._parse_treatments

