desktop.main.deviceIdentity
===========================

.. CG-PAGE source=desktop/src/main/deviceIdentity.ts complete=true

*Source file:* ``desktop/src/main/deviceIdentity.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-59

.. literalinclude:: ../../../desktop/src/main/deviceIdentity.ts
   :language: typescript
   :lines: 1-59
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This is the file's opening note (a *docstring* — a comment for whoever reads the code) and its imports. It lives in Electron's *main process* (the part of the desktop app with full computer access). The note explains what this file produces: a stable *device identity* — an id that is the SAME on every launch of the same computer, and ideally still the same after the app is reinstalled, yet DIFFERENT on a genuinely different computer. This kind of derived-from-the-hardware id is a *fingerprint*. The default id is built by mixing together a few hardware facts the operating system hands over for free: the platform and processor family, the CPU model text, and the total memory rounded to whole gibibytes. The note is careful about what it leaves out on purpose — the network card (MAC) address and the computer's name — because both change too easily and would cause a false "new device". It also frankly records a known weakness (two identical machines produce the same id) and the production fix (feed in the operating system's own machine GUID, which then dominates).

**Why it is here.** The licence server binds a paid seat to one device (owner ruling 15: one device per Solo seat). For that to work the client must send an id that reliably recognises the *same* machine across launches and reinstalls, without wrongly flagging a new one — a false "new device" on a one-device seat means a support ticket. The hardware facts survive a reinstall (reinstalling cannot change the CPU) but differ on a new box. The note also explains the split into a *pure* function (one that only computes from its inputs and touches nothing else, so tests can drive it with no fake operating system) plus a thin *impure* reader that actually gathers the live facts.

.. CG-EXPLANATION-END id=module-header

``interface DeviceIdentityInputs``
----------------------------------

.. CG-BLOCK id=interface:DeviceIdentityInputs lines=60-79

.. literalinclude:: ../../../desktop/src/main/deviceIdentity.ts
   :language: typescript
   :lines: 60-79
   :lineno-match:

.. CG-EXPLANATION-START id=interface:DeviceIdentityInputs

**What this does.** Describes the bundle of machine facts the id is built from. An *interface* is a written description of the fields a value must carry. The fields are ``hostname`` (the computer's name — used only as the human label, never in the id), ``platform`` and ``arch`` (the operating-system and processor families), ``cpuModel`` (the processor's model text), ``totalMemoryBytes`` (the total memory, later rounded to whole gibibytes), and an optional ``machineId`` (an operating-system-provided stable machine identifier that, when present, takes over the id).

**Why it is here.** Naming every input in one place is what lets the id be computed by a *pure* function that reaches out to nothing — the tests hand it a made-up bundle and check the result exactly, with no real machine involved. The optional ``machineId`` is the seam for the stronger, collision-free id: supply it and it dominates; leave it out and the id falls back to the hardware facts.

.. CG-EXPLANATION-END id=interface:DeviceIdentityInputs

``const DEVICE_ID_HEX_LENGTH``
------------------------------

.. CG-BLOCK id=const:DEVICE_ID_HEX_LENGTH lines=80-82

.. literalinclude:: ../../../desktop/src/main/deviceIdentity.ts
   :language: typescript
   :lines: 80-82
   :lineno-match:

.. CG-EXPLANATION-START id=const:DEVICE_ID_HEX_LENGTH

**What this does.** Sets ``DEVICE_ID_HEX_LENGTH`` to 32 — the number of hex characters (hex being base-16, the digits 0–9 and a–f) kept from the scrambled fingerprint.

**Why it is here.** The full scramble is longer than needed; 32 hex characters is 128 bits of it, which is ample to keep two different machines apart while staying short and tidy to store and send.

.. CG-EXPLANATION-END id=const:DEVICE_ID_HEX_LENGTH

``const BYTES_PER_GIB``
-----------------------

.. CG-BLOCK id=const:BYTES_PER_GIB lines=83-101

.. literalinclude:: ../../../desktop/src/main/deviceIdentity.ts
   :language: typescript
   :lines: 83-101
   :lineno-match:

.. CG-EXPLANATION-START id=const:BYTES_PER_GIB

**What this does.** Sets ``BYTES_PER_GIB`` to 1024 raised to the third power — the number of bytes in one gibibyte, used to convert the raw memory size into whole-gibibyte units.

**Why it is here.** The total-memory figure the operating system reports wobbles slightly from run to run. Rounding it to whole gibibytes before it feeds the id means that small variance never shifts the fingerprint, so the same machine keeps the same id across launches.

.. CG-EXPLANATION-END id=const:BYTES_PER_GIB

``function hashHex``
--------------------

.. CG-BLOCK id=function:hashHex lines=102-120

.. literalinclude:: ../../../desktop/src/main/deviceIdentity.ts
   :language: typescript
   :lines: 102-120
   :lineno-match:

.. CG-EXPLANATION-START id=function:hashHex

**What this does.** Takes an ordered list of text fields and folds them into a short hex id using SHA-256 — a standard one-way scrambler (a *hash*) that turns any input into a fixed-size jumble from which the original cannot be recovered. It joins the fields, scrambles them, and keeps the first 32 hex characters. The fields are joined with a special separator byte that cannot appear inside any of the hardware strings.

