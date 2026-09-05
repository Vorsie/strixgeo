desktop.main.unreachableActivationRepository
============================================

.. CG-PAGE source=desktop/src/main/unreachableActivationRepository.ts complete=true

*Source file:* ``desktop/src/main/unreachableActivationRepository.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-29

.. literalinclude:: ../../../desktop/src/main/unreachableActivationRepository.ts
   :language: typescript
   :lines: 1-29
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This is the file's opening note (a *docstring* — a comment for whoever reads the code) and the list of files it borrows from. It explains a third stand-in for the licence server, used in one specific situation: an installed (*packaged*) build that has no activation server address compiled into it. Recall that the app talks to the server through a *seam* — a fixed list of functions with more than one implementation behind it — and there are three implementations: the real HTTP one, an in-memory mock, and this one. The note explains that a development build with no server address quietly falls back to the mock (so the owner's daily use is unchanged), but an installed build must NOT, because the mock accepts the publicly-known demo keys and would "activate" on a key anyone could read. This file lives in Electron's *main process* (the part of the app with full computer access, as opposed to the sandboxed page the user sees).

**Why it is here.** It exists to make an installed build with no server fail safely instead of dangerously. It can grant nothing at all: every ``activate`` and ``startTrial`` answers ``unreachable`` (the same code the offline path already knows how to handle), and ``deactivate`` fails loudly rather than pretending to succeed. This encodes the owner's rule that a beta build runs on its own baked-in expiry stamp and never even reaches an activation server, while a real non-beta installed build simply cannot activate until the strixgeo.com server exists and its address is built in.

.. CG-EXPLANATION-END id=module-header

``const NO_ISSUER_MESSAGE``
---------------------------

.. CG-BLOCK id=const:NO_ISSUER_MESSAGE lines=30-35

.. literalinclude:: ../../../desktop/src/main/unreachableActivationRepository.ts
   :language: typescript
   :lines: 30-35
   :lineno-match:

.. CG-EXPLANATION-START id=const:NO_ISSUER_MESSAGE

**What this does.** Defines the single line of text, ``no activation server is configured for this build``, that every refusal from this file carries.

**Why it is here.** One shared, key-free message written once and reused by all three methods, so the wording is consistent and — carrying no licence key — is safe to write to a log.

.. CG-EXPLANATION-END id=const:NO_ISSUER_MESSAGE

``class UnreachableActivationRepository``
-----------------------------------------

.. CG-BLOCK id=class:UnreachableActivationRepository lines=36-56

.. literalinclude:: ../../../desktop/src/main/unreachableActivationRepository.ts
   :language: typescript
   :lines: 36-56
   :lineno-match:

.. CG-EXPLANATION-START id=class:UnreachableActivationRepository

**What this does.** The body of the file — the "grant nothing" stand-in. A *class* is a template bundling data with the functions that act on it. Its ``activate`` and ``startTrial`` both immediately return a failure with the code ``unreachable`` and the shared message. Its ``deactivate`` instead *throws* a typed ``DeactivateFailedError`` carrying a ``null`` status — the same shape a real network failure produces.

**Why it is here.** Returning ``unreachable`` from activate and start-trial reuses the exact outcome the offline path is already built around, so no new handling is needed anywhere. Deactivate is made to fail loudly on purpose: there is no server to release the seat against, and a silent "success" would make the app think the seat was freed when it was not — stranding it. Throwing the ``null``-status error makes the layer above KEEP the local licence rather than half-transfer a seat that was never released (activation contract section 6).

.. CG-EXPLANATION-END id=class:UnreachableActivationRepository

