groundmodel.shared.config
=========================

.. CG-PAGE source=src/groundmodel/shared/config.py complete=true

*Source file:* ``src/groundmodel/shared/config.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-17

.. literalinclude:: ../../../src/groundmodel/shared/config.py
   :language: python
   :lines: 1-17
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the settings module. It imports Pydantic's settings base (a library that reads configuration into a checked object) and defines two markers: ``_SECRET_KEY_DEFAULT = "change-me"`` (the placeholder secret shipped inside the code) and ``_SECRET_KEY_WEAK`` (that placeholder plus the empty string — both treated as "no real secret").

**Why it is here.** The comments record audit #16: a bare ``SECRET_KEY=`` line is as weak as the shipped default, so both are rejected outside development. Keeping the markers at the top of the file lets the check below cheaply spot the un-set case. A *secret key* is the private value used to sign security tokens; an *environment variable* is a named value read from the operating system (for example ``DATABASE_URL``).

.. CG-EXPLANATION-END id=module-header

Function ``def _default_dov_cache_dir``
---------------------------------------

.. CG-BLOCK id=function:_default_dov_cache_dir lines=18-22

.. literalinclude:: ../../../src/groundmodel/shared/config.py
   :language: python
   :lines: 18-22
   :lineno-match:

.. CG-EXPLANATION-START id=function:_default_dov_cache_dir

**What this does.** Returns the default folder for the DOV XML cache — a ``.groundmodel/dov_cache`` folder under the user's home directory. A *cache* is a local store of already-downloaded data kept so it need not be fetched again.

**Why it is here.** A sensible default location so a fresh install caches downloaded DOV files with no configuration. It is overridable by the ``DOV_CACHE_DIR`` environment variable (see the matching field on the settings class below).

.. CG-EXPLANATION-END id=function:_default_dov_cache_dir

Function ``def _default_dem_cache_dir``
---------------------------------------

.. CG-BLOCK id=function:_default_dem_cache_dir lines=23-27

.. literalinclude:: ../../../src/groundmodel/shared/config.py
   :language: python
   :lines: 23-27
   :lineno-match:

.. CG-EXPLANATION-START id=function:_default_dem_cache_dir

**What this does.** Returns the default folder for the DEM tile cache — ``.groundmodel/dem_cache`` under the user's home. A *DEM* is a digital elevation model, the public ground-surface height data the 3-D model samples.

**Why it is here.** The same idea as the DOV default: a fresh install caches downloaded ground-surface tiles with no configuration, overridable by the ``DEM_CACHE_DIR`` environment variable.

.. CG-EXPLANATION-END id=function:_default_dem_cache_dir

Class ``Settings`` — header
---------------------------

.. CG-BLOCK id=class:Settings lines=28-57

.. literalinclude:: ../../../src/groundmodel/shared/config.py
   :language: python
   :lines: 28-57
   :lineno-match:

.. CG-EXPLANATION-START id=class:Settings

**What this does.** The settings class itself with its typed fields. It resolves each value in priority order — a real environment variable first, then a ``.env`` file in the project root, then the Python default written here. The fields shown include the database address (``database_url``), the ``debug`` flag, the SQLAlchemy echo switch, the log level, the deployment environment, and the secret key.

**Why it is here.** Centralising every tunable in one typed object gives each setting one home and a safe default, with secrets always coming from the environment, never hardcoded. The comments record two audit fixes: SQLAlchemy echo is OFF and kept separate from ``debug`` because echo logs every statement with the database password inside it (audit #6); the secret-key default is the loud sentinel ``"change-me"`` so a warning fires before any future auth route uses it (debt #113). The *database URL* is one string holding host, port, database name, user and password; *SQLAlchemy* is the library that lets the engine treat database rows as Python objects.

.. CG-EXPLANATION-END id=class:Settings

Method ``Settings``. ``def _enforce_secret_key``
------------------------------------------------

.. CG-BLOCK id=method:Settings._enforce_secret_key lines=58-119

.. literalinclude:: ../../../src/groundmodel/shared/config.py
   :language: python
   :lines: 58-119
   :lineno-match:

.. CG-EXPLANATION-START id=method:Settings._enforce_secret_key

**What this does.** Defines the after-load check ``_enforce_secret_key`` and the remaining fields. The check blocks the shipped default secret key outside local development: in the ``development`` environment it only warns, in any other environment it raises an error. Below it come the DOV and DEM cache-directory and cache-size-cap fields, and ``model_config`` which tells Pydantic to also read a ``.env`` file.

**Why it is here.** The docstring records audit #16 — the default key would forge any future signed token, so it is fatal in production, staging or a packaged binary but only a warning in development so a first run is not blocked. The cache-size comments record the ceilings: 256 MiB per DOV sub-cache (five of them, about 1.25 GiB) and 512 MiB per DEM provider folder, both overridable and both disabled by setting the cap to 0. These caps are owner-tunable constants.

.. CG-EXPLANATION-END id=method:Settings._enforce_secret_key

Module-level constants and statements
-------------------------------------

.. CG-BLOCK id=module-statements lines=120-120

.. literalinclude:: ../../../src/groundmodel/shared/config.py
   :language: python
   :lines: 120-120
   :lineno-match:

.. CG-EXPLANATION-START id=module-statements

**What this does.** Creates the one shared ``settings`` object the rest of the engine imports.

**Why it is here.** Building it once at import time means every module reads the same resolved configuration, and the secret-key check above runs immediately at startup rather than on first use.

.. CG-EXPLANATION-END id=module-statements

