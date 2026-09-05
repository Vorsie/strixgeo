desktop.main.diagnosticsRedaction
=================================

.. CG-PAGE source=desktop/src/main/diagnosticsRedaction.ts complete=true

*Source file:* ``desktop/src/main/diagnosticsRedaction.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-53

.. literalinclude:: ../../../desktop/src/main/diagnosticsRedaction.ts
   :language: typescript
   :lines: 1-53
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This is the whole plan for the file, written as a long
comment. The file's job is *redaction* — blanking out sensitive text before it
is ever stored or sent. The one-sentence version: a crash report may say **what**
broke, but it must never say **who** the engineer is or **which site** they were
working on. Those are the two things a geotechnical consultancy cannot let leave
the building, and the usual reason their IT refuses a "just email us the log"
request. The comment then lays out, as a table, every pattern the pass strips
(database connection strings, file URLs, data-file paths, user names, email
addresses, real network addresses, URL query strings, coordinate pairs) and what
it deliberately keeps.

**Why it is here.** The docstring is careful to call this a *defence-in-depth*
layer, not the main control. The main control is the field whitelist over in
``diagnosticsEvent.ts`` — nothing reaches this function unless a capture site put
it there on purpose. This pass is the second net under that one. Two decisions
are worth reading twice. Record ids (UUIDs) are kept on purpose: they carry no
name or location, and they are the only way to answer "which record was it?" in
a follow-up — flagged as a decision the owner can reverse with one rule if a
customer ever objects. And ``127.0.0.1`` (the app's own backend address) is kept,
because it is a fact about our software, not about the user's network.

.. CG-EXPLANATION-END id=module-header

``const REDACTED_TEXT_CAP``
---------------------------

.. CG-BLOCK id=const:REDACTED_TEXT_CAP lines=54-56

.. literalinclude:: ../../../desktop/src/main/diagnosticsRedaction.ts
   :language: typescript
   :lines: 54-56
   :lineno-match:

.. CG-EXPLANATION-START id=const:REDACTED_TEXT_CAP

**What this does.** Sets the longest a single redacted string is allowed to be:
2000 characters.

**Why it is here.** As the comment says, two kilobytes comfortably holds a full
stack trace of about 25 frames. Anything longer is either a runaway loop or a
dump of some large data payload — neither belongs in a support bundle — so the
text is cut off at that length.

.. CG-EXPLANATION-END id=const:REDACTED_TEXT_CAP

``const TRUNCATION_MARKER``
---------------------------

.. CG-BLOCK id=const:TRUNCATION_MARKER lines=57-66

.. literalinclude:: ../../../desktop/src/main/diagnosticsRedaction.ts
   :language: typescript
   :lines: 57-66
   :lineno-match:

.. CG-EXPLANATION-START id=const:TRUNCATION_MARKER

**What this does.** The little tag — ``…[truncated]`` — added to the end of a
string that was cut off at the length cap. The comment below it begins describing
the next value, the list of code-file extensions.

**Why it is here.** So a reader can tell that a message was shortened and is not
missing its ending by accident.

.. CG-EXPLANATION-END id=const:TRUNCATION_MARKER

``const CODE_EXTENSIONS``
-------------------------

.. CG-BLOCK id=const:CODE_EXTENSIONS lines=67-95

.. literalinclude:: ../../../desktop/src/main/diagnosticsRedaction.ts
   :language: typescript
   :lines: 67-95
   :lineno-match:

.. CG-EXPLANATION-START id=const:CODE_EXTENSIONS

**What this does.** Lists the file extensions the pass treats as *code* rather
than as a document: ``js``, ``ts``, ``py``, ``exe``, ``dll``, ``html`` and the
like. The long comment that follows explains how the path-matching patterns
below are built.

**Why it is here.** This is the seam between two very different kinds of path. A
path that ends in one of these is part of a *stack trace* — a list of the code
files involved in a crash — and its folder structure is our own build layout,
which carries no user data; so from those only the user's name is removed and the
rest is kept readable. Every other path is treated as a document whose location
and name the user chose (a project file, a data file), so it is erased more
aggressively. The comment underneath then warns that a folder name can contain
spaces (``OneDrive - Acme NV``, a ``First Last`` user folder), which is why the
patterns stop at real delimiters and not at the first space — an earlier version
that stopped at the first space left the employer, client and surname sitting in
a "redacted" bundle.

.. CG-EXPLANATION-END id=const:CODE_EXTENSIONS

``const PATH_INNER``
--------------------

.. CG-BLOCK id=const:PATH_INNER lines=96-96

.. literalinclude:: ../../../desktop/src/main/diagnosticsRedaction.ts
   :language: typescript
   :lines: 96-96
   :lineno-match:

.. CG-EXPLANATION-START id=const:PATH_INNER

**What this does.** A building block of the path patterns: it describes the
characters allowed *inside* a file path — anything except a set of real
delimiters (quotes, pipes, angle brackets, parentheses, brackets, and any
whitespace other than a plain space).

**Why it is here.** Kept as its own named piece so the several path patterns
below all share the exact same idea of "what a path character is", rather than
each spelling it out and risking drift.

.. CG-EXPLANATION-END id=const:PATH_INNER

``const PATH_TAIL``
-------------------

.. CG-BLOCK id=const:PATH_TAIL lines=97-97

.. literalinclude:: ../../../desktop/src/main/diagnosticsRedaction.ts
   :language: typescript
   :lines: 97-97
   :lineno-match:

.. CG-EXPLANATION-START id=const:PATH_TAIL

**What this does.** The companion piece describing the *last* character of a
path: like ``PATH_INNER`` but it also forbids a trailing plain space.

**Why it is here.** It makes a matched path end on a real character, so trailing
spaces are trimmed off — a path that runs straight into following prose (like
``…x.gef (row 42)``) keeps the separator instead of swallowing it.

.. CG-EXPLANATION-END id=const:PATH_TAIL

``const PATH_BODY``
-------------------

.. CG-BLOCK id=const:PATH_BODY lines=98-99

.. literalinclude:: ../../../desktop/src/main/diagnosticsRedaction.ts
   :language: typescript
   :lines: 98-99
   :lineno-match:

.. CG-EXPLANATION-START id=const:PATH_BODY

**What this does.** Combines the two pieces above into "the body of a path": zero
or more inner characters ending on a tail character, and the whole thing is
optional.

**Why it is here.** Making the body optional lets even a bare root like ``C:\``
or an empty ``file://`` still match, so those are caught too and not left behind.

.. CG-EXPLANATION-END id=const:PATH_BODY

``const FILE_URL_RE``
---------------------

.. CG-BLOCK id=const:FILE_URL_RE lines=100-100

.. literalinclude:: ../../../desktop/src/main/diagnosticsRedaction.ts
   :language: typescript
   :lines: 100-100
   :lineno-match:

.. CG-EXPLANATION-START id=const:FILE_URL_RE

**What this does.** The pattern that matches a ``file://`` web-style address
followed by a path.

**Why it is here.** A ``file://`` URL spells out the full path to a project on
disk — client and site names and all — so it is one of the things replaced
wholesale (with ``<file-url>``).

.. CG-EXPLANATION-END id=const:FILE_URL_RE

``const WINDOWS_PATH_RE``
-------------------------

.. CG-BLOCK id=const:WINDOWS_PATH_RE lines=101-103

.. literalinclude:: ../../../desktop/src/main/diagnosticsRedaction.ts
   :language: typescript
   :lines: 101-103
   :lineno-match:

.. CG-EXPLANATION-START id=const:WINDOWS_PATH_RE

**What this does.** Matches a Windows path — a drive letter, a colon, a
backslash, then the path body (for example ``C:\Users\...``).

**Why it is here.** Windows paths are the most common shape in a Windows app's
crash, and they routinely carry a user name and a project location, so they must
be caught and handled.

.. CG-EXPLANATION-END id=const:WINDOWS_PATH_RE

``const POSIX_PATH_RE``
-----------------------

.. CG-BLOCK id=const:POSIX_PATH_RE lines=104-108

.. literalinclude:: ../../../desktop/src/main/diagnosticsRedaction.ts
   :language: typescript
   :lines: 104-108
   :lineno-match:

.. CG-EXPLANATION-START id=const:POSIX_PATH_RE

**What this does.** Matches a Linux/macOS ("POSIX") path — but only one that
starts at a real filesystem root such as ``/Users/``, ``/home/``, ``/var/`` or
``/Applications/``.

**Why it is here.** The comment gives the important reason it is anchored to
those roots: an API route like ``/cpt/import`` also starts with a slash, and
routes are among the most useful things in a diagnostic. Anchoring to real roots
means a route is never mistaken for a file path and blanked out.

.. CG-EXPLANATION-END id=const:POSIX_PATH_RE

``const WINDOWS_USER_RE``
-------------------------

.. CG-BLOCK id=const:WINDOWS_USER_RE lines=109-109

.. literalinclude:: ../../../desktop/src/main/diagnosticsRedaction.ts
   :language: typescript
   :lines: 109-109
   :lineno-match:

.. CG-EXPLANATION-START id=const:WINDOWS_USER_RE

**What this does.** Finds the user-folder name inside a Windows path — the one
segment right after ``C:\Users\`` — and stops at the next separator.

**Why it is here.** That single segment is the person's Windows account name.
This is the pattern used to replace just that segment with ``<user>`` while
keeping the rest of the path readable. The comment notes it deliberately stops at
a real separator, not the first space (a user folder can be ``First Last``), and
excludes angle brackets so an already-inserted ``<user>`` is never matched again.

.. CG-EXPLANATION-END id=const:WINDOWS_USER_RE

``const POSIX_USER_RE``
-----------------------

.. CG-BLOCK id=const:POSIX_USER_RE lines=110-110

.. literalinclude:: ../../../desktop/src/main/diagnosticsRedaction.ts
   :language: typescript
   :lines: 110-110
   :lineno-match:

.. CG-EXPLANATION-START id=const:POSIX_USER_RE

**What this does.** The same idea for Linux/macOS: the user-folder segment right
after ``/Users/`` or ``/home/``.

**Why it is here.** So the person's account name is replaced with ``<user>`` on
those systems too, matching the Windows rule.

.. CG-EXPLANATION-END id=const:POSIX_USER_RE

``const URL_QUERY_RE``
----------------------

.. CG-BLOCK id=const:URL_QUERY_RE lines=111-121

.. literalinclude:: ../../../desktop/src/main/diagnosticsRedaction.ts
   :language: typescript
   :lines: 111-121
   :lineno-match:

.. CG-EXPLANATION-START id=const:URL_QUERY_RE

**What this does.** Matches the *query string* part of a web address — everything
after the ``?``. The comment beneath introduces the exception list that follows.

**Why it is here.** A query string is where a URL carries names and ids as
parameters, so the pass replaces it with ``?<query>`` and keeps only the address
in front. The long comment sets up the one exception: some hosts (see the next
block) are public open data and are left untouched.

.. CG-EXPLANATION-END id=const:URL_QUERY_RE

``const OPEN_DATA_HOSTS``
-------------------------

.. CG-BLOCK id=const:OPEN_DATA_HOSTS lines=122-124

.. literalinclude:: ../../../desktop/src/main/diagnosticsRedaction.ts
   :language: typescript
   :lines: 122-124
   :lineno-match:

.. CG-EXPLANATION-START id=const:OPEN_DATA_HOSTS

**What this does.** The short list of web hosts whose data is public open data
and therefore exempt from the query-string strip — currently just
``dov.vlaanderen.be``. The comment underneath introduces the small helper that
checks it.

**Why it is here.** This records a direct owner ruling (2026-08-28: "all data
from DOV doesn't need any redaction whatsoever"). A DOV request carries its whole
diagnostic value in the query string — the layer, the bounding box, the record
key — and the records it names are published by the Flemish government and
readable by anyone, so scrubbing it would ruin every DOV import diagnosis while
protecting nothing. The exemption is matched on the host name specifically, so a
client project merely *called* something like "DOV-Antwerpen" is still redacted
normally.

.. CG-EXPLANATION-END id=const:OPEN_DATA_HOSTS

``function isOpenDataUrl``
--------------------------

.. CG-BLOCK id=function:isOpenDataUrl lines=125-131

.. literalinclude:: ../../../desktop/src/main/diagnosticsRedaction.ts
   :language: typescript
   :lines: 125-131
   :lineno-match:

.. CG-EXPLANATION-START id=function:isOpenDataUrl

**What this does.** Takes a URL, pulls out just its host name, lower-cases it, and
answers true when that host is one of the open-data hosts (or a sub-domain of
one). The comment at the end of this block belongs to the next value — it warns
that the backend prints its database connection string on startup.

**Why it is here.** It is the single yes/no test the query-strip and the quoted-
literal rules both consult before deciding to leave a DOV address alone. Checking
the host, not just the presence of the word "dov", is what keeps the exemption
tight.

.. CG-EXPLANATION-END id=function:isOpenDataUrl

``const DSN_RE``
----------------

.. CG-BLOCK id=const:DSN_RE lines=132-132

.. literalinclude:: ../../../desktop/src/main/diagnosticsRedaction.ts
   :language: typescript
   :lines: 132-132
   :lineno-match:

.. CG-EXPLANATION-START id=const:DSN_RE

**What this does.** Matches a database connection string — a "DSN" — such as one
beginning ``postgresql://`` or ``mysql://``, and everything after it.

**Why it is here.** As the comment above it explained, the backend prints its own
connection string on startup with the database *password* included, and that log
travels inside the crash bundle. This is the single most sensitive thing the pass
must remove, so it is matched by its scheme (which also covers future database
drivers without a new rule) and replaced with ``<dsn>``.

.. CG-EXPLANATION-END id=const:DSN_RE

``const EMAIL_RE``
------------------

.. CG-BLOCK id=const:EMAIL_RE lines=133-135

.. literalinclude:: ../../../desktop/src/main/diagnosticsRedaction.ts
   :language: typescript
   :lines: 133-135
   :lineno-match:

.. CG-EXPLANATION-START id=const:EMAIL_RE

**What this does.** Matches an email address. The comment after it introduces the
next value, the network-address rule.

**Why it is here.** An email address names a person, so it is replaced with
``<email>``.

.. CG-EXPLANATION-END id=const:EMAIL_RE

``const IPV4_RE``
-----------------

.. CG-BLOCK id=const:IPV4_RE lines=136-138

.. literalinclude:: ../../../desktop/src/main/diagnosticsRedaction.ts
   :language: typescript
   :lines: 136-138
   :lineno-match:

.. CG-EXPLANATION-START id=const:IPV4_RE

**What this does.** Matches a numeric network address (an IPv4 address like
``192.168.1.5``) — but specifically *not* the loopback address ``127.0.0.1``. The
comment after it introduces the coordinate rule.

**Why it is here.** A routable network address is a fact about the user's network,
so it is replaced with ``<ip>``. Loopback is excluded because it is the app's own
backend, not a fact about the user. The exclusion is written so that a genuine
address like ``127.0.0.10`` is still redacted.

.. CG-EXPLANATION-END id=const:IPV4_RE

``const COORDINATE_PAIR_RE``
----------------------------

.. CG-BLOCK id=const:COORDINATE_PAIR_RE lines=139-140

.. literalinclude:: ../../../desktop/src/main/diagnosticsRedaction.ts
   :language: typescript
   :lines: 139-140
   :lineno-match:

.. CG-EXPLANATION-START id=const:COORDINATE_PAIR_RE

**What this does.** Matches a pair of numbers of the shape a projected map
coordinate takes — four to seven whole digits, a decimal part, twice, separated
by a comma. The comment after it introduces the extension rule.

**Why it is here.** A coordinate pair pins the exact site the engineer was working
on (the comment names the local grids: Lambert 72, RD, UTM), so it is replaced
with ``<coords>``. The digit shape is chosen so ordinary small numbers in a
message are not mistaken for a location.

.. CG-EXPLANATION-END id=const:COORDINATE_PAIR_RE

``const EXTENSION_RE``
----------------------

.. CG-BLOCK id=const:EXTENSION_RE lines=141-152

.. literalinclude:: ../../../desktop/src/main/diagnosticsRedaction.ts
   :language: typescript
   :lines: 141-152
   :lineno-match:

.. CG-EXPLANATION-START id=const:EXTENSION_RE

**What this does.** Matches a file extension — a dot followed by a short run of
letters or digits. The long comment beneath it introduces the quoted-literal
rules that come next.

**Why it is here.** It is how the code reads the extension off the end of a path
so it can decide, using ``CODE_EXTENSIONS`` above, whether that path is code (keep
the layout, strip the user) or a document (erase it). It is written to allow a
trailing ``:line:column`` suffix, the shape a JavaScript stack frame adds.

.. CG-EXPLANATION-END id=const:EXTENSION_RE

``const DOUBLE_QUOTED_RE``
--------------------------

.. CG-BLOCK id=const:DOUBLE_QUOTED_RE lines=153-153

.. literalinclude:: ../../../desktop/src/main/diagnosticsRedaction.ts
   :language: typescript
   :lines: 153-153
   :lineno-match:

.. CG-EXPLANATION-START id=const:DOUBLE_QUOTED_RE

**What this does.** Matches any text wrapped in double quotes.

**Why it is here.** Error messages quote the thing they failed on — a formation
"Boom Clay", a project, a borehole — in quotes. This is the pattern used (in the
message-only pass) to blank the inside of a double-quoted name while keeping the
quotes, so the report still shows a name *was* there.

.. CG-EXPLANATION-END id=const:DOUBLE_QUOTED_RE

``const BACKTICK_QUOTED_RE``
----------------------------

.. CG-BLOCK id=const:BACKTICK_QUOTED_RE lines=154-154

.. literalinclude:: ../../../desktop/src/main/diagnosticsRedaction.ts
   :language: typescript
   :lines: 154-154
   :lineno-match:

.. CG-EXPLANATION-START id=const:BACKTICK_QUOTED_RE

**What this does.** The same, for text wrapped in backticks.

**Why it is here.** Backticks are another way code quotes a value (a borehole
``kb-4711``), so they are covered too.

.. CG-EXPLANATION-END id=const:BACKTICK_QUOTED_RE

``const SINGLE_QUOTED_RE``
--------------------------

.. CG-BLOCK id=const:SINGLE_QUOTED_RE lines=155-157

.. literalinclude:: ../../../desktop/src/main/diagnosticsRedaction.ts
   :language: typescript
   :lines: 155-157
   :lineno-match:

.. CG-EXPLANATION-START id=const:SINGLE_QUOTED_RE

**What this does.** Matches text in single quotes — but only when both quotes sit
on a word boundary.

**Why it is here.** Single quotes are trickier: an English contraction like
``couldn't`` or ``it's`` would otherwise look like an opening quote and make the
pass mangle the rest of the sentence. The word-boundary condition means only a
real quoted value (``'Kanaal Noord'``) is caught, not an apostrophe inside a word.

.. CG-EXPLANATION-END id=const:SINGLE_QUOTED_RE

``function finalExtension``
---------------------------

.. CG-BLOCK id=function:finalExtension lines=158-171

.. literalinclude:: ../../../desktop/src/main/diagnosticsRedaction.ts
   :language: typescript
   :lines: 158-171
   :lineno-match:

.. CG-EXPLANATION-START id=function:finalExtension

**What this does.** Given a path, it finds the file name at the end (after the
last slash or backslash), reads every extension in it, and returns the last one
in lower case — or nothing when there is no extension.

**Why it is here.** This is the small helper that answers "what kind of file is
this path pointing at?", which the next function uses to choose between keeping a
code path and erasing a data path.

.. CG-EXPLANATION-END id=function:finalExtension

``function replacePath``
------------------------

.. CG-BLOCK id=function:replacePath lines=172-197

.. literalinclude:: ../../../desktop/src/main/diagnosticsRedaction.ts
   :language: typescript
   :lines: 172-197
   :lineno-match:

.. CG-EXPLANATION-START id=function:replacePath

**What this does.** Decides what one matched path becomes. If its extension is
one of the code extensions, it is a stack frame: only the user name is stripped
(with the two user rules) and the module layout is kept. Otherwise it is a
document, and the whole path is replaced by ``<path>`` — or ``<path:.strix>`` when
it has an extension, so the report still says what *kind* of file it was.

**Why it is here.** This is the single place the "keep code paths readable, erase
data paths" decision is made. It is kept as a named helper (rather than repeated
inline) because both the Windows and the Linux/macOS path rules need exactly this
same choice.

.. CG-EXPLANATION-END id=function:replacePath

``function redactText``
-----------------------

.. CG-BLOCK id=function:redactText lines=198-229

.. literalinclude:: ../../../desktop/src/main/diagnosticsRedaction.ts
   :language: typescript
   :lines: 198-229
   :lineno-match:

.. CG-EXPLANATION-START id=function:redactText

**What this does.** The main pass. It takes a piece of text and applies every
rule above in a fixed order: connection strings, then file URLs, then Windows and
Linux/macOS paths, then URL query strings (leaving open-data ones alone), then
emails, network addresses, and coordinate pairs. It then runs the user-name rules
once more over the whole string, and finally cuts the result to the length cap,
adding the truncation marker if it had to. A value that is not text at all comes
back as an empty string.

**Why it is here.** This is the redaction the stack traces use directly (the
message field gets one more pass on top). The order is deliberate — the broadest,
most sensitive matches first. The comment explains why the user rules run a
second time over the whole string: a home-directory name can also appear on its
own, outside a path shape (in a message that interpolated it), so a final sweep
catches those. Returning an empty string for a non-text value is safer than
letting a stray object (which might have been a data payload) be turned into text
and kept.

.. CG-EXPLANATION-END id=function:redactText

``function redactQuoted``
-------------------------

.. CG-BLOCK id=function:redactQuoted lines=230-235

.. literalinclude:: ../../../desktop/src/main/diagnosticsRedaction.ts
   :language: typescript
   :lines: 230-235
   :lineno-match:

.. CG-EXPLANATION-START id=function:redactQuoted

**What this does.** Replaces the contents of one quoted value with ``<redacted>``,
keeping the quote characters — unless the quoted content is an open-data (DOV)
URL, in which case it is left exactly as it was.

**Why it is here.** Keeping the quotes means the report still shows that a name
was present without revealing it. The DOV exception honours the same owner ruling
as the query-string rule: public open-data links need no redaction.

.. CG-EXPLANATION-END id=function:redactQuoted

``function redactQuotedLiterals``
---------------------------------

.. CG-BLOCK id=function:redactQuotedLiterals lines=236-264

.. literalinclude:: ../../../desktop/src/main/diagnosticsRedaction.ts
   :language: typescript
   :lines: 236-264
   :lineno-match:

.. CG-EXPLANATION-START id=function:redactQuotedLiterals

**What this does.** Runs the quoted-value replacement across a whole message in
one go, for all three quote styles — double, backtick, and single.

**Why it is here.** It is the extra step that only messages get (not stack
traces), because it is messages that quote the formation, project, and borehole
names an error interpolates. Bundling the three styles into one helper keeps the
message pass tidy.

.. CG-EXPLANATION-END id=function:redactQuotedLiterals

``function redactMessage``
--------------------------

.. CG-BLOCK id=function:redactMessage lines=265-269

.. literalinclude:: ../../../desktop/src/main/diagnosticsRedaction.ts
   :language: typescript
   :lines: 265-269
   :lineno-match:

.. CG-EXPLANATION-START id=function:redactMessage

**What this does.** The message-only pass: it first strips every quoted value,
then runs the full ``redactText`` pass on top. A non-text value comes back as an
empty string, exactly as with ``redactText``.

**Why it is here.** The message is the one field that can quote a user's data, so
it gets this stronger, two-step treatment. Stack frames do not quote anything, so
they stay on the plain ``redactText`` alone — this pairing is the split
``diagnosticsEvent.ts`` relies on when it redacts a captured event.

.. CG-EXPLANATION-END id=function:redactMessage

