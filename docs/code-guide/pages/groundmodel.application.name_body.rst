groundmodel.application.name_body
=================================

.. CG-PAGE source=src/groundmodel/application/name_body.py complete=true

*Source file:* ``src/groundmodel/application/name_body.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-32

.. literalinclude:: ../../../src/groundmodel/application/name_body.py
   :language: python
   :lines: 1-32
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the name-a-body file: a docstring plus the imports (the body-partition lock, the scope guard, and the ``BodyOrm``, formation and model row types). The docstring explains that a body is identified by its ``(formation_id, body_ordinal)`` pair, computed by the correlation resolver, and that this file creates or updates a small ``BodyOrm`` metadata row that only attaches a human-readable name — 'the row is NOT the body, it is decoration.'

**Why it is here.** Position 4 architecture (#101 R3): the body's identity lives in the correlation graph, so the name is stored on a separate row and the operation is *idempotent* — naming the same (model, formation, ordinal) triple twice updates the one row in place rather than making a second. The docstring notes the class was formerly ``NameLensBody`` (a rename), so older notes may use the old name.

.. CG-EXPLANATION-END id=module-header

Class ``NameBodyResult``
------------------------

.. CG-BLOCK id=class:NameBodyResult lines=33-50

.. literalinclude:: ../../../src/groundmodel/application/name_body.py
   :language: python
   :lines: 33-50
   :lineno-match:

.. CG-EXPLANATION-START id=class:NameBodyResult

**What this does.** A frozen dataclass (a set-once data holder) returned by ``execute``: the ``BodyOrm`` row id (new or already existing) and a ``was_created`` flag saying whether a row was inserted or an existing one updated.

**Why it is here.** The desktop needs to know whether the name landed on a fresh row or an existing one. The docstring records that ``body_id`` was renamed from ``lens_id`` — the same lens-to-body rename that runs through this group.

.. CG-EXPLANATION-END id=class:NameBodyResult

Class ``NameBody`` — header
---------------------------

.. CG-BLOCK id=class:NameBody lines=51-59

.. literalinclude:: ../../../src/groundmodel/application/name_body.py
   :language: python
   :lines: 51-59
   :lineno-match:

.. CG-EXPLANATION-START id=class:NameBody

**What this does.** Opens the use-case class; its docstring states it takes an active database session.

**Why it is here.** It follows the same use-case shape as the rest of this group: the caller owns the session and this class does its reads and writes against it. It inherits ``GroundModelLogger`` for logging under this module's name.

.. CG-EXPLANATION-END id=class:NameBody

Method ``NameBody``. ``def __init__``
-------------------------------------

.. CG-BLOCK id=method:NameBody.__init__ lines=60-64

.. literalinclude:: ../../../src/groundmodel/application/name_body.py
   :language: python
   :lines: 60-64
   :lineno-match:

.. CG-EXPLANATION-START id=method:NameBody.__init__

**What this does.** Stores the handed-in session and names the logger after this module.

**Why it is here.** The caller owns the session so the whole naming shares the caller's transaction; ``__name__`` makes the log lines read as coming from this use case.

.. CG-EXPLANATION-END id=method:NameBody.__init__

Method ``NameBody``. ``async def execute``
------------------------------------------

.. CG-BLOCK id=method:NameBody.execute lines=65-176

.. literalinclude:: ../../../src/groundmodel/application/name_body.py
   :language: python
   :lines: 65-176
   :lineno-match:

.. CG-EXPLANATION-START id=method:NameBody.execute

**What this does.** Logs the request; runs the scope guards that confirm the model and the formation both belong to the named project; takes the body-partition lock; looks for an existing metadata row for this (model, formation, ordinal); if one exists it updates the name (and the primary section if supplied) and commits; otherwise it inserts a new ``BodyOrm`` row and commits; then returns the row id and a creation flag.

**Why it is here.** The *scope guard* refuses a model or formation id that is not in the named project — a guard against reaching across projects by guessing ids. The lock is taken because the correlation resolver inserts the same (model, formation, ordinal) triples this verb does, so an unguarded insert here would collide on the uniqueness rule that pins one row per triple (audit 2026-08-23). The find-then-update path is the idempotency the docstring promises: re-naming the same body never duplicates the row. The primary section is stored so the perpendicular-companion use case can later find the section the naming gesture came from.

.. CG-EXPLANATION-END id=method:NameBody.execute