**Why it is here.** A hash gives an id that is stable (the same inputs always scramble to the same output) yet reveals nothing about the underlying hardware and is a fixed compact length. The special separator matters: without it, two different lists of fields could accidentally join into the same run of characters and collide; a byte that can never occur in the real strings guarantees they stay distinct.

.. CG-EXPLANATION-END id=function:hashHex

``function computeDeviceIdentity``
----------------------------------

.. CG-BLOCK id=function:computeDeviceIdentity lines=121-154

.. literalinclude:: ../../../desktop/src/main/deviceIdentity.ts
   :language: typescript
   :lines: 121-154
   :lineno-match:

.. CG-EXPLANATION-START id=function:computeDeviceIdentity

**What this does.** The pure heart of the file: it turns the machine facts into the device id and a human label. The label is the computer's name (or the words "this device" if it has none). If a real machine GUID was supplied, it builds the id by hashing that GUID together with the platform tag and returns. Otherwise it rounds the memory to whole gibibytes and builds the id by hashing the platform, processor family, CPU model and memory bucket together.

**Why it is here.** This is the single place the id is derived, kept *pure* (computing only from its inputs) so every case can be tested without a real machine. Preferring the machine GUID when present eliminates the identical-hardware collision; the platform tag guards against the vanishingly unlikely reuse of a GUID across different operating-system families. The hardware-only path is the dependable fallback that still recognises the same machine across launches and reinstalls.

.. CG-EXPLANATION-END id=function:computeDeviceIdentity

``function parseMachineGuidFromRegQuery``
-----------------------------------------

.. CG-BLOCK id=function:parseMachineGuidFromRegQuery lines=155-183

.. literalinclude:: ../../../desktop/src/main/deviceIdentity.ts
   :language: typescript
   :lines: 155-183
   :lineno-match:

.. CG-EXPLANATION-START id=function:parseMachineGuidFromRegQuery

**What this does.** A pure text-reader that pulls the machine GUID out of the raw output of a Windows ``reg query`` command. That command prints, among blank lines, a line shaped like ``MachineGuid   REG_SZ   <the guid>``; this function scans the lines, finds that one, takes the GUID as the last piece of it, and returns nothing (``null``) if no such line is present.

**Why it is here.** Reading the value and extracting it from the command's printed output are kept as two separate steps so this extraction — the fiddly, format-dependent part — can be tested on captured sample text with no Windows machine or registry involved. Returning ``null`` on anything unexpected (a different operating system, a locked-down machine, an odd format) lets the caller quietly fall back to the hardware-only id.

.. CG-EXPLANATION-END id=function:parseMachineGuidFromRegQuery

``function collectWindowsMachineGuid``
--------------------------------------

.. CG-BLOCK id=function:collectWindowsMachineGuid lines=184-210

.. literalinclude:: ../../../desktop/src/main/deviceIdentity.ts
   :language: typescript
   :lines: 184-210
   :lineno-match:

.. CG-EXPLANATION-START id=function:collectWindowsMachineGuid

**What this does.** The impure reader that actually fetches the Windows machine GUID. On non-Windows it returns nothing. On Windows it runs the built-in ``reg`` command to read the GUID (which Windows writes once at install time and keeps for the life of that installation), with a short time limit and the console window hidden, then hands the output to the text-reader above. Any failure returns nothing.

**Why it is here.** The install-time machine GUID is the strongest per-machine discriminator available without adding a special hardware library — and it is exactly what breaks the collision two identical office laptops would otherwise hit (owner ruling 15: one device per Solo seat). Running the built-in ``reg`` command keeps the app free of extra dependencies. The short time limit stops a wedged registry from stalling launch, and catching every failure means the id simply falls back to the hardware hash — the previous behaviour — rather than breaking.

.. CG-EXPLANATION-END id=function:collectWindowsMachineGuid

``function collectDeviceIdentityInputs``
----------------------------------------

.. CG-BLOCK id=function:collectDeviceIdentityInputs lines=211-230

.. literalinclude:: ../../../desktop/src/main/deviceIdentity.ts
   :language: typescript
   :lines: 211-230
   :lineno-match:

.. CG-EXPLANATION-START id=function:collectDeviceIdentityInputs

**What this does.** The impure gatherer that reads the live machine facts from the current computer: its name, platform, processor family, first CPU's model (or "unknown-cpu" if none is reported), total memory, and — via the reader above — the Windows machine GUID (or nothing on other systems).

**Why it is here.** This is the one small place that actually touches the operating system, kept deliberately thin so the real work (turning these facts into an id) stays a pure, fully-testable function. Filling in the machine GUID here means that when it is readable it dominates the id and removes the identical-hardware collision, and when it is not the id gracefully uses the hardware facts alone.

.. CG-EXPLANATION-END id=function:collectDeviceIdentityInputs

``function resolveDeviceIdentity``
----------------------------------

.. CG-BLOCK id=function:resolveDeviceIdentity lines=231-233

.. literalinclude:: ../../../desktop/src/main/deviceIdentity.ts
   :language: typescript
   :lines: 231-233
   :lineno-match:

.. CG-EXPLANATION-START id=function:resolveDeviceIdentity

**What this does.** The one call the rest of the app uses to get this machine's identity: it gathers the live facts and feeds them through the pure derivation, handing back the device id and human label.

**Why it is here.** It joins the impure gatherer to the pure calculator in a single convenient entry point, so callers get the finished device identity without needing to know it was assembled from two halves.

.. CG-EXPLANATION-END id=function:resolveDeviceIdentity

