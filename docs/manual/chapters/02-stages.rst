Working through the stages
==========================

StrixGeo is organised as a **spine of stages** on the left of the window, and you
move through them top to bottom: Data, Sections, Stratigraphy, Litho, Geotech,
Parameters, Export. Data and Sections are your working canvas: Data is where the
investigations come in, and Sections is where you draw and edit the model.
Stratigraphy, Litho and Geotech are the three levels of the ground model, each
taking the level above it as its input. Parameters gives you overviews, per test
or per layer, of everything you have built. Export hands the finished model to
your design tool.

The natural way to use StrixGeo is **walking the spine and re-interpreting**: go
down it once to build a first model, then come back up and refine as your
understanding of the ground matures. The three model levels each carry their own
**3-D view** (Stratigraphy, Litho and Geotech all show the model in three
dimensions), so you can check the solid you are building at every level, not only
at the end.

One principle sits under the whole spine and is worth holding onto:
**cross-sections are the editing surface, not a separate copy of the data.** When
you draw a contact or a correlation on a section, the edit commits to the
*model* (stratigraphic, lithological or geotechnical), not to that section. The
section is a view onto the model.

Why classification is not redone per section
--------------------------------------------

A test is classified **once**, and that classification then appears
automatically on every section whose corridor contains the test. StrixGeo does
not re-classify a test each time it turns up on a new section, and that is a
deliberate choice, for two reasons.

* If the classification were tied to the section, the model would **change every
  time you edited a section**, which is the opposite of a stable interpretation.
* You would also end up with **two different classifications for the same test**,
  one per section it appears on, with no way to say which is right.

One test, one classification. Sections are views; the classification lives on the
test.

.. toctree::
   :maxdepth: 1

   stages/data
   stages/sections
   stages/geology
   stages/litho
   stages/geotech
   stages/parameters
   stages/export
