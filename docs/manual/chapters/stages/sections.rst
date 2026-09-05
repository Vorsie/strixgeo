Sections: the editing canvas
============================

Cross-sections are the **editing surface** of StrixGeo. You pick a slice through
the project, see the investigations projected onto it, and draw or edit the model
between them. The edits commit to the model, not to the section, because the
section is a view. A section shows the full classification of every test in its
corridor, automatically: the classification lives on the test, so it appears
wherever the test appears.

The section view
----------------

On a section you can work on any of the three model levels by switching the
**axis** (stratigraphic, litho, geotech). You see the column logs at each test,
the correlations you have drawn, and the partition fill (bands, onlaps and
lenses) that the 2 / 1 / 0 rule produces. That rule is explained in the Litho
chapter, where it first does its work. Two view controls scale the drawing:

* a **vertical exaggeration** control, to stretch the depth axis so thin layers
  are readable;
* a **column-spacing** control, to spread the tests out horizontally.

Every overlay is drawn in the exaggerated, spacing-adjusted space, so what you
edit is what you see.

A section has a **corridor**, a half-width to each side of the line, and every
investigation within that distance projects onto the section. The corridor is
always greater than zero; a wider corridor pulls in more tests, a narrow one
fewer.

Tie-sections
------------

A set of roughly parallel sections describes the ground along its lines, but says
nothing about how those lines relate where they would cross. A **tie-section**
fixes that: it is a cross-section drawn across the parallel sections, connecting
one test on each of them, so the interpretation stays consistent from one line to
the next. StrixGeo can **suggest** tie-sections for you, sweeping the tests in
order and proposing rungs that connect the parallel lines without crossing each
other or reusing a test; you accept the ones you want.

A tie-section is not a special kind of object. Once accepted it is an ordinary
cross-section, drawn and edited like any other. Its value is that it runs across
the grain of the parallel sections, and that matters just before the 3-D build:
when StrixGeo fills the space between sections (explained in the Litho chapter),
it blends the two nearest sections at each point, and a tie-section gives it
material to blend across the parallel lines rather than only along them.

The PDF sheet
-------------

The cross-section **PDF sheet** is a landscape drawing sheet, drawn by the app
itself and printed to PDF through the app's own print path. Because the preview
in the dialog and the printed PDF are the *same* drawing, there is no surprise
between screen and paper.

What the sheet shows:

* the **profile**, the partition you drew, with the fill continuous across the
  columns, coloured by unit (on the geotech axis, by packing class);
* the **column logs** at each test;
* a **map** to the side of the profile, with the section line, the tests, a scale
  bar and a north arrow;
* a **legend** of the units;
* free text fields and a title block.

The sheet offers two ways to set the scale:

* **Fit**, where StrixGeo fits the drawn profile to the sheet. Because the sheet
  keeps its height and grows in width, a long thin section fits by growing the
  page width rather than shrinking the profile.
* **Explicit**, where you set a horizontal and a vertical scale yourself (and can
  drive the exaggeration and spacing from the app's own sliders), so the sheet
  prints at a defined, reportable scale.

You can play with the exaggeration and spacing live in the preview and then
export; the sheet is the same drawing either way.

You export a **drawn section**, with its corridor, at the location you chose.
Slicing the finished 3-D model along a single zero-width line and exporting just
that slice is a different thing, and it is future work.
