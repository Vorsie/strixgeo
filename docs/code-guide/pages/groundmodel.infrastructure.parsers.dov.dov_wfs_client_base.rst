groundmodel.infrastructure.parsers.dov.dov_wfs_client_base
==========================================================

.. CG-PAGE source=src/groundmodel/infrastructure/parsers/dov/dov_wfs_client_base.py complete=true

*Source file:* ``src/groundmodel/infrastructure/parsers/dov/dov_wfs_client_base.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-52

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/dov/dov_wfs_client_base.py
   :language: python
   :lines: 1-52
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A docstring, then the imports for a shared base class that five DOV WFS clients build on.

**Why it is here.** Those five clients (borehole, interpretation, sample, grain-size, scalar) all share the same rectangle-import shape — convert the rectangle, count, fetch features, build typed rows, warn about skipped ones. The base class carries that shared plumbing so each client only declares its own layer and its own row-builder. The CPT client is deliberately left out because it has a streaming progress pipeline the others do not, and folding it in would burden the base with machinery nobody else needs.

.. CG-EXPLANATION-END id=module-header

Class ``DovWfsClientBase`` — header
-----------------------------------

.. CG-BLOCK id=class:DovWfsClientBase lines=53-77

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/dov/dov_wfs_client_base.py
   :language: python
   :lines: 53-77
   :lineno-match:

.. CG-EXPLANATION-START id=class:DovWfsClientBase

**What this does.** Opens the shared base class. A subclass sets its layer name and label as class values and provides a row-builder; the base provides the count, the feature-fetch, and the skip-tracking.

**Why it is here.** The skip-tracking is offered as small overridable hooks because different clients count skips differently — a borehole skip is one counter, a sample skip has two reasons — and the hooks let each keep its own diagnostics while sharing the surrounding loop.

.. CG-EXPLANATION-END id=class:DovWfsClientBase

Method ``DovWfsClientBase``. ``def __init__``
---------------------------------------------

.. CG-BLOCK id=method:DovWfsClientBase.__init__ lines=78-102

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/dov/dov_wfs_client_base.py
   :language: python
   :lines: 78-102
   :lineno-match:

.. CG-EXPLANATION-START id=method:DovWfsClientBase.__init__

**What this does.** Stores the shared HTTP client and the optional rate-limit state, and registers the logger under the subclass's own module name.

**Why it is here.** Using the subclass's module name for the logger keeps log lines attributed to the real client, not to this base. The rate-limit state is threaded through so a 429 seen during discovery slows the whole import down, mirroring the CPT path.

.. CG-EXPLANATION-END id=method:DovWfsClientBase.__init__

Method ``DovWfsClientBase``. ``async def _wfs_count``
-----------------------------------------------------

.. CG-BLOCK id=method:DovWfsClientBase._wfs_count lines=103-117

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/dov/dov_wfs_client_base.py
   :language: python
   :lines: 103-117
   :lineno-match:

.. CG-EXPLANATION-START id=method:DovWfsClientBase._wfs_count

**What this does.** Asks how many features are in a rectangle, using the subclass's layer and (if it has one) filter, via the shared count helper.

**Why it is here.** Most of the five clients need exactly this, so it is inherited unchanged; the two that need an extra argument override it.

.. CG-EXPLANATION-END id=method:DovWfsClientBase._wfs_count

Method ``DovWfsClientBase``. ``async def _wfs_features``
--------------------------------------------------------

.. CG-BLOCK id=method:DovWfsClientBase._wfs_features lines=118-177

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/dov/dov_wfs_client_base.py
   :language: python
   :lines: 118-177
   :lineno-match:

.. CG-EXPLANATION-START id=method:DovWfsClientBase._wfs_features

**What this does.** Fetches one rectangle of features and turns each into a typed row via the subclass's row-builder, skipping the rows the builder rejects and, at the end, emitting a one-line summary of how many were skipped.

**Why it is here.** The skip counter is reassigned from the hook's return value, and the comment records why: a plain number cannot be changed in place, so a hook that forgot to return it once left the counter stuck at zero and the skip-warning silent. Dumping the available property names when rows are skipped makes a DOV field rename obvious.

.. CG-EXPLANATION-END id=method:DovWfsClientBase._wfs_features

Method ``DovWfsClientBase``. ``def _build_row``
-----------------------------------------------

.. CG-BLOCK id=method:DovWfsClientBase._build_row lines=178-186

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/dov/dov_wfs_client_base.py
   :language: python
   :lines: 178-186
   :lineno-match:

.. CG-EXPLANATION-START id=method:DovWfsClientBase._build_row

**What this does.** The placeholder each subclass must fill in: turn one feature's properties into a typed row, or return "nothing" to skip it.

**Why it is here.** Row-building is the one piece that genuinely differs per kind of data, so the base declares it as required and leaves the detail to each subclass.

.. CG-EXPLANATION-END id=method:DovWfsClientBase._build_row

Method ``DovWfsClientBase``. ``def _init_skip_state``
-----------------------------------------------------

.. CG-BLOCK id=method:DovWfsClientBase._init_skip_state lines=187-195

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/dov/dov_wfs_client_base.py
   :language: python
   :lines: 187-195
   :lineno-match:

.. CG-EXPLANATION-START id=method:DovWfsClientBase._init_skip_state

**What this does.** Returns the starting skip counter for one batch — by default a plain zero.

**Why it is here.** A subclass that needs to count several skip reasons returns a richer structure here instead; the simple default suits the common single-reason case.

.. CG-EXPLANATION-END id=method:DovWfsClientBase._init_skip_state

Method ``DovWfsClientBase``. ``def _on_skipped_feature``
--------------------------------------------------------

.. CG-BLOCK id=method:DovWfsClientBase._on_skipped_feature lines=196-211

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/dov/dov_wfs_client_base.py
   :language: python
   :lines: 196-211
   :lineno-match:

.. CG-EXPLANATION-START id=method:DovWfsClientBase._on_skipped_feature

**What this does.** Updates the skip counter for one rejected feature — by default, adds one.

**Why it is here.** It must return the updated counter because the loop reassigns from that return; the comment spells out that this is why the plain-number default works and why an override must always return its state.

.. CG-EXPLANATION-END id=method:DovWfsClientBase._on_skipped_feature

Method ``DovWfsClientBase``. ``def _emit_skip_warning``
-------------------------------------------------------

.. CG-BLOCK id=method:DovWfsClientBase._emit_skip_warning lines=212-230

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/dov/dov_wfs_client_base.py
   :language: python
   :lines: 212-230
   :lineno-match:

.. CG-EXPLANATION-START id=method:DovWfsClientBase._emit_skip_warning

**What this does.** At the end of a batch, when any features were skipped, logs one warning with the count and the property names from the first feature.

**Why it is here.** Listing the property names alongside the skip count gives concrete data to chase when the cause is a DOV field rename, instead of a bare "some rows were skipped".

.. CG-EXPLANATION-END id=method:DovWfsClientBase._emit_skip_warning

