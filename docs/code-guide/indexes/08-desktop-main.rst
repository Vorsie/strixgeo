8. Desktop — the Electron main process and preload bridge
=========================================================

.. CG-EXPLANATION-START id=intro

An Electron app is really two programs. The **main process** is the one in this
group: it runs on Node.js with full access to the computer — it can open files,
launch other programs, and create windows. The **renderer** (groups 9-13) is the
web page the user actually sees and clicks; it is sandboxed and cannot touch the
computer directly. Between them sits the **preload bridge** (``preload/index.ts``):
a small, guarded script that hands the web page a short, fixed list of safe
functions, so the page never gets raw operating-system power.

Read this group first, because it is what runs the instant the app launches.
The main process boots the app's own bundled PostgreSQL database and its Python
engine, waits for them, decides whether a beta build's licence lets the engine
start at all, opens the window, and wires up every request the window can make
back to it. If any of that goes wrong, this is also the code that shows an
honest error and shuts down cleanly.

The files fall into a few themes: the **boot sequence and embedded stack**
(``embedded/``, ``backend*``) that start and supervise Postgres and the engine;
the **activation and licence gate** (``activation*``, ``deviceIdentity``,
``localClientToken``) that guards a paid, time-limited beta; the **`.strix`
codec** (``strixCodec``) that wraps a saved project so it is not plaintext on
disk; **crash recovery** (``recoveryStore``); **window, quit and crash policy**;
consent-gated **diagnostics**; and the **auto-updater** wiring. ``index.ts`` is
the conductor that assembles all of it.

.. CG-EXPLANATION-END id=intro

.. toctree::
   :maxdepth: 1

   ../pages/desktop.main.activation
   ../pages/desktop.main.activationConfig
   ../pages/desktop.main.activationRepository
   ../pages/desktop.main.activationService
   ../pages/desktop.main.activationStore
   ../pages/desktop.main.atomicWrite
   ../pages/desktop.main.backendLifecycle
   ../pages/desktop.main.backendProbe
   ../pages/desktop.main.backendRespawnPolicy
   ../pages/desktop.main.betaExpiry
   ../pages/desktop.main.betaExpiryStore
   ../pages/desktop.main.bootFailureMessage
   ../pages/desktop.main.buildStamp
   ../pages/desktop.main.buildStampGlobals.d
   ../pages/desktop.main.crashBundle
   ../pages/desktop.main.deviceIdentity
   ../pages/desktop.main.diagnosticsConsent
   ../pages/desktop.main.diagnosticsEvent
   ../pages/desktop.main.diagnosticsPayload
   ../pages/desktop.main.diagnosticsRedaction
   ../pages/desktop.main.diagnosticsStore
   ../pages/desktop.main.diagnosticsUploader
   ../pages/desktop.main.diagnosticsUploaderConstants
   ../pages/desktop.main.embedded.bootSequence
   ../pages/desktop.main.embedded.embeddedPaths
   ../pages/desktop.main.embedded.embeddedStack
   ../pages/desktop.main.embedded.freePort
   ../pages/desktop.main.embedded.installSecrets
   ../pages/desktop.main.embedded.packagedBootCoordinator
   ../pages/desktop.main.embedded.pgDsn
   ../pages/desktop.main.embedded.postgresCluster
   ../pages/desktop.main.httpActivationRepository
   ../pages/desktop.main.httpPostJson
   ../pages/desktop.main.index
   ../pages/desktop.main.localClientToken
   ../pages/desktop.main.logRotation
   ../pages/desktop.main.machineLocalStores
   ../pages/desktop.main.mainCrashPolicy
   ../pages/desktop.main.mockActivationRepository
   ../pages/desktop.main.packagedProfile
   ../pages/desktop.main.pgdataMigration
   ../pages/desktop.main.prototypeFlags
   ../pages/desktop.main.prototypeIpc
   ../pages/desktop.main.quitHandshake
   ../pages/desktop.main.recoveryStore
   ../pages/desktop.main.rendererConsoleForwarding
   ../pages/desktop.main.rendererGonePolicy
   ../pages/desktop.main.sampleProject
   ../pages/desktop.main.security
   ../pages/desktop.main.sheetPdf
   ../pages/desktop.main.strixCodec
   ../pages/desktop.main.unreachableActivationRepository
   ../pages/desktop.main.updaterPolicy
   ../pages/desktop.main.updaterService
   ../pages/desktop.main.windowGuards
   ../pages/desktop.main.zipArchive
   ../pages/desktop.preload.index

