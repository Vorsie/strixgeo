desktop.main.diagnosticsEvent
=============================

.. CG-PAGE source=desktop/src/main/diagnosticsEvent.ts complete=true

*Source file:* ``desktop/src/main/diagnosticsEvent.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-25

.. literalinclude:: ../../../desktop/src/main/diagnosticsEvent.ts
   :language: typescript
   :lines: 1-25
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The docstring explains the file's single job: it defines the
exact *shape* of one captured problem — one crash, one unhandled error, one
backend failure — and the rule that builds it. A capture site somewhere in the
app hands over a loose bag of information; a function further down (called
``normaliseDiagnosticEvent``) decides which parts of it survive into the record.
The only ``import`` is the pair of redaction helpers, which scrub personal data
out of the text before it is kept.

**Why it is here.** The docstring makes the key design choice plain. The
*renderer* — the web page the user sees, which runs React, the 3D map, and every
parser's output — is the least trusted part of the app. So rather than trying to
*scrub what looks sensitive* (which fails the first time an unexpected object
slips through), the code uses a *whitelist*: only named, expected fields are
copied in, and anything unrecognised is simply **absent**, never guessed at.
Second, a renderer cannot be trusted to state facts about the machine — so the
app version, the operating system, the build id and the timestamp are stamped by
the trusted main process, and a faked renderer message cannot make a report
claim to come from a different build.

.. CG-EXPLANATION-END id=module-header

``type DiagnosticSource``
-------------------------

.. CG-BLOCK id=type:DiagnosticSource lines=26-28

.. literalinclude:: ../../../desktop/src/main/diagnosticsEvent.ts
   :language: typescript
   :lines: 26-28
   :lineno-match:

.. CG-EXPLANATION-START id=type:DiagnosticSource

**What this does.** Declares that the "source" of a problem is one of exactly
three words: ``main``, ``renderer`` or ``api`` — which part of the app noticed
it. A TypeScript ``type`` like this is just a note that constrains a value to a
fixed set of choices.

**Why it is here.** The source is decided by the code that captures the problem,
never read from the untrusted payload — so it is pinned to a small, known list.

.. CG-EXPLANATION-END id=type:DiagnosticSource

``type DiagnosticSeverity``
---------------------------

.. CG-BLOCK id=type:DiagnosticSeverity lines=29-37

.. literalinclude:: ../../../desktop/src/main/diagnosticsEvent.ts
   :language: typescript
   :lines: 29-37
   :lineno-match:

.. CG-EXPLANATION-START id=type:DiagnosticSeverity

**What this does.** Declares that "how bad was it" is one of three words:
``warning``, ``error`` or ``fatal``.

**Why it is here.** Three fixed levels are enough to sort a support log without
inventing a scale, and pinning them to a fixed set keeps the field tidy.

.. CG-EXPLANATION-END id=type:DiagnosticSeverity

``const DIAGNOSTIC_KINDS``
--------------------------

.. CG-BLOCK id=const:DIAGNOSTIC_KINDS lines=38-52

.. literalinclude:: ../../../desktop/src/main/diagnosticsEvent.ts
   :language: typescript
   :lines: 38-52
   :lineno-match:

.. CG-EXPLANATION-START id=const:DIAGNOSTIC_KINDS

**What this does.** Lists every recognised *kind* of problem: a main-process
crash, an uncaught promise rejection, a dead or unresponsive renderer, a
renderer error, a backend 5xx (``api-error``) or 4xx refusal (``api-refusal``),
a backend that failed to start, and the catch-all ``unknown``.

**Why it is here.** The docstring gives the reason: a *closed* list lets the log
be grouped and counted without reading free text, and — crucially — anything the
renderer sends that is not on this list collapses to ``unknown`` rather than
letting a renderer-supplied word be written straight into the file. It is the
same fail-closed instinct as the whitelist.

.. CG-EXPLANATION-END id=const:DIAGNOSTIC_KINDS

``type DiagnosticKind``
-----------------------

.. CG-BLOCK id=type:DiagnosticKind lines=53-54

.. literalinclude:: ../../../desktop/src/main/diagnosticsEvent.ts
   :language: typescript
   :lines: 53-54
   :lineno-match:

.. CG-EXPLANATION-START id=type:DiagnosticKind

**What this does.** Turns the list above into a type meaning "exactly one of
those kinds", so the rest of the file is checked against it automatically.

