groundmodel.application.pair_ruling_reanchor
============================================

.. CG-PAGE source=src/groundmodel/application/pair_ruling_reanchor.py complete=true

*Source file:* ``src/groundmodel/application/pair_ruling_reanchor.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-63

.. literalinclude:: ../../../src/groundmodel/application/pair_ruling_reanchor.py
   :language: python
   :lines: 1-63
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the shared pair-ruling file. It imports the band-identity helpers from the tie re-anchor and the logger, and its docstring explains the machinery both the Separate and Join verbs share.

**Why it is here.** Both verbs write a ruling the resolver honours — Separate is a cannot-link, Join is a must-link — anchored on two bands by their layer ids with cascade foreign keys, so a re-subdivide takes the ruling with it unless it is carried across. The carry is identical, so the matcher lives here once, and the two thin verbs set three attributes; the one difference is whether a fused pair (both anchors landing on one band) is a loss (Separate) or satisfied (Join). Each anchor is re-matched by a three-part band identity, dropping the ruling rather than risking the wrong mass when it cannot be carried.

.. CG-EXPLANATION-END id=module-header

Class ``CapturedPairRuling``
----------------------------

.. CG-BLOCK id=class:CapturedPairRuling lines=64-93

.. literalinclude:: ../../../src/groundmodel/application/pair_ruling_reanchor.py
   :language: python
   :lines: 64-93
   :lineno-match:

.. CG-EXPLANATION-START id=class:CapturedPairRuling

**What this does.** A frozen dataclass recording one ruling before the reset destroys its anchors: the old row id (for logging), both anchors' three-part identities, and each anchor's kind.

**Why it is here.** The identity — investigation, depth interval, NAD class — is what the re-match keys on, because the rebuilt band gets a fresh id; the field name keeps the separation-flavoured name for back-compatibility with callers and tests.

.. CG-EXPLANATION-END id=class:CapturedPairRuling

Class ``MatchedPairRuling``
---------------------------

.. CG-BLOCK id=class:MatchedPairRuling lines=94-112

.. literalinclude:: ../../../src/groundmodel/application/pair_ruling_reanchor.py
   :language: python
   :lines: 94-112
   :lineno-match:

.. CG-EXPLANATION-START id=class:MatchedPairRuling

**What this does.** A frozen dataclass pairing a captured ruling with the two new anchor ids it will be re-created against, canonically ordered.

**Why it is here.** It records the matched outcome so the re-anchor can insert the fresh row.

.. CG-EXPLANATION-END id=class:MatchedPairRuling

Class ``LostPairRuling`` — header
---------------------------------

.. CG-BLOCK id=class:LostPairRuling lines=113-132

.. literalinclude:: ../../../src/groundmodel/application/pair_ruling_reanchor.py
   :language: python
   :lines: 113-132
   :lineno-match:

.. CG-EXPLANATION-START id=class:LostPairRuling

**What this does.** A frozen dataclass for a ruling that could not be re-anchored, recording which anchors matched, with a one-line description.

**Why it is here.** A ruling with no review-flag column cannot defer the question to the engineer, so an uncarryable one is dropped and reported, never silent; both anchors matching to one band means the masses fused.

.. CG-EXPLANATION-END id=class:LostPairRuling

Method ``LostPairRuling``. ``def describe``
-------------------------------------------

.. CG-BLOCK id=method:LostPairRuling.describe lines=133-148

.. literalinclude:: ../../../src/groundmodel/application/pair_ruling_reanchor.py
   :language: python
   :lines: 133-148
   :lineno-match:

.. CG-EXPLANATION-START id=method:LostPairRuling.describe

**What this does.** Returns a one-line human description naming both anchors and the verdict.

**Why it is here.** So the warning log names exactly what was lost and why.

.. CG-EXPLANATION-END id=method:LostPairRuling.describe

Class ``PairRulingReanchorPlan``
--------------------------------

.. CG-BLOCK id=class:PairRulingReanchorPlan lines=149-175

.. literalinclude:: ../../../src/groundmodel/application/pair_ruling_reanchor.py
   :language: python
   :lines: 149-175
   :lineno-match:

.. CG-EXPLANATION-START id=class:PairRulingReanchorPlan

