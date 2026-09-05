Support and reporting a problem
===============================

StrixGeo is in closed beta. Your reports are what turns a beta into a
release, so this chapter says exactly what to send and where to find it.
Everything below works offline: the app never uploads anything by itself.

Where to write
--------------

Send every question, idea or problem to **info@strixgeo.com**. One mail per
problem is easier to track than a list. You will get an answer from the
developer, not from a ticket system.

What a good report contains
---------------------------

Three things let the developer reproduce what you saw in minutes instead of
days:

1. **The project file.** Use *File > Save* and attach the ``.strix`` file.
   It holds the imported data and every interpretation, so the developer can
   open the same model you were looking at. It contains no personal data
   beyond what you imported yourself.
2. **The logs for support.** In the app, open *Help > Save logs for
   support...*. It writes one small zip file with the app log, the engine log
   and a redacted diagnostics record. Attach that zip. Nothing is sent
   anywhere until you attach it to your mail.
3. **What you did, what you expected, what happened.** Two or three
   sentences are enough: the stage you were in, the button or gesture, and
   the moment it went wrong. A screenshot of the screen at that moment helps
   when the problem is visual (a fill that looks wrong, a lens that should be
   a band).

If the app cannot start, the log file is still there: *Help > Show log
file...* opens the folder from any running build, and the same folder is
reachable from Windows Explorer under your user profile in the StrixGeo
application data (the exact path is printed at the top of the log).

Beta keys and expiry
--------------------

Your licence key is personal and time-limited. It is stamped at first
activation and the mail that carried it says for how long it runs. One key
activates one machine; to move to another computer, deactivate on the first
one (*Help > Licence & activation...*) and activate on the second.

Every beta build carries an expiry date. Seven days before that date the app
starts warning you at launch; use *Help > Check for updates...* and install
the update, and your projects open as before. A ``.strix`` file written by
any beta build opens in every later build.

What the beta does not send
---------------------------

The app does not phone home. When the engine fails to start it offers to send
a redacted diagnostics bundle, and it sends nothing unless you agree in that
dialog. The project stays on your disk.
