groundmodel.application.suggest_litho_contacts
==============================================

.. CG-PAGE source=src/groundmodel/application/suggest_litho_contacts.py complete=true

*Source file:* ``src/groundmodel/application/suggest_litho_contacts.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-38

.. literalinclude:: ../../../src/groundmodel/application/suggest_litho_contacts.py
   :language: python
   :lines: 1-38
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the suggest-litho file. It imports the water-table resolver, the domain segmenters for CPTs and boreholes, the admixture value object, and the database rows it reads, and its docstring states the use case is read-only.

**Why it is here.** The docstring records that nothing is written here — the engineer accepts the suggestions later through the separate accept flow. It also names the deliberate divergence: this is where the Robertson 2015/2009 CPT segmenter plugs in, kept apart from the frozen 1990 Ic preview (docs/debt.md).

.. CG-EXPLANATION-END id=module-header

Class ``InvalidModelKindError`` — header
----------------------------------------

.. CG-BLOCK id=class:InvalidModelKindError lines=39-46

.. literalinclude:: ../../../src/groundmodel/application/suggest_litho_contacts.py
   :language: python
   :lines: 39-46
   :lineno-match:

.. CG-EXPLANATION-START id=class:InvalidModelKindError

**What this does.** An error type raised when the target model is not a lithostratigraphic one.

**Why it is here.** Only a lithostratigraphic model may receive CPT- or borehole-derived litho suggestions, because geological and geotechnical models use different formation vocabularies; the router turns this error into a 422 (a code meaning the request was well-formed but not acceptable).

.. CG-EXPLANATION-END id=class:InvalidModelKindError

Method ``InvalidModelKindError``. ``def __init__``
--------------------------------------------------

.. CG-BLOCK id=method:InvalidModelKindError.__init__ lines=47-55

.. literalinclude:: ../../../src/groundmodel/application/suggest_litho_contacts.py
   :language: python
   :lines: 47-55
   :lineno-match:

.. CG-EXPLANATION-START id=method:InvalidModelKindError.__init__

**What this does.** Builds the error, storing the model id and the actual kind and composing a readable message.

**Why it is here.** Carrying the offending kind on the error lets the message say exactly what was wrong instead of a bare failure.

.. CG-EXPLANATION-END id=method:InvalidModelKindError.__init__

Class ``InvestigationNotFoundError`` — header
---------------------------------------------

.. CG-BLOCK id=class:InvestigationNotFoundError lines=56-58

.. literalinclude:: ../../../src/groundmodel/application/suggest_litho_contacts.py
   :language: python
   :lines: 56-58
   :lineno-match:

.. CG-EXPLANATION-START id=class:InvestigationNotFoundError

**What this does.** An error type raised when the requested CPT or borehole does not exist or carries no usable data.

**Why it is here.** A distinct type lets the router answer with the right not-found status rather than a generic failure.

.. CG-EXPLANATION-END id=class:InvestigationNotFoundError

Method ``InvestigationNotFoundError``. ``def __init__``
-------------------------------------------------------

.. CG-BLOCK id=method:InvestigationNotFoundError.__init__ lines=59-67

.. literalinclude:: ../../../src/groundmodel/application/suggest_litho_contacts.py
   :language: python
   :lines: 59-67
   :lineno-match:

.. CG-EXPLANATION-START id=method:InvestigationNotFoundError.__init__

**What this does.** Builds the error, storing the investigation id and its kind.

**Why it is here.** The id and kind make the failure traceable.

.. CG-EXPLANATION-END id=method:InvestigationNotFoundError.__init__

Module-level constants and statements
-------------------------------------

.. CG-BLOCK id=module-statements lines=68-74

.. literalinclude:: ../../../src/groundmodel/application/suggest_litho_contacts.py
   :language: python
   :lines: 68-74
   :lineno-match:

.. CG-EXPLANATION-START id=module-statements

**What this does.** A constant tuple listing the borehole observation streams that carry lithology soil codes, in preference order: coded lithology first, then geotechnical coding, then the free-text description.

**Why it is here.** The comment explains the order: the encoded streams are preferred over the free-text description because they carry machine-readable soil codes; the free-text description is the last resort.

.. CG-EXPLANATION-END id=module-statements

Class ``SuggestLithoContacts`` — header
---------------------------------------

