desktop.main.embedded.pgDsn
===========================

.. CG-PAGE source=desktop/src/main/embedded/pgDsn.ts complete=true

*Source file:* ``desktop/src/main/embedded/pgDsn.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-11

.. literalinclude:: ../../../desktop/src/main/embedded/pgDsn.ts
   :language: typescript
   :lines: 1-11
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Introduces the file that builds database *connection strings* — the single line of text, such as ``postgresql://user:password@host:port/database``, that tells a program how to reach a database.

**Why it is here.** Two different flavours of that line are needed and they are NOT interchangeable: the Python backend (through its database library, SQLAlchemy) wants a ``+asyncpg`` marker naming its driver, while PostgreSQL's own command-line tools reject that marker. Building both here, side by side, keeps their encoding rules from drifting apart over time.

.. CG-EXPLANATION-END id=module-header

``interface PgConnection``
--------------------------

.. CG-BLOCK id=interface:PgConnection lines=12-26

.. literalinclude:: ../../../desktop/src/main/embedded/pgDsn.ts
   :language: typescript
   :lines: 12-26
   :lineno-match:

.. CG-EXPLANATION-START id=interface:PgConnection

**What this does.** Names the five pieces needed to reach one database — host, port, user, password and database name. The comment beneath opens the description of the ``authority`` helper in the next block.

**Why it is here.** Passing these five as one named object (rather than five loose arguments) means the two connection-string builders below cannot accidentally put them in a different order or forget one.

.. CG-EXPLANATION-END id=interface:PgConnection

``function authority``
----------------------

.. CG-BLOCK id=function:authority lines=27-39

.. literalinclude:: ../../../desktop/src/main/embedded/pgDsn.ts
   :language: typescript
   :lines: 27-39
   :lineno-match:

.. CG-EXPLANATION-START id=function:authority

**What this does.** Builds the shared middle of both connection strings — the ``user:password@host:port/database`` part. It *percent-encodes* the user and password first, replacing awkward characters with a ``%`` code, before stitching them in.

**Why it is here.** The database password is generated fresh for each install, so it can contain characters that mean something special inside a URL. An unencoded ``@`` in the password, for example, would look like the separator between the credentials and the host, and the backend would try to reach a machine nobody configured. Encoding the user and password removes that whole class of failure, and both builders share this one helper so they encode identically.

.. CG-EXPLANATION-END id=function:authority

``function buildSqlAlchemyDsn``
-------------------------------

.. CG-BLOCK id=function:buildSqlAlchemyDsn lines=40-49

.. literalinclude:: ../../../desktop/src/main/embedded/pgDsn.ts
   :language: typescript
   :lines: 40-49
   :lineno-match:

.. CG-EXPLANATION-START id=function:buildSqlAlchemyDsn

**What this does.** Produces the connection string the Python backend reads from its ``DATABASE_URL`` setting — a ``postgresql+asyncpg://`` URL, with the shared middle supplied by ``authority``.

**Why it is here.** SQLAlchemy picks its async driver from the ``+asyncpg`` marker in the address, so the string the backend is handed must carry it.

.. CG-EXPLANATION-END id=function:buildSqlAlchemyDsn

``function buildLibpqUri``
--------------------------

.. CG-BLOCK id=function:buildLibpqUri lines=50-67

.. literalinclude:: ../../../desktop/src/main/embedded/pgDsn.ts
   :language: typescript
   :lines: 50-67
   :lineno-match:

.. CG-EXPLANATION-START id=function:buildLibpqUri

**What this does.** Produces the plain ``postgresql://`` connection string — no driver marker — that PostgreSQL's own command-line tools accept. The comment that follows opens the description of ``redactPasswords`` below.

**Why it is here.** Tools such as ``pg_isready`` and ``psql`` (used during boot to check the server is up) reject the ``+asyncpg`` marker the backend needs, so they get their own driver-free flavour of the same address.

.. CG-EXPLANATION-END id=function:buildLibpqUri

``function redactPasswords``
----------------------------

.. CG-BLOCK id=function:redactPasswords lines=68-70

.. literalinclude:: ../../../desktop/src/main/embedded/pgDsn.ts
   :language: typescript
   :lines: 68-70
   :lineno-match:

.. CG-EXPLANATION-START id=function:redactPasswords

**What this does.** Scans any text for a PostgreSQL connection string and replaces the password inside it with ``***``, leaving everything else intact.

**Why it is here.** This is run over anything that might reach a log file or an on-screen dialog. Error messages shown to the user are built from a child program's error output, and SQLAlchemy's own URL-parse errors quote the entire connection string — password included. Without this, the only thing keeping the generated password off the screen would be the lucky fact that today's password alphabet never happens to produce an unparseable URL — a coincidence, as the comment stresses, not a safeguard. This is redaction for logs and dialogs, not a security wall around the password itself.

.. CG-EXPLANATION-END id=function:redactPasswords