**What this does.** A dataclass carrying the matched rulings, the losses, the count of duplicates skipped, and the satisfied rulings (a union's fused case).

**Why it is here.** It is the outcome of matching captured rulings against the rebuilt bands; the satisfied list is always empty for a separation.

.. CG-EXPLANATION-END id=class:PairRulingReanchorPlan

Function ``def _describe_identity``
-----------------------------------

.. CG-BLOCK id=function:_describe_identity lines=176-184

.. literalinclude:: ../../../src/groundmodel/application/pair_ruling_reanchor.py
   :language: python
   :lines: 176-184
   :lineno-match:

.. CG-EXPLANATION-START id=function:_describe_identity

**What this does.** Renders a band identity for a log line.

**Why it is here.** A small formatter so the loss and satisfied logs read in the engineer's own investigation-and-depth terms.

.. CG-EXPLANATION-END id=function:_describe_identity

Function ``def _match_anchor``
------------------------------

.. CG-BLOCK id=function:_match_anchor lines=185-222

.. literalinclude:: ../../../src/groundmodel/application/pair_ruling_reanchor.py
   :language: python
   :lines: 185-222
   :lineno-match:

.. CG-EXPLANATION-START id=function:_match_anchor

**What this does.** Finds the rebuilt band an anchor re-anchors onto: an exact three-part identity match first, then the single same-class band overlapping where the anchor was, or nothing.

**Why it is here.** Tier one is a band that came back untouched, tier two is the same band with a boundary dragged; nothing overlapping or several candidates is uncarryable, so it returns nothing and the ruling is dropped rather than risking the wrong mass.

.. CG-EXPLANATION-END id=function:_match_anchor

Function ``def plan_pair_ruling_reanchor``
------------------------------------------

.. CG-BLOCK id=function:plan_pair_ruling_reanchor lines=223-288

.. literalinclude:: ../../../src/groundmodel/application/pair_ruling_reanchor.py
   :language: python
   :lines: 223-288
   :lineno-match:

.. CG-EXPLANATION-START id=function:plan_pair_ruling_reanchor

**What this does.** Matches every captured ruling onto the rebuilt bands, sorting each into matched, lost, satisfied or duplicate-skipped, with the fused-pair verdict decided by the moot-is-loss flag.

**Why it is here.** A separation counts a fused pair as lost (a body cannot be separated from itself) while a union counts it satisfied (the masses already merged); a pair another ruling already claimed is skipped, making the database uniqueness visible rather than raised.

.. CG-EXPLANATION-END id=function:plan_pair_ruling_reanchor

Class ``_PairRulingReanchor`` — header
--------------------------------------

.. CG-BLOCK id=class:_PairRulingReanchor lines=289-317

.. literalinclude:: ../../../src/groundmodel/application/pair_ruling_reanchor.py
   :language: python
   :lines: 289-317
   :lineno-match:

.. CG-EXPLANATION-START id=class:_PairRulingReanchor

**What this does.** The verb-agnostic base that captures rulings before a reset and re-anchors them after, parameterised by three class attributes the two verbs set.

**Why it is here.** Capture runs before the layer wipe and re-anchor after the rebuild, in the same transaction the caller commits once; the plumbing is shared so the two verbs cannot drift.

.. CG-EXPLANATION-END id=class:_PairRulingReanchor

Method ``_PairRulingReanchor``. ``def __init__``
------------------------------------------------

.. CG-BLOCK id=method:_PairRulingReanchor.__init__ lines=318-322

.. literalinclude:: ../../../src/groundmodel/application/pair_ruling_reanchor.py
   :language: python
   :lines: 318-322
   :lineno-match:

.. CG-EXPLANATION-START id=method:_PairRulingReanchor.__init__

**What this does.** Stores the session.

**Why it is here.** The caller owns the session; this base writes through it.

.. CG-EXPLANATION-END id=method:_PairRulingReanchor.__init__

Method ``_PairRulingReanchor``. ``async def capture``
-----------------------------------------------------

.. CG-BLOCK id=method:_PairRulingReanchor.capture lines=323-440

.. literalinclude:: ../../../src/groundmodel/application/pair_ruling_reanchor.py
   :language: python
   :lines: 323-440
   :lineno-match:

.. CG-EXPLANATION-START id=method:_PairRulingReanchor.capture

**What this does.** Records every ruling of a model with its anchors' band identities, optionally restricting to an anchor kind or a set of investigations, skipping and warning about a ruling with an unresolvable anchor.

**Why it is here.** It must run before the reset because the anchors are gone afterwards; the restrictions mirror the tie capture so a ruling neither anchor of which the rebuild touches is not captured and later doubled.

.. CG-EXPLANATION-END id=method:_PairRulingReanchor.capture

Method ``_PairRulingReanchor``. ``async def reanchor``
------------------------------------------------------

.. CG-BLOCK id=method:_PairRulingReanchor.reanchor lines=441-517

.. literalinclude:: ../../../src/groundmodel/application/pair_ruling_reanchor.py
   :language: python
   :lines: 441-517
   :lineno-match:

.. CG-EXPLANATION-START id=method:_PairRulingReanchor.reanchor

**What this does.** Re-creates the captured rulings against the rebuilt bands, warning about each loss, reporting each union satisfied by geometry at info, and skipping duplicates.

**Why it is here.** A lost ruling is logged with both anchors' identities and counted, never silent; a fused union is honoured by geometry and reported at info rather than as the warning loss a separation records.

.. CG-EXPLANATION-END id=method:_PairRulingReanchor.reanchor

Method ``_PairRulingReanchor``. ``async def _load_existing_keys``
-----------------------------------------------------------------

.. CG-BLOCK id=method:_PairRulingReanchor._load_existing_keys lines=518-539

.. literalinclude:: ../../../src/groundmodel/application/pair_ruling_reanchor.py
   :language: python
   :lines: 518-539
   :lineno-match:

.. CG-EXPLANATION-START id=method:_PairRulingReanchor._load_existing_keys

**What this does.** Loads the canonical anchor pairs already present for the model.

**Why it is here.** So the re-anchor never inserts a duplicate the reset's cascade left behind — cheap re-reading that makes the pass safe to call anywhere.

.. CG-EXPLANATION-END id=method:_PairRulingReanchor._load_existing_keys