.. CG-BLOCK id=class:SuggestLithoContacts lines=75-84

.. literalinclude:: ../../../src/groundmodel/application/suggest_litho_contacts.py
   :language: python
   :lines: 75-84
   :lineno-match:

.. CG-EXPLANATION-START id=class:SuggestLithoContacts

**What this does.** The read-only use case that segments one investigation and returns suggested layers — a CPT through the Robertson cone segmenter, a borehole through the DOV soil-code map.

**Why it is here.** The docstring stresses it is read-only: nothing is written, so re-running is free and safe. Robertson soil-behaviour-type classification here is a characterisation output (MVP scope), not a design parameter.

.. CG-EXPLANATION-END id=class:SuggestLithoContacts

Method ``SuggestLithoContacts``. ``def __init__``
-------------------------------------------------

.. CG-BLOCK id=method:SuggestLithoContacts.__init__ lines=85-89

.. literalinclude:: ../../../src/groundmodel/application/suggest_litho_contacts.py
   :language: python
   :lines: 85-89
   :lineno-match:

.. CG-EXPLANATION-START id=method:SuggestLithoContacts.__init__

**What this does.** Stores the database session.

**Why it is here.** The caller owns the session; this use case only reads through it.

.. CG-EXPLANATION-END id=method:SuggestLithoContacts.__init__

Method ``SuggestLithoContacts``. ``async def execute_for_cpt``
--------------------------------------------------------------

.. CG-BLOCK id=method:SuggestLithoContacts.execute_for_cpt lines=90-206

.. literalinclude:: ../../../src/groundmodel/application/suggest_litho_contacts.py
   :language: python
   :lines: 90-206
   :lineno-match:

.. CG-EXPLANATION-START id=method:SuggestLithoContacts.execute_for_cpt

**What this does.** Suggests layers for a CPT. It checks the model is lithostratigraphic and gets its project, loads the CPT and its depth series scoped to that project, resolves the ground surface and water table, and runs the cone segmenter with the caller's knobs.

**Why it is here.** The load is scoped to the model's project so a CPT from another project cannot be segmented against this model (a cross-project read guard, debt #4 class). The water table comes from the same resolver the Ic chart and the profile endpoint use, so the curve the engineer reads and the ghosts offered share one water table. The success line logs the id, not the name, because the name is the test id and encodes the client's site code (owner: no user data leaks).

.. CG-EXPLANATION-END id=method:SuggestLithoContacts.execute_for_cpt

Method ``SuggestLithoContacts``. ``async def execute_for_borehole``
-------------------------------------------------------------------

.. CG-BLOCK id=method:SuggestLithoContacts.execute_for_borehole lines=207-338

.. literalinclude:: ../../../src/groundmodel/application/suggest_litho_contacts.py
   :language: python
   :lines: 207-338
   :lineno-match:

.. CG-EXPLANATION-START id=method:SuggestLithoContacts.execute_for_borehole

**What this does.** Suggests layers for a borehole. It validates the model, loads the borehole with its observations, layers and admixtures scoped to the project, picks the best available lithology stream, builds admixture objects, and runs the borehole segmenter.

**Why it is here.** It eager-loads the whole observation tree in one query to avoid a lazy load firing outside the async context (which would raise a MissingGreenlet error). The stream is chosen by the preference order above. A borehole with no lithology layers is reported as not-found, and the warnings log the id, not the name, for the same no-data-leak reason.

.. CG-EXPLANATION-END id=method:SuggestLithoContacts.execute_for_borehole

Method ``SuggestLithoContacts``. ``async def _assert_litho_model``
------------------------------------------------------------------

.. CG-BLOCK id=method:SuggestLithoContacts._assert_litho_model lines=339-374

.. literalinclude:: ../../../src/groundmodel/application/suggest_litho_contacts.py
   :language: python
   :lines: 339-374
   :lineno-match:

.. CG-EXPLANATION-START id=method:SuggestLithoContacts._assert_litho_model

**What this does.** Checks the model exists and is lithostratigraphic, and returns its project id; it raises otherwise.

**Why it is here.** The returned project id is the scope every investigation load must be filtered by; without it a caller could segment a CPT or borehole from a different project against this model (a cross-project read, debt #4 class).

.. CG-EXPLANATION-END id=method:SuggestLithoContacts._assert_litho_model