**Why it is here.** It keeps the list of kinds in one place — the type is derived
from the constant, so the two can never drift apart.

.. CG-EXPLANATION-END id=type:DiagnosticKind

``const KIND_SET``
------------------

.. CG-BLOCK id=const:KIND_SET lines=55-55

.. literalinclude:: ../../../desktop/src/main/diagnosticsEvent.ts
   :language: typescript
   :lines: 55-55
   :lineno-match:

.. CG-EXPLANATION-START id=const:KIND_SET

**What this does.** Builds a ``Set`` — a collection made for fast "is this one of
them?" checks — from the list of kinds.

**Why it is here.** A quick membership lookup, used just below to decide whether
an incoming kind is recognised or should fall back to ``unknown``.

.. CG-EXPLANATION-END id=const:KIND_SET

``const SEVERITY_SET``
----------------------

.. CG-BLOCK id=const:SEVERITY_SET lines=56-64

.. literalinclude:: ../../../desktop/src/main/diagnosticsEvent.ts
   :language: typescript
   :lines: 56-64
   :lineno-match:

.. CG-EXPLANATION-START id=const:SEVERITY_SET

**What this does.** Builds the same kind of fast-lookup ``Set`` for the three
severities. The comment that follows begins describing the next value — what a
*scope* (a short module label) is allowed to look like.

**Why it is here.** So the severity coming in can be checked against the known
three just as quickly, falling back to a default when it is not one of them.

.. CG-EXPLANATION-END id=const:SEVERITY_SET

``const SCOPE_PATTERN``
-----------------------

.. CG-BLOCK id=const:SCOPE_PATTERN lines=65-67

.. literalinclude:: ../../../desktop/src/main/diagnosticsEvent.ts
   :language: typescript
   :lines: 65-67
   :lineno-match:

.. CG-EXPLANATION-START id=const:SCOPE_PATTERN

**What this does.** A *pattern* (a rule for matching text) that a scope must fit:
letters, digits, and a few punctuation marks, up to 40 characters, and nothing
else — no spaces, no slashes.

**Why it is here.** A scope is meant to be a short module tag like ``api``,
``sections`` or ``boot``. As the comment says, anything containing a space or a
separator is not a scope at all — it is a file path or a whole sentence that
leaked into the wrong field — so the pattern rejects it and the value falls back
to ``unknown``.

.. CG-EXPLANATION-END id=const:SCOPE_PATTERN

``const UNKNOWN_SCOPE``
-----------------------

.. CG-BLOCK id=const:UNKNOWN_SCOPE lines=68-70

.. literalinclude:: ../../../desktop/src/main/diagnosticsEvent.ts
   :language: typescript
   :lines: 68-70
   :lineno-match:

.. CG-EXPLANATION-START id=const:UNKNOWN_SCOPE

**What this does.** The single word ``unknown``, used whenever a scope is missing
or does not fit the pattern above.

**Why it is here.** A named fallback so every "we could not tell which module"
case writes the same value, rather than an empty field or a leaked stray string.

.. CG-EXPLANATION-END id=const:UNKNOWN_SCOPE

``interface DiagnosticEvent``
-----------------------------

.. CG-BLOCK id=interface:DiagnosticEvent lines=71-96

.. literalinclude:: ../../../desktop/src/main/diagnosticsEvent.ts
   :language: typescript
   :lines: 71-96
   :lineno-match:

.. CG-EXPLANATION-START id=interface:DiagnosticEvent

**What this does.** The exact list of fields one captured problem carries into
the log: the timestamp, which process saw it, its kind and severity, its module
scope, the redacted message, and — only when supplied — a redacted stack trace
and an HTTP status. Then the three machine facts the main process stamps: app
version, platform, and (when the build has one) the beta build id. A ``?`` after
a field name means it is optional.

**Why it is here.** This is the *whitelist* itself, written as a shape. Nothing
outside these fields is ever written; every capture path funnels into this one
record so a support bundle always has the same, predictable columns and never a
surprise field carrying something it should not.

.. CG-EXPLANATION-END id=interface:DiagnosticEvent

``interface DiagnosticContext``
-------------------------------

.. CG-BLOCK id=interface:DiagnosticContext lines=97-108

.. literalinclude:: ../../../desktop/src/main/diagnosticsEvent.ts
   :language: typescript
   :lines: 97-108
   :lineno-match:

