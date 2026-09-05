desktop.main.embedded.installSecrets
====================================

.. CG-PAGE source=desktop/src/main/embedded/installSecrets.ts complete=true

*Source file:* ``desktop/src/main/embedded/installSecrets.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-28

.. literalinclude:: ../../../desktop/src/main/embedded/installSecrets.ts
   :language: typescript
   :lines: 1-28
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This is the file's *docstring* — a long comment for whoever reads the code. It explains that a packaged install generates two secrets for itself, once, and keeps them together in one file because they share a lifecycle. The first is the *database password* — the code that logs into the bundled PostgreSQL database. The second is the backend's ``SECRET_KEY`` — a secret string the Python backend uses to sign and protect its own internal tokens. Both are created on the very first launch and simply read back on every launch after.

**Why it is here.** The development stack ships a fixed, well-known username and password (``groundmodel:groundmodel``), which is perfectly fine for a database that only listens to one developer's own machine but is not fine on a shared office computer, where any other local account could otherwise open the database and read every project. And a packaged build runs in production mode, under which the backend deliberately refuses to start on the placeholder ``change-me`` key that ships in the source — correctly, because a constant baked into every copy of a distributed program is not a secret at all. Generating a unique password and key per install is the fix for both.

.. CG-EXPLANATION-END id=module-header

``const SECRET_ALPHABET``
-------------------------

.. CG-BLOCK id=const:SECRET_ALPHABET lines=29-32

.. literalinclude:: ../../../desktop/src/main/embedded/installSecrets.ts
   :language: typescript
   :lines: 29-32
   :lineno-match:

.. CG-EXPLANATION-START id=const:SECRET_ALPHABET

**What this does.** Defines the exact set of characters a generated secret may be built from — the upper- and lower-case letters and the digits, 62 symbols in all, and nothing else.

**Why it is here.** The set is deliberately narrow. The password later travels inside a database connection URL and is also handed to the database initialiser through a password file, and in both places a punctuation character like a quote or a backslash is exactly the kind of thing that works on nine machines and quietly corrupts the tenth. Sticking to plain letters and digits sidesteps every such quoting hazard, and 62 possible symbols across 32 characters still gives roughly 190 bits of unguessable strength.

.. CG-EXPLANATION-END id=const:SECRET_ALPHABET

``const SECRET_LENGTH``
-----------------------

.. CG-BLOCK id=const:SECRET_LENGTH lines=33-35

.. literalinclude:: ../../../desktop/src/main/embedded/installSecrets.ts
   :language: typescript
   :lines: 33-35
   :lineno-match:

.. CG-EXPLANATION-START id=const:SECRET_LENGTH

**What this does.** Sets the default length of a generated secret to 32 characters.

**Why it is here.** Thirty-two characters drawn from the 62-symbol set is far more than enough to make a secret impossible to guess, so this single named value fixes the length in one place rather than scattering the number through the code.

.. CG-EXPLANATION-END id=const:SECRET_LENGTH

``const DATABASE_USER``
-----------------------

.. CG-BLOCK id=const:DATABASE_USER lines=36-38

.. literalinclude:: ../../../desktop/src/main/embedded/installSecrets.ts
   :language: typescript
   :lines: 36-38
   :lineno-match:

.. CG-EXPLANATION-START id=const:DATABASE_USER

**What this does.** Fixes the database role (the login name) the app owns and connects as: ``strixgeo``.

**Why it is here.** The username is not a secret — only the password is — so it is a fixed, readable constant, kept here beside the other database facts so there is one obvious place to find it.

.. CG-EXPLANATION-END id=const:DATABASE_USER

``const DATABASE_NAME``
-----------------------

.. CG-BLOCK id=const:DATABASE_NAME lines=39-41

.. literalinclude:: ../../../desktop/src/main/embedded/installSecrets.ts
   :language: typescript
   :lines: 39-41
   :lineno-match:

.. CG-EXPLANATION-START id=const:DATABASE_NAME

**What this does.** Fixes the name of the database the app's schema and data live in: ``groundmodel``.

**Why it is here.** Like the username, the database name is a fixed, non-secret value; naming it once here keeps it consistent everywhere the app builds a connection string.

.. CG-EXPLANATION-END id=const:DATABASE_NAME

``interface InstallSecrets``
----------------------------

.. CG-BLOCK id=interface:InstallSecrets lines=42-50

.. literalinclude:: ../../../desktop/src/main/embedded/installSecrets.ts
   :language: typescript
   :lines: 42-50
   :lineno-match:

.. CG-EXPLANATION-START id=interface:InstallSecrets

**What this does.** Describes the shape of one install's secrets. An *interface* is a written description of the fields a value must carry: here the ``user`` (login name), the ``password``, the ``database`` name, and the ``secretKey`` handed to the backend.

