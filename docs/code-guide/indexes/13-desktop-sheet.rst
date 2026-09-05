13. Desktop — the sheet (printable output)
==========================================

.. CG-EXPLANATION-START id=intro

The "sheet" is StrixGeo's printable output — the layout that turns a section or a
borelog into a clean, paginated page an engineer can print or save as a PDF. This
small group holds the code that arranges the drawing onto a fixed page size,
places the header, scale and legend, and computes the column widths and page
count. It is kept apart from the on-screen editor because printing has its own
rules (fixed millimetre dimensions, page breaks, no interactivity).

.. CG-EXPLANATION-END id=intro

.. toctree::
   :maxdepth: 1

   ../pages/desktop.renderer.src.sheet.ProfileDrawing
   ../pages/desktop.renderer.src.sheet.SectionSheet
   ../pages/desktop.renderer.src.sheet.SheetMap
   ../pages/desktop.renderer.src.sheet.TitleBlock
   ../pages/desktop.renderer.src.sheet.investigationName
   ../pages/desktop.renderer.src.sheet.main
   ../pages/desktop.renderer.src.sheet.mapExtent
   ../pages/desktop.renderer.src.sheet.projectPalette
   ../pages/desktop.renderer.src.sheet.regionPath
   ../pages/desktop.renderer.src.sheet.sheetConstants
   ../pages/desktop.renderer.src.sheet.sheetGeometry
   ../pages/desktop.renderer.src.sheet.sheetMapProjection
   ../pages/desktop.renderer.src.sheet.sheetPayload
   ../pages/desktop.renderer.src.sheet.sheetSettings
   ../pages/desktop.renderer.src.sheet.unitStyle