.. CG-EXPLANATION-START id=interface:DiagnosticContext

**What this does.** The bundle of environment facts the main process supplies to
stamp onto every event: the app version, the platform, an optional build id, and
an optional timestamp override.

**Why it is here.** These are exactly the facts a renderer must not be allowed to
set for itself. Passing them in as one object makes clear they come from the
trusted side. The timestamp override exists so a test can pin an exact time;
real runs leave it blank and the current time is used.

.. CG-EXPLANATION-END id=interface:DiagnosticContext

``function kindOf``
-------------------

.. CG-BLOCK id=function:kindOf lines=109-113

.. literalinclude:: ../../../desktop/src/main/diagnosticsEvent.ts
   :language: typescript
   :lines: 109-113
   :lineno-match:

.. CG-EXPLANATION-START id=function:kindOf

**What this does.** Takes whatever came in for "kind" and returns it only if it
is a recognised word from the list; otherwise returns ``unknown``.

**Why it is here.** The one gate that stops any renderer-supplied kind from
reaching the file verbatim.

.. CG-EXPLANATION-END id=function:kindOf

``function severityOf``
-----------------------

.. CG-BLOCK id=function:severityOf lines=114-120

.. literalinclude:: ../../../desktop/src/main/diagnosticsEvent.ts
   :language: typescript
   :lines: 114-120
   :lineno-match:

.. CG-EXPLANATION-START id=function:severityOf

**What this does.** Returns the severity if it is one of the three known words,
otherwise ``error``.

**Why it is here.** ``error`` is the sensible default because every place that
captures a problem is, by definition, reporting something that already went
wrong.

.. CG-EXPLANATION-END id=function:severityOf

``function scopeOf``
--------------------

.. CG-BLOCK id=function:scopeOf lines=121-125

.. literalinclude:: ../../../desktop/src/main/diagnosticsEvent.ts
   :language: typescript
   :lines: 121-125
   :lineno-match:

.. CG-EXPLANATION-START id=function:scopeOf

**What this does.** Returns the scope when it fits the module-label pattern,
otherwise the fallback ``unknown``.

**Why it is here.** So a path or a sentence that ended up in the scope field
never gets written there — it is quietly replaced with ``unknown``.

.. CG-EXPLANATION-END id=function:scopeOf

``function httpStatusOf``
-------------------------

.. CG-BLOCK id=function:httpStatusOf lines=126-152

.. literalinclude:: ../../../desktop/src/main/diagnosticsEvent.ts
   :language: typescript
   :lines: 126-152
   :lineno-match:

.. CG-EXPLANATION-START id=function:httpStatusOf

**What this does.** Accepts the HTTP status only when it is a whole number in the
real status range (100 to 599); anything else becomes "no status".

**Why it is here.** A backend failure carries a status like 500; a made-up or
out-of-range number is meaningless, so it is dropped rather than stored. This
keeps the field either a genuine status or absent.

.. CG-EXPLANATION-END id=function:httpStatusOf

``function normaliseDiagnosticEvent``
-------------------------------------

.. CG-BLOCK id=function:normaliseDiagnosticEvent lines=153-183

.. literalinclude:: ../../../desktop/src/main/diagnosticsEvent.ts
   :language: typescript
   :lines: 153-183
   :lineno-match:

.. CG-EXPLANATION-START id=function:normaliseDiagnosticEvent

**What this does.** The heart of the file. It takes the loose payload a capture
site handed over, the source word, and the stamped machine facts, and builds the
finished record — or returns nothing (``null``) when there is nothing worth
logging. It refuses a payload that is not an object; it redacts the message and,
separately, the stack; if the message comes out empty it returns ``null``; then
it assembles the record field by field, running each field through the guard
functions above and dropping the optional fields (stack, status, build id) when
they are absent.

**Why it is here.** The docstring flags the trap this guards against: even though
TypeScript labels the incoming argument, values arriving over IPC (the messaging
channel between the renderer and the main process) are truly anything at runtime,
so every field must be re-checked here — the type promise cannot be trusted.
Note the deliberate split: the *message* is the one field that can quote user
data (an error might name the formation or borehole it failed on), so it gets the
stronger ``redactMessage`` pass, while the *stack* quotes nothing and uses the
plain ``redactText``. An empty record is refused because a blank line is just
noise in a bounded support file.

.. CG-EXPLANATION-END id=function:normaliseDiagnosticEvent