**Why it is here.** Grouping the four related values into one named record means every part of the boot that needs a credential passes around a single, clearly-typed object instead of four loose strings that could be mixed up.

.. CG-EXPLANATION-END id=interface:InstallSecrets

``interface SecretsIo``
-----------------------

.. CG-BLOCK id=interface:SecretsIo lines=51-58

.. literalinclude:: ../../../desktop/src/main/embedded/installSecrets.ts
   :language: typescript
   :lines: 51-58
   :lineno-match:

.. CG-EXPLANATION-START id=interface:SecretsIo

**What this does.** Describes the pair of operations this file needs against the single secrets file: ``read``, which returns the file's contents or nothing when it does not yet exist, and ``write``, which creates or replaces the file.

**Why it is here.** By describing the file access as an abstract pair of operations rather than reaching for the disk directly, the decision logic can be driven in a test with an in-memory stand-in, and the real file access lives in one small, swappable place.

.. CG-EXPLANATION-END id=interface:SecretsIo

``type RandomBytes``
--------------------

.. CG-BLOCK id=type:RandomBytes lines=59-68

.. literalinclude:: ../../../desktop/src/main/embedded/installSecrets.ts
   :language: typescript
   :lines: 59-68
   :lineno-match:

.. CG-EXPLANATION-START id=type:RandomBytes

**What this does.** Describes a *source of cryptographically random bytes* — a function that, asked for a count, returns that many unpredictable bytes. Cryptographically random means the numbers are drawn from the operating system's secure randomness, not a predictable formula.

**Why it is here.** Passing the randomness source in, rather than calling the system generator directly, lets a test feed known bytes so a generated secret is exactly predictable, while production hands in Node's real secure generator.

.. CG-EXPLANATION-END id=type:RandomBytes

``function generateSecret``
---------------------------

.. CG-BLOCK id=function:generateSecret lines=69-93

.. literalinclude:: ../../../desktop/src/main/embedded/installSecrets.ts
   :language: typescript
   :lines: 69-93
   :lineno-match:

.. CG-EXPLANATION-START id=function:generateSecret

**What this does.** Builds one secret string of the requested length. It asks the random-byte source for that many bytes, and for each byte picks the character at that position within the safe alphabet (wrapping around if the byte is larger than the alphabet).

**Why it is here.** This is the single routine both secrets are minted from. Turning random bytes into characters strictly out of the narrow safe alphabet is what guarantees every generated secret is free of the quoting-hazard characters, no matter what raw bytes the generator produced.

.. CG-EXPLANATION-END id=function:generateSecret

``function loadOrCreateSecrets``
--------------------------------

.. CG-BLOCK id=function:loadOrCreateSecrets lines=94-121

.. literalinclude:: ../../../desktop/src/main/embedded/installSecrets.ts
   :language: typescript
   :lines: 94-121
   :lineno-match:

.. CG-EXPLANATION-START id=function:loadOrCreateSecrets

**What this does.** Returns this install's secrets, creating them on the first launch. If the file exists it parses it and returns the stored values; if only the ``secretKey`` is missing it mints a new one, writes it back, and returns the topped-up record; if the file does not exist at all it generates a fresh password and key, writes them, and returns them.

**Why it is here.** The two secrets are treated differently on purpose because only one of them is recoverable. The password is baked into the database when it is first created and can never be re-derived — so if the file exists but its password cannot be read, this routine throws rather than inventing a new one, because a silent replacement would lock the user out of a perfectly intact database. A missing key, by contrast, has protected nothing yet, so it is quietly regenerated rather than treated as corruption — refusing there would make a fully usable database unopenable over a secret nothing had used.

.. CG-EXPLANATION-END id=function:loadOrCreateSecrets

``function parseSecrets``
-------------------------

.. CG-BLOCK id=function:parseSecrets lines=122-143

.. literalinclude:: ../../../desktop/src/main/embedded/installSecrets.ts
   :language: typescript
   :lines: 122-143
   :lineno-match:

.. CG-EXPLANATION-START id=function:parseSecrets

**What this does.** Reads the stored secrets text as JSON (a standard text format for structured data) and validates it. If the text will not parse, or carries no usable password, it throws an error that names the exact file. Otherwise it returns the record, filling in the username and database name with their defaults if those happen to be absent, and treating a missing key as an empty string so the caller knows to top it up.

**Why it is here.** The password is the one field that cannot be defaulted or regenerated — it is the key to an existing database — so its absence is a hard failure that names the file, giving the user a concrete thing to act on. The username and database name are safe to default because they are fixed, non-secret constants, and the empty-string-means-absent convention for the key is what lets the caller distinguish a key that was never set from a real value.

.. CG-EXPLANATION-END id=function:parseSecrets

