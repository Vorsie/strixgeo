Sections and the PDF sheet
==========================

Cross-sections are the **editing surface** of StrixGeo. You pick a slice through
the project, see the investigations projected onto it, and draw or edit the model
between them. The edits commit to the model, not to the section — the section is
a view. A section shows the full classification of every test in its corridor,
automatically (classification follows the test).

The section view
----------------

On a section you can work on any of the three model levels by switching the
**axis** (geological, litho, geotech). You see the column logs at each test, the
correlations you have drawn, and the partition fill (bands, onlaps, lenses) that
the 2 / 1 / 0 rule produces. Two view controls scale the drawing:

* a **vertical exaggeration** control, to stretch the depth axis so thin layers
  are readable;
* a **column-spacing** control, to spread the tests out horizontally.

Every overlay is drawn in the exaggerated, spacing-adjusted space, so what you
edit is what you see.

The PDF sheet
-------------

The cross-section **PDF sheet** is a landscape A3-high drawing sheet, drawn by
the app itself (not a server-side exporter) and printed to PDF through the app's
own print path. Because the preview you see in the dialog and the printed PDF are
the *same* drawing, there are no surprises between screen and paper.

What the sheet shows:

* the **profile** — the partition you drew, with the fill continuous across the
  columns, coloured by unit (on the geotech axis, by packing class);
* the **column logs** at each test;
* a **map** to the right of the profile, with the section line (A–A′), the tests,
  a scale bar and a north arrow;
* a **legend** of the units;
* free text fields and a title block.

Scales: fit vs. explicit
------------------------

The sheet offers two ways to set the scale:

* **Fit** — StrixGeo fits the drawn profile to the sheet. Because the sheet is
  A3-high and grows in width, a long thin section fits by growing the page width
  rather than shrinking the profile.
* **Explicit** — you set an explicit horizontal and vertical scale (and can drive
  the exaggeration and spacing from the app's own sliders), so the sheet prints
  at a defined, reportable scale.

You play with the exaggeration and spacing sliders live in the preview and then
export; the sheet is the same DOM either way.
