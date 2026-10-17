Support and reporting a problem
===============================

StrixGeo is free and open source; report problems on GitHub issues
(https://github.com/Vorsie/strixgeo/issues) or by e-mail. Your reports make
the next release better, so this chapter says exactly what to send and where
to find it.
Everything below works offline: the app never uploads anything by itself.

.. note::

   The menu bar follows your interface language. On a Dutch system the menus
   read *Bestand*, *Bewerken*, *Beeld* and *Help*, and the items named below
   carry their Dutch label, given in brackets after the English one.

Where to write
--------------

Open an issue at https://github.com/Vorsie/strixgeo/issues, or send the
question, idea or problem to **info@strixgeo.com**. One issue or mail per
problem is easier to track than a list. A GitHub issue is public: attach a
project file there only when its data may be seen by everyone, and mail it
otherwise.

What a good report contains
---------------------------

Three things let the developer reproduce what you saw in minutes instead of
days:

1. **The project file.** Use *File > Save* (Dutch: *Bestand > Opslaan*) and
   attach the ``.strix`` file. It holds the imported data and every
   interpretation, so the developer can open the same model you were looking
   at. It contains no personal data beyond what you imported yourself.
2. **The logs for support.** In the app, open *Help > Save logs for
   support...* (Dutch: *Help > Logs opslaan voor support...*). It writes one
   small zip file with the app log, the engine log and a redacted diagnostics
   record. Attach that zip. Nothing is sent anywhere until you attach it to
   your mail.
3. **What you did, what you expected, what happened.** Two or three
   sentences are enough: the stage you were in, the button or gesture, and
   the moment it went wrong. A screenshot of the screen at that moment helps
   when the problem is visual (a fill that looks wrong, a lens that should be
   a band).

If the app cannot start, the log files are still on disk: open Windows
Explorer, type ``%LOCALAPPDATA%\StrixGeo\logs`` in the address bar and
attach the files there (the exact path is also printed at the top of each
log).

Updates
-------

StrixGeo is free and open source: it needs no key and it does not expire.
*Help > Check for updates...* (Dutch: *Help > Controleren op updates...*)
installs the next release, and your projects open as before. A ``.strix``
file written by any beta build opens in every later build.

The setting *Check for updates at start* (Dutch: *Bij het starten
controleren op updates*) controls the automatic check. It is on by default;
when it is off the app makes no check by itself and the Help menu item keeps
working.

What the app does not send
--------------------------

The app does not phone home. It keeps a redacted diagnostics log on your own
disk, and that log leaves the machine only when you attach it to a report
yourself. Automatic sending needs two things, and both are off by default: a
recorded opt-in (the app does not offer it in Settings yet) and a diagnostics
server named in the ``STRIXGEO_DIAGNOSTICS_URL`` environment variable. With
the defaults nothing is sent. The project stays on your disk.
