Start here — how StrixGeo is put together
=========================================

This page is the map. Read it once and the rest of the guide will make sense,
because every other page is one file that lives somewhere on this map.

What the program is
-------------------

StrixGeo is a **desktop app**. When you double-click the icon, two programs
start up on your own computer and talk to each other:

* The **desktop window** you see and click — buttons, the map, the cross-section
  drawings. It is written in TypeScript and runs inside Electron (Electron is
  just a way to put a web page in a normal desktop window). This is the *front
  end*.
* A small **engine** running quietly in the background — it does the real work:
  reading CPT and borehole files, storing them, doing the calculations, writing
  export files. It is written in Python. This is the *back end*.

They talk over a tiny private web connection on your machine (``127.0.0.1`` means
"this computer only" — nothing goes out to the internet). Alongside the engine
runs a **PostgreSQL database**, which is where all your project data actually
lives. So the full picture is: *desktop window → engine → database → engine →
desktop window*.

This guide covers both halves. Groups 1-7 are the **engine** (the Python back
end). Groups 8-13 are the **desktop app** itself (the Electron main process and
the React window). Read the engine first, then the desktop — group 8 is what
runs the moment you double-click the icon.

The four layers
---------------

The engine is not one big pile of code. It is split into four layers, and the
rule is that **each layer may only depend on the one below it**::

    API            ← the front door: receives requests, checks them, replies
    Application    ← the recipes: one class per job ("import this CPT")
    Domain         ← the pure knowledge: geotechnical maths, no database
    Infrastructure ← the outside world: database, file parsers, exporters

Read that stack from the top:

* **API layer** (``src/groundmodel/api/``). This is the front door. The desktop
  window sends it a request ("give me project 7", "import this file"), the API
  checks the request is well-formed, calls the right recipe, and sends the answer
  back. It knows about the web (FastAPI) but nothing about geotechnics.
* **Application layer** (``src/groundmodel/application/``). One class per unit of
  work — "import a CPT", "subdivide all the bodies", "build the 3-D model". Think
  of each as a recipe that lists the steps and the order. It orchestrates; it
  does not itself know the geotechnical formulas or the exact SQL.
* **Domain layer** (``src/groundmodel/domain/``). The pure knowledge of the
  trade: the Robertson soil classification, the NAD packing-class lookup, the
  layer segmenter. These are plain functions and small data classes. **They never
  touch the database or the network** — you can run them on a piece of paper.
  That is deliberate: pure knowledge is the easiest thing to test and the least
  likely to break.
* **Infrastructure layer** (``src/groundmodel/infrastructure/``). Everything that
  deals with the messy outside world: the database tables and queries, the file
  parsers (GEF, DOV, borehole), the exporters (DXF, Plaxis, D-Stability), the
  ground-surface elevation providers.

Why one-directional? So the valuable, hard-to-get-right part — the domain
knowledge — cannot be dragged down by a change to the database or the web
framework. The arrow points *into* the domain, never out of it.

A shared corner
---------------

One more folder, ``src/groundmodel/shared/``, holds things every layer is allowed
to use: the logging helpers, the settings, the list of exception types, and a few
constant tables (like the five base soil types). It is deliberately tiny.

Where a request goes — a worked example
---------------------------------------

Say you click **Import** on a CPT file in the desktop window. Here is the whole
journey:

1. The **desktop window** packages the file and POSTs it to the engine's front
   door, e.g. ``POST /cpt/import``.
2. The request lands in the **API layer** (``api/routers/cpt.py``). It checks the
   request, then hands the work to the matching recipe.
3. The **application recipe** (``application/import_cpt...``) runs the steps: ask
   the parser to read the file, ask the domain to interpret it, ask the
   repository to save it.
4. The **infrastructure parser** (``infrastructure/parsers/cpt/gef/...``) turns
   the raw file text into structured numbers.
5. The **domain** (``domain/services/...``) does any pure calculation on those
   numbers.
6. The **infrastructure repository + database** store the result in PostgreSQL.
7. The answer travels back up the same layers and out to the desktop window,
   which redraws.

Every page in this guide is one file somewhere on that journey.

How to read this guide
----------------------

Each page shows **one source file, top to bottom**, cut into small blocks — the
imports, then each function, then each class and its methods. Under every block
of real code is a short **"What this does"** and **"Why it is here"** in plain
English. The line numbers on the code match the line numbers in the editor, so
you can always find the same spot in the real file.

Read the numbered groups in order. Group 1 is the code that runs when the app
starts — begin there.

A few words you will meet often
-------------------------------

* **async / await** — Python's way of saying "this step may have to wait for the
  database or the network; while it waits, let other work happen." A function
  written ``async def`` is one that can pause and resume.
* **type hint** — the ``: int`` or ``-> str`` you see after a name. It is a note
  that says what kind of value is expected (a whole number, a piece of text).
  Python does not enforce it at run time; it is there for the reader and for the
  type-checker.
* **decorator** — a line starting with ``@`` sitting just above a function or
  class. It wraps the thing below it to add behaviour (for example ``@dataclass``
  turns a class into a plain data holder, ``@asynccontextmanager`` marks
  start/stop code).
* **dataclass** — a class whose only job is to hold a few named values together,
  written with ``@dataclass`` so Python writes the boilerplate for you.
* **ORM / SQLAlchemy** — the library that lets the engine work with database rows
  as if they were Python objects, instead of writing raw SQL everywhere.
* **DSN** — a single string that says where a database is and how to log in
  (host, port, database name, user, password), like an address.
