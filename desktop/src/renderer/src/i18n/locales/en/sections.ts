// Sections stage — the cross-section canvas, toolbar, inspector, header,
// context menus and overlay hints. The largest single surface in the app.
//
// Part of the English message catalogue — see 'locales/en/index.ts' for the
// key-naming rules and the domain-canon carve-out.

export const SECTIONS = {
  // -------------------------------------------------------------------------
  // sections stage — canvas, toolbar, inspector, header.
  // -------------------------------------------------------------------------
  'sections.title': 'Cross-sections',
  'sections.new': 'New cross-section',
  'sections.newPlus': '+ New cross-section',
  'sections.none': 'No cross-sections yet',
  'sections.emptyBlurb':
    'Draw a line on the map to define a section, or create one with placeholder endpoints to start.',
  'sections.delete': 'Delete cross-section…',
  'sections.deleteConfirm': 'Delete cross-section?',
  'sections.rename': 'Click to rename this cross-section',
  'sections.name': 'Section name',
  'sections.properties': 'Section properties',
  'sections.modelActions': 'Model actions',
  'sections.modelAxis': 'Section model axis',
  'sections.buffer': 'Projection buffer',
  'sections.bufferLabel': 'Projection buffer (m)',
  'sections.bufferLateral': 'Lateral projection buffer',
  'sections.bufferHint':
    'Lateral distance from the section line within which investigations are projected',
  'sections.vex': 'Vertical exaggeration',
  'sections.vexShort': 'V exag',
  'sections.vexHint':
    'Vertical exaggeration applied to the section view (1 = no exaggeration, 10 = 10× stretched)',
  'sections.columnSpacing': 'Column spacing',
  'sections.columnSpacingHint':
    'Spacing between investigations — at 0% tests render at their true projected X (bands may overlap)',
  'sections.referenceGeologicalModel': 'Reference geological model',
  'sections.geologyBackdrop': 'Geology backdrop (litho axis)',
  'sections.geologyBackdropHint': 'Shown as a faint reference layer when the litho axis is active.',
  'sections.syncGeology': 'Sync geology',
  'sections.boreholePreview': 'Borehole preview',
  'sections.virtueleBoringOverlay': 'Virtuele Boring overlay',
  'sections.closeView': 'Close section view',
  'sections.closeViewHint': 'Close section view (back to map)',
  'sections.resetFraming': 'Reset view to default framing',
  'sections.exitFocus': 'Exit focus mode',
  'sections.exitFocusHint': 'Exit focus mode (Esc)',
  'sections.noFormationContacts': 'No formation contacts on this section',
  'sections.restoreHidden':
    'Restore every test hidden from this section. Their columns reappear on the next render.',
  'sections.sizingCanvas': 'Sizing canvas…',
  'sections.findColumn': 'Find column',
  'sections.findColumnPlaceholder': 'Find column… (e.g. S8)',
  'sections.closeFind': 'Close find',
  'sections.columnName': 'Column name',
  'sections.zoomInHint': 'Zoom in (or scroll the canvas)',
  'sections.zoomOutHint': 'Zoom out (or scroll the canvas)',

  'sections.toolbar.display': 'Display',
  'sections.toolbar.bodies': 'Bodies',
  'sections.toolbar.geology': 'Geology',
  'sections.toolbar.export': 'Export',
  'sections.toolbar.undo': 'Undo',
  'sections.toolbar.undoHint': 'Undo last model edit',
  'sections.toolbar.clear': 'Clear',
  'sections.toolbar.clearBulk': 'Clear bulk',
  'sections.toolbar.correlateContacts': 'Correlate contacts',
  'sections.toolbar.uncorrelateContacts': 'Uncorrelate contacts',
  'sections.toolbar.acceptAllSuggestions': 'Accept all suggestions',
  'sections.toolbar.acceptAllBulkSuggestions': 'Accept all bulk suggestions',
  'sections.toolbar.clearLithoSuggestions': 'Clear litho suggestions',
  'sections.toolbar.clearCorrelationSuggestions': 'Clear correlation suggestions',
  'sections.toolbar.clearBulkGhosts': 'Clear bulk ghost overlays',
  'sections.toolbar.dismissLithoGhost': 'Dismiss the current litho suggestion overlay',
  'sections.toolbar.dismissBulkGhosts': 'Dismiss the bulk-suggest ghost overlays for every investigation',
  'sections.toolbar.suggestAllTests': 'Suggest lithos for all tests?',
  'sections.toolbar.recomputeBodies': 'Recompute bodies',
  'sections.toolbar.resetPoints': 'Reset points',
  'sections.toolbar.resetPointsConfirm': 'Reset all manual points?',
  'sections.toolbar.resetPointsBody':
    'Every hand-drawn boundary point on this model will be cleared and the bodies will be rebuilt from the correlations alone.',
  'sections.toolbar.admixtures': 'Admixtures',
  'sections.toolbar.reseedAdmixtures': 'Reseed borehole admixtures',
  'sections.toolbar.stripAdmixtures': 'Strip all admixtures',
  'sections.toolbar.clearGhostAdmixtures': 'Clear admixtures from every ghost suggestion',
  'sections.toolbar.editGeologyContacts': 'Edit the geological model contacts on this section',
  'sections.toolbar.noLithoModel': 'No lithostratigraphic model — create one in the Lithology stage.',
  'sections.toolbar.showLayers': 'Show or hide layers of the section view',
  'sections.toolbar.applyNextSubdivide': 'Applies to the next Subdivide — nothing re-runs now',
  'sections.toolbar.statisticFailed': 'Could not set the statistic.',
  'sections.toolbar.noPackingBands':
    'No packing bands on this section yet — run "1 · Subdivide CPTs" on this section first',
  'sections.toolbar.packingFlowHint':
    'The four-step packing flow: 1 subdivide the CPTs, 2 propose ties, 3 review and accept them, 4 divide the boreholes. All four act on the section you have open and leave every other section as it is, so you can finish one cross-section while the next still has proposals waiting. Step 4 stays locked until this section’s ties are all accepted or deleted.',
  'sections.toolbar.previewDivideHint':
    'Preview the packing bands "4 · Divide boreholes" would commit, hatched over the borehole columns. Nothing is written.',
  'sections.toolbar.lithoFillHint':
    'Colour every body’s closed loop with its lithology, across the section. Do this once correlations + pinch-outs are done. Toggles on / off.',
  'sections.toolbar.correlationRibbonsHint':
    'Show or hide the correlation ribbons + lines drawn across the section. A 2-D visualisation of your correlations only — it has no link to the 3-D model. Toggles on / off.',
  'sections.toolbar.solidFillHint':
    'Show or hide the cross-section fill sampled from the built 3-D solids. Toggles on / off.',
  'sections.toolbar.geotechSolidFillHint':
    'Show or hide the fill cut out of the BUILT 3-D geotechnical solids — the model as of the last Build, not the live bands. One fill renders at a time.',
  'sections.toolbar.packingFillHint':
    'Show or hide the NAD packing-band fill — the LIVE packing classes, as the pipeline last wrote them. One fill renders at a time.',
  'sections.toolbar.swapFillHint':
    'Swap the lithostratigraphic fill in for the NAD packing fill — one fill renders at a time, never both.',
  'sections.toolbar.qcStatisticHint':
    'Which representative qc the NAD classifier reads, chosen BEFORE you build the packing bands under it. The choice applies to the NEXT "1 · Subdivide CPTs", and bands already on screen keep the statistic they were built with until you re-run it.',
  'sections.toolbar.sampleMarkersHint':
    'Show or hide the lab-sample markers on the borehole columns. Each marker spans the depth interval its sample was taken over.',
  'sections.toolbar.psdCardHint':
    'Show a grain-size distribution card while hovering a sample marker. Press P to toggle without opening this menu.',

  'sections.header.cptChannels': 'CPT data channel toggles',
  'sections.header.qc': 'Cone resistance (qc)',
  'sections.header.fs': 'Sleeve friction (fs) — CPTU/CPTE only',
  'sections.header.rf': 'Friction ratio (Rf)',
  'sections.header.u2': 'Pore-water pressure (u2) — CPTU only',
  'sections.header.qTotal': 'Total resistance (qTotal) — CPTM only',
  'sections.header.streamToggles':
    'Borehole interpretation stream toggles — each enabled stream renders as its own strip side by side',
  'sections.header.formalStratigraphy': 'Formal stratigraphy',
  'sections.header.formalStratigraphyShort': 'F-Strat',
  'sections.header.informalStratigraphy': 'Informal stratigraphy',
  'sections.header.informalStratigraphyShort': 'I-Strat',
  'sections.header.geotechnicalCoding': 'Geotechnical coding',
  'sections.header.geotechnicalCodingShort': 'Geo',

  'sections.hints.f1': 'Press F1 for the full gesture reference',
  'sections.hints.lithoLayer':
    'Litho layer: double-click to accept · Alt+drag to copy composition · Shift+drag past neighbour midpoint to absorb · right-click for more',
  'sections.hints.acceptFirst':
    'Accept litho suggestions to enable correlation — 0 accepted contacts on this section.',
  'sections.hints.buildGeotechFirst':
    'Build the geotech model for this section before suggesting NAD subdivision.',

  // Section context menus + gestures.
  'sections.menu.body': 'Body extent actions',
  'sections.menu.dissolveBody': 'Dissolve body',
  'sections.menu.nameBody': 'Name body…',
  'sections.menu.focusTest': 'Focus this test',
  'sections.menu.openDetail': 'Open detail',
  'sections.menu.removeFromSection': 'Remove from this section',
  'sections.menu.clearSubdivision': 'Clear subdivision',
  'sections.menu.deleteContact': 'Delete contact',
  'sections.menu.linkToGeology': 'Link to geology',
  'sections.menu.unlinkFromGeology': 'Unlink from geology',
  'sections.menu.editInGeology': 'Edit in Geology stage',
  'sections.menu.mergeLayers': 'Merge layers',
  'sections.menu.removeLithoUnit': 'Remove this litho unit',
  'sections.menu.addSuggestionHere': 'Add new suggestion here',
  'sections.menu.insertLayerHere': 'Insert layer here…',
  'sections.menu.editComposition': 'Edit composition…',
  'sections.menu.splitLayer': 'Split layer',
  'sections.menu.acceptLayer': 'Accept layer',
  'sections.menu.rejectLayer': 'Reject layer',
  'sections.menu.extendToNearest': 'Extend to nearest contacts',
  'sections.menu.ghostActions': 'Ghost layer actions',
  'sections.menu.boundaryActions': 'Boundary actions',
  'sections.menu.confirmTie': 'Confirm tie',
  'sections.menu.deleteCorrelation': 'Delete correlation',
  'sections.menu.inspectLensBody': 'Inspect lens body…',
  'sections.menu.editBodyAdmixtures': 'Edit admixtures for this body',
  'sections.menu.mergeBands': 'Merge bands',
  'sections.menu.mergeIntoSurrounding': 'Merge into surrounding band',
  'sections.menu.splitBand': 'Split band…',

  'sections.contacts.insertHint': 'Click to insert new layer here · right-click to remove',
  'sections.contacts.lithoContactHint':
    'Lithostratigraphic contact — dragging it moves the litho model',
  'sections.contacts.coupledHint': 'Coupled to geological contact — right-click to unlink',
  'sections.contacts.absorbHint':
    'Release here and the band below is absorbed into this unit. One boundary per drag — drag again to take the next.',
  'sections.contacts.absorbBlockedHint':
    'Stops short of the next lithostratigraphic contact — going further would delete the unit below. Subdivide it first, or edit it on the lithology axis.',
  'sections.contacts.deleteConfirm':
    'Delete this contact? This removes the boundary and any correlations touching it.',
  'sections.contacts.deleteLensConfirm':
    'Delete this lens? This removes the two correlations that define it.',
  'sections.contacts.copyFailed':
    'Could not copy any contacts to the target — see console for details.',

  'sections.bands.rightClickBoundary':
    'Right-click to place a new packing boundary or remove this band',
  'sections.bands.rightClickClass': "Right-click to set this band's NAD class by hand",
  'sections.bands.nothingToSnap':
    'Nothing to snap to on this column — a borehole carries no cone resistance, so there are no packing boundaries here.',
  'sections.bands.acceptGhosts': 'Accept these bands (divide this borehole)',
  'sections.bands.pressDivide': 'Press "Divide boreholes" to commit.',
  'sections.bands.setPackingClass': 'Set packing class',
  'sections.bands.movePackingBoundary': 'Move packing boundary',
  'sections.bands.splitPackingBand': 'Split packing band',
  'sections.bands.mergePackingBands': 'Merge packing bands',
  'sections.bands.absorbPackingLens': 'Absorb packing lens',
  'sections.bands.disconnectPackingBands': 'Disconnect packing bands',

  'sections.lens.candidate':
    'Lens candidate — no correlation on either neighbour. Pinch it out to claim it as a lens.',
  'sections.lens.pinchOutCandidate': 'Pinch-out lens candidate — this layer pinches out toward the neighbour',
  'sections.lens.name': 'Lens name',
  'sections.lens.namePlaceholder': 'e.g. Boom Klei lens #1',
  'sections.lens.nameDialogTitle': 'Name lens',
  'sections.lens.saveName': 'Save name',
  'sections.lens.namedKeptHint':
    'A named lens is kept: it survives "Delete all detected lenses" and the next body recompute.',
  'sections.lens.boundaryStyle': 'Boundary style',
  'sections.lens.boundaryStyleHint': 'How the lens boundary is drawn between its control nodes.',
  'sections.lens.presentAt': 'Present at',
  'sections.lens.absentAt': 'Absent at',
  'sections.lens.noAbsenceRecords': 'No absence records.',
  'sections.lens.promoteToManual':
    'Promote from inferred to manual — the inference engine will no longer overwrite this row',
  'sections.lens.companionTitle': 'Create perpendicular cross-section?',
  'sections.lens.companionBlurb':
    'A perpendicular cross-section through the lens centroid helps verify the lens really pinches out in both directions.',
  'sections.lens.companionSkip': 'No, skip',
  'sections.lens.perpendicularSection': 'Perpendicular section…',

  'sections.tie.accept': 'Accept tie',
  'sections.tie.reject': 'Reject tie',
  'sections.tie.proposed': 'Proposed tie-section — right-click to Accept or Reject',
  'sections.tie.keepFlagged': 'Keep them flagged',
  'sections.tie.flaggedBlurb':
    'Deleting is one step on the undo stack. While a mismatched tie waits for review it is drawn with a warning mark.',
  'sections.reviewFlag.correlateOneBand': 'Correlate → one band',
  'sections.reviewFlag.uncorrelatedClay': 'Uncorrelated clay',

  'sections.dem.groundSurface': 'Ground surface (DHMVII DTM)',
  'sections.vb.title': 'DOV virtuele boring',
  'sections.vb.toggleHint': 'Show / hide the DOV Virtuele Boring overlay controls',
  'sections.vb.loadingCatalogue': 'Loading catalogue…',
  'sections.vb.depthBelowSurface': 'm below surface',
  'sections.vb.full': 'Full',
  'sections.vb.off': 'Off',
  'sections.psd.noGrainSize': 'No grain-size test',
  'sections.psd.finerByWeight': '% finer by weight',
  'sections.psd.highlightBody': 'Click to highlight packing body',
} as const
