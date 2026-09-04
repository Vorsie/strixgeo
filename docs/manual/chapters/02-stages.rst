Working through the stages
==========================

StrixGeo is organised as a **spine of stages** that you move through left to
right: Data, Geology, Litho, Geotech, Parameters, Sections, 3-D, Export. Each
stage takes the previous stage's output as its input, so the natural workflow is
to walk the spine once for a project and then revisit stages as your
interpretation matures.

One principle sits under the whole spine and is worth holding onto:
**cross-sections are the editing surface, not a separate data primitive.** When
you draw a contact or a correlation on a section, the edit commits to the
*model* (geological, litho or geotech), not to the section. The section is a
view onto the model. A test is classified **once** and that classification then
appears automatically on every section whose corridor contains the test — you do
not re-classify per section.

.. toctree::
   :maxdepth: 1

   stages/data
   stages/geology
   stages/litho
   stages/geotech
   stages/parameters
   stages/sections
   stages/three-d
   stages/export
