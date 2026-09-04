groundmodel.infrastructure.parsers.borehole.dov.dov_interpretation_parser
=========================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/parsers/borehole/dov/dov_interpretation_parser.py complete=true

*Source file:* ``src/groundmodel/infrastructure/parsers/borehole/dov/dov_interpretation_parser.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-141

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/borehole/dov/dov_interpretation_parser.py
   :language: python
   :lines: 1-141
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A long docstring documenting the three sub-shapes a DOV interpretation XML can take (coded lithology, free-text description, and stratigraphy) and how each maps onto one shared layer type, then the imports.

**Why it is here.** All eight interpretation streams share one wrapper element with one stream-specific element inside it, and the parser reads the first child rather than hard-coding which inner tag goes with which stream — so a future ninth stream needs no code change here. The docstring records that the single wide layer type is filled with whichever fields the source shape provides, and that soil-type codes and formation codes are kept in separate places because they are different codelists. The stream kind and the parent borehole are supplied by the caller, not guessed from the XML, since the caller already knows both.

.. CG-EXPLANATION-END id=module-header

Class ``DovInterpretationParser`` — header
------------------------------------------

.. CG-BLOCK id=class:DovInterpretationParser lines=142-167

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/borehole/dov/dov_interpretation_parser.py
   :language: python
   :lines: 142-167
   :lineno-match:

.. CG-EXPLANATION-START id=class:DovInterpretationParser

**What this does.** Opens the interpretation parser class, whose job is to turn one interpretation XML — plus the caller's borehole id and stream kind — into a structured observation with its layers.

**Why it is here.** Like the other parsers it never crashes on a data-quality problem; those become findings. The only fatal cases are unreadable XML, a missing wrapper, or an empty wrapper, each turned into a skip of that one interpretation.

.. CG-EXPLANATION-END id=class:DovInterpretationParser

Method ``DovInterpretationParser``. ``def __init__``
----------------------------------------------------

.. CG-BLOCK id=method:DovInterpretationParser.__init__ lines=168-171

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/borehole/dov/dov_interpretation_parser.py
   :language: python
   :lines: 168-171
   :lineno-match:

.. CG-EXPLANATION-START id=method:DovInterpretationParser.__init__

**What this does.** Registers the logger under this module's name.

**Why it is here.** Each parse is self-contained, so there is nothing else to set up.

.. CG-EXPLANATION-END id=method:DovInterpretationParser.__init__

Method ``DovInterpretationParser``. ``def parse``
-------------------------------------------------

.. CG-BLOCK id=method:DovInterpretationParser.parse lines=172-282

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/borehole/dov/dov_interpretation_parser.py
   :language: python
   :lines: 172-282
   :lineno-match:

.. CG-EXPLANATION-START id=method:DovInterpretationParser.parse

**What this does.** The entry point. It reads the XML, finds the wrapper and the single stream element inside it, reads the header fields (author, date, reliability, quality), builds the observation, then reads its layers. It warns when there are no layers, logs a success line, and returns the result.

**Why it is here.** The borehole id and stream kind are required keyword arguments so a caller cannot forget them and silently attach the interpretation to the wrong borehole. Reading the first child of the wrapper regardless of its exact name is what keeps the parser open to a new stream type without changes.

.. CG-EXPLANATION-END id=method:DovInterpretationParser.parse

Method ``DovInterpretationParser``. ``def _parse_author``
---------------------------------------------------------

.. CG-BLOCK id=method:DovInterpretationParser._parse_author lines=283-321

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/borehole/dov/dov_interpretation_parser.py
   :language: python
   :lines: 283-321
   :lineno-match:

.. CG-EXPLANATION-START id=method:DovInterpretationParser._parse_author

**What this does.** Flattens DOV's structured author (a person's surname and first name, plus an organisation) into one readable string.

**Why it is here.** One flat string is convenient to store and show, and nothing is lost by collapsing it because the original structured XML is kept in the source cache for reference.

.. CG-EXPLANATION-END id=method:DovInterpretationParser._parse_author

Method ``DovInterpretationParser``. ``def _parse_layers``
---------------------------------------------------------

.. CG-BLOCK id=method:DovInterpretationParser._parse_layers lines=322-415

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/borehole/dov/dov_interpretation_parser.py
   :language: python
   :lines: 322-415
   :lineno-match:

.. CG-EXPLANATION-START id=method:DovInterpretationParser._parse_layers

**What this does.** Builds the list of layers from the interpretation's layer elements, in order. For each it reads the depth interval, colour, main soil codes, admixtures, and a description, packing whichever the source provided into the one shared layer type. Malformed layers are skipped with a warning.

**Why it is here.** The single wide layer type holds all three sub-shapes, so this method just fills what is present. Soil-type codes go in the soil-codes field while formation codes are folded into the description, because the two are different codelists that must not share a column.

.. CG-EXPLANATION-END id=method:DovInterpretationParser._parse_layers

Method ``DovInterpretationParser``. ``def _parse_main_soils``
-------------------------------------------------------------

.. CG-BLOCK id=method:DovInterpretationParser._parse_main_soils lines=416-424

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/borehole/dov/dov_interpretation_parser.py
   :language: python
   :lines: 416-424
   :lineno-match:

.. CG-EXPLANATION-START id=method:DovInterpretationParser._parse_main_soils

**What this does.** Pulls the main soil-type codes out of a layer, of which there can be several when soils are equally dominant.

**Why it is here.** DOV repeats the main-soil element for each equally dominant soil, so this collects them all rather than assuming one.

.. CG-EXPLANATION-END id=method:DovInterpretationParser._parse_main_soils

Method ``DovInterpretationParser``. ``def _parse_admixtures``
-------------------------------------------------------------

.. CG-BLOCK id=method:DovInterpretationParser._parse_admixtures lines=425-446

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/borehole/dov/dov_interpretation_parser.py
   :language: python
   :lines: 425-446
   :lineno-match:

.. CG-EXPLANATION-START id=method:DovInterpretationParser._parse_admixtures

**What this does.** Reads a layer's admixtures — the minor soil components — as value objects carrying the soil code, the amount, and whether it occurs only locally. An admixture with no soil code is skipped.

**Why it is here.** An admixture with no soil code is meaningless (the domain type forbids an empty code), so it is dropped quietly, with the raw element still preserved in the source cache. The "locally" flag reads DOV's literal true/false and defaults to false, the more common case.

.. CG-EXPLANATION-END id=method:DovInterpretationParser._parse_admixtures

Method ``DovInterpretationParser``. ``def _build_description``
--------------------------------------------------------------

.. CG-BLOCK id=method:DovInterpretationParser._build_description lines=447-474

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/borehole/dov/dov_interpretation_parser.py
   :language: python
   :lines: 447-474
   :lineno-match:

.. CG-EXPLANATION-START id=method:DovInterpretationParser._build_description

**What this does.** Builds the layer's description text, preferring an explicit free-text field, then falling back to the two stratigraphy member codes joined by their relation, and returning "nothing" when neither is present.

**Why it is here.** The one shared layer type has a single description field, so the free-text shape and the stratigraphy shape both have to be expressed through it; this decides how each is rendered into that one field.

.. CG-EXPLANATION-END id=method:DovInterpretationParser._build_description

