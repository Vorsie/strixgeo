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
  // Presentation-boundary translation of the English canonical default section
  // names ("Cross-section N" / "Tie-section N" stored at creation). Only the
  // untouched defaults are matched; a user-renamed section shows its own name
  // verbatim. ``{n}`` is the 1-based ordinal.
  'sections.kindLabel.cross': 'Cross-section {n}',
  'sections.kindLabel.tie': 'Tie-section {n}',
  'sections.properties': 'Section properties',
  'sections.modelActions': 'Model actions',
  'sections.moreActions': 'More section actions',
  // Headings of the ⋯ More menu (owner 2026-09-11: "the more menu is too
  // populated"). Three groups, in this reading order: what acts on the model,
  // what acts on the cross-section itself, what leaves the app.
  'sections.moreGroup.model': 'Model',
  'sections.moreGroup.section': 'Section',
  'sections.moreGroup.export': 'Export',
  'sections.geoVerbHint':
    'Switch to the Stratigraphy axis: Build / Seed / Dedupe / Plaxis-3D act on the stratigraphic model',
  'sections.undoTitle': 'Undo the last model edit (Ctrl+Z)',
  'sections.undoNothing': 'Nothing to undo',
  // Warning toast when the automatic body-identity recompute fails (owner
  // ruling 6, 2026-09-12: the manual verb is gone, so a failure must still tell
  // the user identity did not persist).
  'sections.recompute.backgroundFailed':
    'Body identity could not be saved in the background. It is tried again at your next edit.',
  'sections.reset.done':
    'Reset {count} hand-drawn {noun}. Bodies returned to their computed shape.',
  'sections.reset.boundaryOne': 'boundary',
  'sections.reset.boundaryMany': 'boundaries',
  'sections.reset.none': 'No hand-drawn boundaries to reset.',
  'sections.reset.failed': 'Reset manual points failed. See console.',

  // Toolbar-owned modal + confirmation dialogs.
  'sections.dialog.thisSection': 'This section',
  'sections.dialog.deleteBody':
    'will be permanently deleted. Formation contacts placed on it are also removed. This cannot be undone.',
  'sections.dialog.deleteConfirmButton': 'Delete cross-section',
  'sections.dialog.bulkPrefix': 'The lithology segmenter will run for',
  'sections.dialog.bulkSuffix':
    'in this section. Any existing bulk-suggest ghosts will be replaced. Already-committed contacts on the section stay untouched.',
  'sections.dialog.noInvestigations': 'No investigations',
  'sections.dialog.resetBody':
    'Every hand-drawn boundary point on this model will be cleared and the bodies will return to their computed shape. This cannot be undone.',

  // Sections inspector (right panel) — list, properties, model actions,
  // borehole-preview legend, formation list, crossings banner.
  'sections.inspector.noCrossSectionForContact':
    'No cross-section contains the offending contact. Draw one through the borehole or CPT to view it.',
  'sections.inspector.staleBadge': '{n} stale',
  // The representative-qc explanation, moved out of the ⋯ menu rows (owner
  // 2026-09-11): it is information about the choice, not a verb, so it reads
  // here while the picker itself stays on the toolbar.
  'sections.inspector.representativeQc': 'Representative qc',
  // The chosen statistic, shown once (owner ruling 5, 2026-09-12). The token
  // (median / harmonic / …) is a technical term shown verbatim, the same value
  // the toolbar's qc dropdown shows.
  'sections.inspector.chosenStatistic': 'Statistic: {statistic}',
  'sections.inspector.geologicalModel': 'Stratigraphic model',
  'sections.inspector.previewLegend':
    'Hatched bands = preview. Right-click a ghost column to divide just that borehole, or press “4 · Divide boreholes” to commit them all.',
  'sections.inspector.previewClampedOne':
    '{n} planned band outside the depth window. Zoom out to see it.',
  'sections.inspector.previewClampedMany':
    '{n} planned bands outside the depth window. Zoom out to see them.',
  'sections.inspector.backdropClickPrefix': 'Click',
  'sections.inspector.backdropClickSuffix': 'in Model actions to load.',
  // Section list.
  'sections.inspector.setCrsFirst': 'Set a Default horizontal CRS in Project metadata first',
  'sections.inspector.createSection': 'Create a new cross-section',
  'sections.inspector.setCrsToCreate': 'Set a CRS to create sections',
  'sections.inspector.dirtyCreated': 'Created since last save. File → Save to commit',
  // Crossings banner.
  'sections.inspector.validationFailedLabel': 'Surface validation failed',
  'sections.inspector.validationFailedBody':
    'Surface crossings could NOT be checked. This is not a clean result. Rebuild or reopen the project to check again.',
  'sections.inspector.validationPendingLabel': 'Surface validation pending',
  'sections.inspector.validationPendingBody':
    'Surface crossings not checked. Build the 3D model to validate.',
  'sections.inspector.crossingWarningsLabel': 'Surface crossing warnings',
  'sections.inspector.crossingsDetectedOne': '{n} surface crossing detected',
  'sections.inspector.crossingsDetectedMany': '{n} surface crossings detected',
  'sections.inspector.openOffendingSection':
    'Open the cross-section containing the offending contacts and pan to them.',
  // Model actions.
  'sections.inspector.geoAxisHintBuildDedupe':
    'Switch to the Stratigraphy axis: Build / Dedupe act on the stratigraphic model',
  'sections.inspector.buildNoModel':
    'No active stratigraphic model. Create formations and contacts first',
  'sections.inspector.buildingSurfaces': 'Building surfaces…',
  'sections.inspector.surfacesNeedRebuildOne':
    '{n} formation surface needs rebuilding. Click to compute TINs',
  'sections.inspector.surfacesNeedRebuildMany':
    '{n} formation surfaces need rebuilding. Click to compute TINs',
  'sections.inspector.rebuildTins': 'Rebuild TIN surfaces from current contacts',
  'sections.inspector.building': 'Building…',
  'sections.inspector.buildStale': 'Build · {n} stale',
  'sections.inspector.buildModel': 'Build model',
  'sections.inspector.noParentGeoModel': 'No parent stratigraphic model linked',
  'sections.inspector.loadingGeoSurfaces': 'Loading stratigraphic surfaces…',
  'sections.inspector.syncGeologyTitle':
    'Load the parent stratigraphic model’s surfaces as a read-only backdrop reference on this section',
  'sections.inspector.syncing': 'Syncing…',
  'sections.inspector.syncGeology': 'Sync stratigraphy',
  'sections.inspector.seedDefineFirst':
    'Define formations in the Stratigraphy stage first. Seed places contacts for already-defined layers',
  'sections.inspector.seedingContacts': 'Seeding contacts from borehole stratigraphy…',
  'sections.inspector.seedTitle':
    'Place contacts from borehole observations for formations already defined in the model. Run Dedupe if duplicates appear',
  'sections.inspector.seeding': 'Seeding…',
  'sections.inspector.seed': 'Seed',
  'sections.inspector.seedDefineFirstShort': 'Define formations in the Stratigraphy stage first',
  'sections.inspector.allHaveGeologyContacts':
    'All boreholes in scope already have stratigraphy contacts. Import new tests to use this',
  'sections.inspector.seedNewTestsTitleOne':
    'Place contacts from stratigraphy for the {n} borehole with no stratigraphy contacts yet',
  'sections.inspector.seedNewTestsTitleMany':
    'Place contacts from stratigraphy for the {n} boreholes with no stratigraphy contacts yet',
  'sections.inspector.seedForNewTests': 'Seed for new tests',
  'sections.inspector.cleaning': 'Cleaning…',
  'sections.inspector.dedupeTitle':
    'Remove duplicate (anchor, formation) contacts. Keeps the most-recent pick in each group',
  'sections.inspector.dedupe': 'Dedupe',
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
    'Spacing between investigations: at 0% tests render at their true projected X (bands may overlap)',
  'sections.referenceGeologicalModel': 'Reference stratigraphic model',
  'sections.geologyBackdrop': 'Stratigraphy backdrop (litho axis)',
  'sections.geologyBackdropHint': 'Shown as a faint reference layer when the litho axis is active.',
  'sections.syncGeology': 'Sync stratigraphy',
  'sections.boreholePreview': 'Borehole preview',
  'sections.virtueleBoringOverlay': 'Virtuele Boring overlay',
  'sections.closeView': 'Close section view',
  'sections.closeViewHint': 'Close section view (back to map)',
  // Map | Section view tabs above an open section (owner 2026-09-10: "waar is
  // het knopje om terug te gaan naar map view voor cross sections?") — the
  // same strip the Data stage shows for a detail.
  'sections.viewTabMap': 'Map',
  'sections.viewTabSection': 'Section',
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

  // Axis pill — the Geology / Litho / Geotech segmented control.
  'sections.axis.geoShort': 'Geo',
  'sections.axis.litho': 'Litho',
  'sections.axis.geotech': 'Geotech',
  'sections.axis.createLithoFirst': 'Create a lithological model in the Lithology stage first',
  'sections.axis.editLithoContacts':
    'Edit the lithological model contacts on this section',
  'sections.axis.createLithoForPacking':
    'Create a lithological model first. Packing subdivides litho bodies',
  'sections.axis.viewGeotech':
    'View geotechnical subdivision (NAD packing classes) on this section',
  'sections.axis.noGeotechYet':
    'No geotech model yet. “Packing pipeline → 1 · Subdivide CPTs” creates it',

  // Model-level words, interpolated into the export + recompute tooltips. Kept
  // as their own keys so "No active {level} model" reads grammatically in each
  // locale (Dutch keeps the adjective before the noun, same as English).
  'sections.level.litho': 'lithological',
  'sections.level.geotech': 'geotechnical',
  'sections.level.geological': 'stratigraphic',

  // Transient busy labels shared by several verbs.
  'sections.busy.accepting': 'Accepting…',
  'sections.busy.creating': 'Creating…',
  'sections.busy.deleting': 'Deleting…',
  'sections.busy.exporting': 'Exporting…',
  'sections.busy.suggesting': 'Suggesting…',
  'sections.busy.subdividing': 'Subdividing…',
  'sections.busy.correlating': 'Correlating…',
  'sections.busy.dividing': 'Dividing…',

  // Tail verbs — New / Delete / Tie-sections.
  'sections.tail.newSection': 'New cross-section',
  'sections.tail.newSectionTitle': 'Create a new cross-section (placeholder endpoints)',
  'sections.tail.delete': 'Delete',
  'sections.tail.deleteSectionMenu': 'Delete cross-section…',
  'sections.tail.deleteSelectFirst': 'Select a cross-section to delete it',
  'sections.tail.deleteConfirmMenuTitle': 'Delete "{name}". Asks for confirmation first',
  'sections.tail.deleteTitle': 'Delete "{name}"',

  // Tie-sections split verb (tail).
  'sections.tie.suggestSections': 'Suggest tie-sections',
  'sections.tie.clearSuggestions': 'Clear tie suggestions',
  'sections.tie.acceptAll': 'Accept all ties',
  'sections.tie.acceptAllRunFirst': 'Run "Suggest tie-sections" first',
  'sections.tie.acceptAllBusy': 'Creating cross-sections for all proposed ties…',
  'sections.tie.acceptAllTitle': 'Create a cross-section for every proposed tie',
  'sections.tie.needTwo': 'Need at least 2 sections to tie together',
  'sections.tie.clearTitle': 'Clear the current tie-section suggestions',
  'sections.tie.suggestTitle':
    'Suggest perpendicular connector sections between existing sections (no crossings, no shared tests)',

  // Export dropdown.
  'sections.export.selectSection': 'Select a section to export',
  'sections.export.dropdownTitle': 'Export the model or this section',
  'sections.export.hubJumpTitle': 'Open the Export stage with this section selected',
  'sections.export.sectionDxf': 'Section DXF',
  'sections.export.exportingDxf': 'Exporting DXF…',
  'sections.export.noModelContacts': 'No active {level} model. Contacts must exist first',
  'sections.export.dxfTitle': 'Export this section’s {level} model as DXF',
  'sections.export.plaxisScript': 'Plaxis 3D script',
  'sections.export.exportingPlaxis': 'Exporting Plaxis…',
  'sections.export.noGeologicalModel': 'No active stratigraphic model',
  'sections.export.plaxisTitle':
    'Export the stratigraphic model as a Plaxis 3D plxscripting Python script',
  'sections.export.sectionPdf': 'Section PDF report',
  'sections.export.noModelDefine': 'No active {level} model. Define one first',
  'sections.export.pdfTitle': 'Generate a PDF report of this section’s {level} model',
  // D-Series (closed-geometry) rows. The label + format names stay identical in
  // NL (product + file-extension names).
  'sections.export.dstability': 'D-Stability (.stix)',
  'sections.export.exportingDstability': 'Exporting D-Stability…',
  'sections.export.dsheetpiling': 'D-Sheet Piling (.shi)',
  'sections.export.exportingDsheetpiling': 'Exporting D-Sheet Piling…',
  'sections.export.dstabilityFilter': 'D-Stability model',
  'sections.export.dsheetpilingFilter': 'D-Sheet Piling profile',
  'sections.export.dxfFilter': 'AutoCAD DXF',
  'sections.export.dxfSuccess': 'DXF exported.',
  'sections.export.dxfFailure': 'Could not export the DXF.',
  'sections.export.dstabilitySuccess': 'D-Stability model exported.',
  'sections.export.dsheetpilingSuccess': 'D-Sheet Piling profile exported.',
  'sections.export.dstabilityFailure': 'Could not export the D-Stability model.',
  'sections.export.dsheetpilingFailure': 'Could not export the D-Sheet Piling profile.',
  'sections.export.dstabilityDescribes':
    'model as a D-Stability .stix (geometry only, no design parameters)',
  'sections.export.dsheetpilingDescribes':
    'model as a D-Sheet Piling .shi soil profile through the section (geometry only)',
  'sections.export.dseriesRowTitle': 'Export this section’s {level} {describes}',
  'sections.export.nothingDrawn':
    'Nothing to export: this section has no drawn {level} geometry between two columns.',
  'sections.export.readFailed': 'Could not read this section. Nothing was exported.',

  'sections.toolbar.display': 'Display',
  'sections.toolbar.bodies': 'Bodies',
  'sections.toolbar.geology': 'Stratigraphy',
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
  'sections.toolbar.editGeologyContacts': 'Edit the stratigraphic model contacts on this section',
  'sections.toolbar.noLithoModel': 'No lithological model. Create one in the Lithology stage.',
  'sections.toolbar.showLayers': 'Show or hide layers of the section view',
  'sections.toolbar.applyNextSubdivide': 'Applies to the next Subdivide. Nothing re-runs now',
  'sections.toolbar.statisticFailed': 'Could not set the statistic.',
  'sections.toolbar.noPackingBands':
    'No packing bands on this section yet. Run "1 · Subdivide CPTs" on this section first',
  'sections.toolbar.packingFlowHint':
    'The four-step packing flow: 1 subdivide the CPTs, 2 propose ties, 3 review and accept them, 4 divide the boreholes. All four act on the section you have open and leave every other section as it is, so you can finish one cross-section while the next still has proposals waiting. Step 4 stays locked until this section’s ties are all accepted or deleted.',
  'sections.toolbar.previewDivideHint':
    'Preview the packing bands "4 · Divide boreholes" would commit, hatched over the borehole columns. Nothing is written.',
  'sections.toolbar.lithoFillHint':
    'Colour every body’s closed loop with its lithology, across the section. Do this once correlations + pinch-outs are done. Toggles on / off.',
  'sections.toolbar.correlationRibbonsHint':
    'Show or hide the correlation ribbons + lines drawn across the section. A 2-D visualisation of your correlations only. It has no link to the 3-D model. Toggles on / off.',
  'sections.toolbar.solidFillHint':
    'Show or hide the cross-section fill sampled from the built 3-D solids. Toggles on / off.',
  'sections.toolbar.geotechSolidFillHint':
    'Show or hide the fill cut out of the BUILT 3-D geotechnical solids: the model as of the last Build, not the live bands. One fill renders at a time.',
  'sections.toolbar.packingFillHint':
    'Show or hide the NAD packing-band fill: the LIVE packing classes, as the pipeline last wrote them. One fill renders at a time.',
  'sections.toolbar.swapFillHint':
    'Swap the lithological fill in for the NAD packing fill. One fill renders at a time, never both.',
  'sections.toolbar.qcStatisticHint':
    'Which representative qc the NAD classifier reads, chosen BEFORE you build the packing bands under it. The choice applies to the NEXT "1 · Subdivide CPTs", and bands already on screen keep the statistic they were built with until you re-run it.',
  'sections.toolbar.sampleMarkersHint':
    'Show or hide the lab-sample markers on the borehole columns. Each marker spans the depth interval its sample was taken over.',
  'sections.toolbar.psdCardHint':
    'Show a grain-size distribution card while hovering a sample marker. Press P to toggle without opening this menu.',

  // Litho-axis toolbar verbs + their caret / dropdown menus.
  'sections.litho.suggest': 'Suggest',
  'sections.litho.suggestAll': 'Suggest all',
  'sections.litho.createModelFirst': 'Create a lithological model first',
  'sections.litho.openSectionSuggest': 'Open a cross-section to use Suggest',
  'sections.litho.fetchingSuggestions': 'Fetching suggestions…',
  'sections.litho.suggestAllTitle':
    'Right-click a column to focus one, or click to suggest layers for every investigation in this section ({n})',
  'sections.litho.suggestFocusHint':
    'Right-click a column in the section to focus a CPT or borehole, then Suggest',
  'sections.litho.suggestForColumn': 'Suggest lithological layers for {column}',
  'sections.litho.theFocusedInvestigation': 'the focused investigation',
  'sections.litho.acceptAll': 'Accept all',
  'sections.litho.committingSuggestions': 'Committing all suggestion layers…',
  'sections.litho.acceptAllTitle':
    'Accept all non-rejected suggestion layers as lithological contacts',
  'sections.litho.clear': 'Clear',
  'sections.litho.acceptAllBulk': 'Accept all (bulk)',
  'sections.litho.committingBulk': 'Committing all bulk suggestion layers…',
  'sections.litho.acceptAllBulkTitle':
    'Accept every non-rejected suggestion across all {n} bulk-ghost {investigation}',
  'sections.litho.investigationOne': 'investigation',
  'sections.litho.investigationMany': 'investigations',
  'sections.litho.clearBulk': 'Clear bulk',
  'sections.litho.correlateActive': 'Correlate · click 2 bands',
  'sections.litho.correlate': 'Correlate',
  'sections.litho.enterCorrelate': 'Enter correlate mode',
  'sections.litho.exitCorrelate': 'Exit correlate mode',
  'sections.litho.openSectionCorrelate': 'Open a cross-section to correlate units',
  'sections.litho.acceptFirstToCorrelate':
    'Accept litho suggestions to enable correlation: 0 accepted contacts on this section',
  'sections.litho.exitCorrelateEsc': 'Exit correlate mode (Esc)',
  'sections.litho.enterCorrelateTitle':
    'Enter correlate mode. Click a unit band on one investigation, then a matching unit on another to link them',
  'sections.litho.bodiesTitle': 'Fill body bands, toggle overlays, and reset manual points',
  'sections.litho.admixturesDisabled':
    'Suggest litho layers first. Admixture edits act on ghost suggestions',
  'sections.litho.admixturesTitle': 'Strip or reseed admixtures on the current ghost suggestions',
  // Suggest caret menu.
  'sections.litho.suggestAllInSection': 'Suggest all in this section',
  'sections.litho.openSectionFirst': 'Open a cross-section first',
  'sections.litho.runningSegmenterAll': 'Running segmenter on every investigation in this section…',
  'sections.litho.suggestAllInSectionTitle':
    'Suggest lithological layers for every investigation in this section at once',
  'sections.litho.suggestNewTests': 'Suggest for new tests',
  'sections.litho.runningSegmenter': 'Running segmenter…',
  'sections.litho.allHaveContacts':
    'All visible investigations already have litho contacts. Import new tests to use this',
  'sections.litho.suggestNewTestsTitle':
    'Suggest layers for the {n} {investigation} with no litho contacts yet',
  // Correlate caret menu.
  'sections.litho.autoCorrelate': 'Auto-correlate',
  'sections.litho.runningAutoCorrelate': 'Running auto-correlate…',
  'sections.litho.autoCorrelateTitle':
    'Auto-correlate: match contacts at neighbouring investigations within a depth + distance tolerance. Inserts unapproved edges across the whole model. Use "Accept correlations" to approve.',
  'sections.litho.acceptCorrelations': 'Accept correlations',
  'sections.litho.openSectionAcceptCorr': 'Open a cross-section to accept correlations',
  'sections.litho.acceptingCorrelations': 'Accepting correlations…',
  'sections.litho.acceptCorrelationsTitle':
    'Accept all unapproved contact-level correlation edges in this section. Commits lens bodies and recomputes ordinals',
  'sections.litho.clearCorrelationsTitle':
    'Remove all unapproved correlation suggestions across the model (keeps approved correlations). Reversible. Re-run Auto-correlate to regenerate.',
  // Bodies dropdown menu.
  'sections.litho.fillBands': 'Fill bands',
  'sections.litho.hideBands': 'Hide bands',
  'sections.litho.showCorrelations': 'Show correlations',
  'sections.litho.hideCorrelations': 'Hide correlations',
  'sections.litho.showModelFill': 'Show model fill',
  'sections.litho.hideModelFill': 'Hide model fill',
  'sections.litho.resetManualPoints': 'Reset manual points',
  'sections.litho.resetting': 'Resetting…',
  'sections.litho.resetManualPointsTitle':
    'Clear every hand-drawn body boundary point on this model. Bodies return to their computed shape. Cannot be undone.',
  // Admixtures dropdown menu.
  'sections.litho.stripCptAdmixtures': 'Strip CPT admixtures',
  'sections.litho.noCptGhosts': 'No CPT ghost suggestions',
  'sections.litho.stripCptTitle': 'Clear admixtures from every CPT ghost suggestion',
  'sections.litho.stripBoreholeAdmixtures': 'Strip borehole admixtures',
  'sections.litho.noBoreholeGhosts': 'No borehole ghost suggestions',
  'sections.litho.stripBoreholeTitle': 'Clear admixtures from every borehole ghost suggestion',
  'sections.litho.reseedBoreholeTitle':
    'Restore the segmenter’s admixtures on borehole ghosts (undo a strip)',

  // Lab-sample view toggles (shared by the litho Bodies + geotech Display menus).
  'sections.samples.show': 'Show samples',
  'sections.samples.hide': 'Hide samples',
  'sections.samples.showPsd': 'Show PSD preview on hover',
  'sections.samples.hidePsd': 'Hide PSD preview on hover',

  // Geotech-axis toolbar verbs + their dropdown menus (statistic / pipeline /
  // correlate-packing / display).
  'sections.geotech.statisticMenuTitle':
    'Which representative qc the NAD classifier reads, chosen BEFORE you subdivide: median (spike-robust default), arithmetic, harmonic (conservative: weighted toward the low values that govern bearing and settlement) or geometric. Nothing re-classifies when you change it: the choice applies to the NEXT "1 · Subdivide CPTs", and bands already on screen keep the statistic they were built with until you re-run it.',
  'sections.geotech.pipeline': 'Packing pipeline',
  'sections.geotech.correlatePacking': 'Correlate packing',
  'sections.geotech.exitPackingCorrelate': 'Exit packing-correlate mode',
  'sections.geotech.correlatePackingByHand': 'Correlate packing by hand',
  'sections.geotech.correlatePackingNoModel':
    'Run “1 · Subdivide CPTs” first to create packing bands',
  'sections.geotech.exitPackingCorrelateEsc': 'Exit packing-correlate mode (Esc)',
  'sections.geotech.correlatePackingTitle':
    'Connect same-class packing bands across investigations within the same litho body: the hand correlation the pipeline’s step 2 automates',
  'sections.geotech.currentTag': 'current',
  'sections.geotech.harmonicHint':
    'Conservative: weighted toward the low qc values that govern bearing and settlement.',
  'sections.geotech.medianHint': 'The spike-robust default.',
  'sections.geotech.step1': '1 · Subdivide CPTs',
  'sections.geotech.reRunUnder': 're-run under {stat}',
  'sections.geotech.columnsNeedRederive': '{n} {phrase} re-deriving',
  'sections.geotech.columnNeeds': 'column needs',
  'sections.geotech.columnsNeed': 'columns need',
  'sections.geotech.step1OpenSection':
    'Open a cross-section first. This step subdivides the CPTs on the section you have open',
  'sections.geotech.step1Title':
    'Step 1 of 4: derive NAD packing classes (1–31) on THIS section’s CPTs, leaving every other section’s bands, ties and bodies untouched. Correlates nothing: “2 · Auto-correlate” proposes the packing ties next. Creates the geotechnical model on first run. A CPT that is on no cross-section is never subdivided.',
  'sections.geotech.step2': '2 · Auto-correlate',
  'sections.geotech.step2OpenSection':
    'Open a cross-section first. This step proposes ties on the section you have open',
  'sections.geotech.noBandsHere':
    'No packing bands on this section yet. Run “1 · Subdivide CPTs” on this section first',
  'sections.geotech.step2Title':
    'Step 2 of 4: derive the same-class packing ties inside each correlated litho unit ON THIS SECTION, jumping across borehole columns that carry no packing yet. Ties that restate a litho correlation you already approved arrive ACCEPTED; the rest arrive as proposals. Hand-drawn correlations are never touched.',
  'sections.geotech.step3': '3 · Accept ties',
  'sections.geotech.pendingHere': '{n} pending here',
  'sections.geotech.step3OpenSection':
    'Open a cross-section first. This step accepts the ties on the section you have open',
  'sections.geotech.step3Title':
    'Step 3 of 4: review, then approve, on the section in front of you. First DELETE the faulty proposals (right-click a tie → Delete) and accept the ones you want to check off singly (right-click → Accept tie). Then press this to accept every remaining proposal ON THIS SECTION. Afterwards, hand-connect anything auto-correlate missed with “Correlate packing”.',
  'sections.geotech.step4': '4 · Divide boreholes',
  'sections.geotech.staleReDivide': 'stale: re-divide',
  'sections.geotech.step4OpenSection':
    'Open a cross-section first. This step divides the boreholes on the section you have open',
  'sections.geotech.staleReDivideTitle':
    'Bodies or correlations changed. Re-divide the boreholes to match',
  'sections.geotech.step4Title':
    'Step 4 of 4: TIN-divide THIS section’s borehole columns into packing bands, using the CPT transition surfaces and the ties you accepted, and leave every other section as it is. Right-click one borehole’s ghost bands to divide just that column.',
  'sections.geotech.showFill': 'Show fill',
  'sections.geotech.hideFill': 'Hide fill',
  'sections.geotech.showLithoFill': 'Show litho fill',
  'sections.geotech.hideLithoFill': 'Hide litho fill',
  'sections.geotech.showBoreholePreview': 'Show borehole preview',
  'sections.geotech.hideBoreholePreview': 'Hide borehole preview',
  'sections.geotech.correlationsHint':
    'Show or hide the correlation ribbons drawn across the section (2-D visualisation only).',

  // Pending-tie scope chip + tooltip (utils/geotechPendingScope). The word
  // helpers below are interpolated into the sentences, so their {n} placeholder
  // must match across locales.
  'sections.geotech.pendingModel': '{n} pending',
  'sections.geotech.tiesOne': '{n} packing tie',
  'sections.geotech.tiesMany': '{n} packing ties',
  'sections.geotech.sectionsOne': '{n} section',
  'sections.geotech.sectionsMany': '{n} sections',
  'sections.geotech.pendingTitleModel':
    '{ties} proposed and not yet accepted ({accepted} accepted).',
  'sections.geotech.pendingTitleSection':
    '{sectionPending} of {ties} proposed on this section ({accepted} accepted model-wide).{rest}',
  'sections.geotech.pendingElsewhere':
    ' The other {elsewhere} sit on {sections}, which “4 · Divide boreholes” also needs clear.',
  'sections.geotech.pendingNowhereElse': ' Nothing is pending anywhere else in the model.',
  'sections.geotech.divideTagModel': 'accept {n} first',
  'sections.geotech.divideTagSection': 'accept {n} on this section',
  'sections.geotech.divideTitleModel':
    '{ties} still proposed. Accept or delete them first',
  'sections.geotech.divideTitleSection':
    "{ties} still proposed on this section. Dividing its boreholes reads the ties you accepted to decide where each borehole's packing comes from. Accept or delete these first. Nothing on another section is touched.",

  // Stale-litho column chip + tooltip (utils/staleGeotechColumns).
  'sections.geotech.staleChipLabel': '{n} on edited litho',
  'sections.geotech.staleTitleNone': 'Every packing column matches the lithology under it.',
  'sections.geotech.staleAndMore': '{named} and {rest} more',
  'sections.geotech.staleTitleOne':
    'This column’s lithology changed after the packing bands were made: {list}. The bands still describe the old stack. Re-run the subdivision on them ("1 · Subdivide CPTs" for tests, "4 · Divide boreholes" for boreholes) before exporting.',
  'sections.geotech.staleTitleMany':
    'These columns’ lithology changed after the packing bands were made: {list}. The bands still describe the old stack. Re-run the subdivision on them ("1 · Subdivide CPTs" for tests, "4 · Divide boreholes" for boreholes) before exporting.',
  // Inspector "Packing out of date" line — what the yellow "!" marker means +
  // how to fix it (owner installer #40: the marker "doesn't point the user to
  // how to solve it").
  'sections.geotech.staleInspectorLabel': 'Packing out of date',
  'sections.geotech.staleInspectorBody':
    'Packing on {list} was derived from an older lithology. Press Subdivide (Onderverdelen) to re-derive it.',
  'sections.geotech.staleInspectorSubdivide': 'Subdivide',

  'sections.header.cptChannels': 'CPT data channel toggles',
  'sections.header.qc': 'Cone resistance (qc)',
  'sections.header.fs': 'Sleeve friction (fs): CPTU/CPTE only',
  'sections.header.rf': 'Friction ratio (Rf)',
  'sections.header.u2': 'Pore-water pressure (u2): CPTU only',
  'sections.header.qTotal': 'Total resistance (qTotal): CPTM only',
  'sections.header.streamToggles':
    'Borehole interpretation stream toggles: each enabled stream renders as its own strip side by side',
  'sections.header.formalStratigraphy': 'Formal stratigraphy',
  'sections.header.informalStratigraphy': 'Informal stratigraphy',
  'sections.header.codedLithology': 'Coded lithology',
  'sections.header.geotechnicalCoding': 'Geotechnical coding',

  'sections.hints.f1': 'Press F1 for the full gesture reference',
  // The canvas-wide pan/zoom/column gesture line (was hardcoded in CanvasHints
  // until the 2026-09-01 i18n pass).
  'sections.hints.panZoom':
    'Drag to pan · scroll to zoom · right-click a column to focus · double-click a column to open',
  'sections.hints.lithoLayer':
    'Litho layer: double-click to accept · Alt+drag to copy composition · drag a boundary onto its neighbour and release to merge · right-click for more',
  'sections.hints.acceptFirst':
    'Accept litho suggestions to enable correlation: 0 accepted contacts on this section.',
  'sections.hints.buildGeotechFirst':
    'Build the geotech model for this section before suggesting NAD subdivision.',

  // Section context menus + gestures.
  'sections.menu.body': 'Body extent actions',
  'sections.menu.dissolveBody': 'Dissolve body',
  'sections.menu.nameBody': 'Name body…',
  // Body-verb simplification (owner ruling 2026-09-01 "way too complicated"):
  // the geotech body verbs are Join + Ontkoppelen only. Separate / Rejoin were
  // removed entirely. ``{label}`` is the other body's display label. The Dutch
  // "Ontkoppelen" is the owner's approved word; the EN "Un-join" mirrors it.
  'sections.menu.joinBody': 'Join with…',
  'sections.menu.unjoinBody': 'Un-join from {label}',
  'sections.menu.focusTest': 'Focus this test',
  'sections.menu.openDetail': 'Open detail',
  'sections.menu.removeFromSection': 'Remove from this section',
  'sections.menu.clearSubdivision': 'Clear subdivision',
  // The column context menu's aria-label; ``{name}`` is the column display name.
  'sections.menu.actionsFor': 'Actions for {name}',
  'sections.menu.deleteContact': 'Delete contact',
  'sections.menu.linkToGeology': 'Link to stratigraphy',
  'sections.menu.unlinkFromGeology': 'Unlink from stratigraphy',
  'sections.menu.editInGeology': 'Edit in Stratigraphy stage',
  'sections.menu.mergeLayers': 'Merge layers',
  // Reads "Delete unit" so it never blurs with the column verb "Remove from
  // this section" above it in the unified menu (owner ruling 12, 2026-09-12).
  'sections.menu.removeLithoUnit': 'Delete unit',
  'sections.menu.addSuggestionHere': 'Add new suggestion here',
  'sections.menu.unitStatistics': 'Unit statistics…',
  'sections.menu.insertLayerHere': 'Insert layer here…',
  'sections.menu.editComposition': 'Edit composition…',
  'sections.menu.splitLayer': 'Split layer',
  // Accepted-layer verbs (installer #21): an accepted litho layer can be
  // recomposed or split at the clicked depth without deleting it.
  'sections.menu.splitHere': 'Split here',
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
  // Owner #35: a borehole band is splittable too, at the right-click depth (no
  // cursor-following placement — the class is kept, so there is nothing to place).
  'sections.menu.splitBandHere': 'Split band here',
  // Owner #35: the packing classes moved off the first menu into a submenu behind
  // this one row, so the verbs above are no longer pushed below the fold.
  'sections.menu.packingClass': 'Packing class',
  // Geotech band edit menu — the two "Remove band" directions (were hardcoded in
  // GeotechBandEditOverlay until the 2026-09-01 i18n pass).
  'sections.bandMenu.removeUp': 'Remove band (merge into band above)',
  'sections.bandMenu.removeDown': 'Remove band (merge into band below)',

  // Along-section axis title (was hardcoded in SectionPanel).
  'sections.axisLabel.alongM': 'Distance along section (m)',

  // Body Join / Ontkoppelen flow (owner ruling 2026-09-01) — the armed hint,
  // toasts and advisories. ``{label}`` is the armed body.
  'sections.join.armHint': 'Joining {label}. Click the other body · Esc cancels',
  'sections.join.success': 'Bodies grouped. Right-click the body → Un-join to undo.',
  'sections.join.blockedSeparation':
    'Join blocked by a standing separation. Remove that separation first.',
  // A body is one soil + one packing class, so a Join across two masses is
  // refused. TWO messages, picked by whether the SOILS differ (owner ruling
  // 2026-09-01): same soil + different packing class → crossPacking; different
  // soil → crossLitho. Shared verbatim by the commit toast (joinErrorToastKey)
  // and the arm-time advisory (resolveJoinPick). The old single crossClass /
  // noticeCrossClass keys + the "{classA} and {classB}" tail were retired here.
  'sections.join.crossPacking': 'You cannot merge two different packing classes.',
  'sections.join.crossLitho': 'You cannot merge two different lithologies.',
  'sections.join.failed': 'Failed to join bodies.',
  'sections.join.noticeSame': 'That is the same body. Click a different one to join.',
  'sections.join.noticeUnresolvable': 'Could not identify that body. Click a filled body.',
  'sections.unjoin.success': 'Un-grouped. The body stands on its own again.',
  'sections.unjoin.failed': 'Failed to un-join bodies.',

  'sections.contacts.insertHint': 'Click to insert new layer here · right-click to remove',
  'sections.contacts.lithoContactHint':
    'Lithological contact. Dragging it moves the litho model',
  'sections.contacts.coupledHint': 'Coupled to stratigraphic contact. Right-click to unlink',
  'sections.contacts.absorbHint':
    'Release here and the band below is absorbed into this unit. One boundary per drag. Drag again to take the next.',
  'sections.contacts.absorbBlockedHint':
    'Stops short of the next lithological contact. Going further would delete the unit below. Subdivide it first, or edit it on the lithology axis.',
  'sections.contacts.deleteConfirm':
    'Delete this contact? This removes the boundary and any correlations touching it.',
  'sections.contacts.deleteLensConfirm':
    'Delete this lens? This removes the two correlations that define it.',
  'sections.contacts.copyFailed':
    'Could not copy any contacts to the target. See console for details.',

  'sections.bands.rightClickBoundary':
    'Right-click to place a new packing boundary or remove this band',
  'sections.bands.rightClickClass':
    "Right-click to split this band or set its NAD packing class by hand",
  'sections.bands.nothingToSnap':
    'Nothing to snap to on this column. A borehole carries no cone resistance, so there are no packing boundaries here.',
  'sections.bands.acceptGhosts': 'Accept these bands (divide this borehole)',
  'sections.bands.pressDivide': 'Press "Divide boreholes" to commit.',
  'sections.bands.setPackingClass': 'Set packing class',
  'sections.bands.movePackingBoundary': 'Move packing boundary',
  'sections.bands.splitPackingBand': 'Split packing band',
  'sections.bands.mergePackingBands': 'Merge packing bands',
  'sections.bands.absorbPackingLens': 'Absorb packing lens',
  'sections.bands.disconnectPackingBands': 'Disconnect packing bands',

  'sections.lens.candidate':
    'Lens candidate. No correlation on either neighbour. Pinch it out to claim it as a lens.',
  'sections.lens.pinchOutCandidate': 'Pinch-out lens candidate. This layer pinches out toward the neighbour',
  'sections.lens.name': 'Lens name',
  'sections.lens.namePlaceholder': 'e.g. Boom Klei lens #1',
  'sections.lens.nameDialogTitle': 'Name lens',
  'sections.lens.saveName': 'Save name',
  'sections.lens.namedKeptHint':
    'A named lens is kept: it survives the detector’s reconcile and the next body recompute.',
  'sections.lens.boundaryStyle': 'Boundary style',
  'sections.lens.boundaryStyleHint': 'How the lens boundary is drawn between its control nodes.',
  'sections.lens.presentAt': 'Present at',
  'sections.lens.absentAt': 'Absent at',
  'sections.lens.noAbsenceRecords': 'No absence records.',
  'sections.lens.promoteToManual':
    'Promote from inferred to manual. The inference engine will no longer overwrite this row',
  'sections.lens.companionTitle': 'Create perpendicular cross-section?',
  'sections.lens.companionBlurb':
    'A perpendicular cross-section through the lens centroid helps verify the lens really pinches out in both directions.',
  'sections.lens.companionSkip': 'No, skip',
  'sections.lens.perpendicularSection': 'Perpendicular section…',

  'sections.tie.accept': 'Accept tie',
  'sections.tie.reject': 'Reject tie',
  'sections.tie.proposed': 'Proposed tie-section. Right-click to Accept or Reject',
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

  // --- P5 (sections) i18n coverage pass 2026-09-02 (builder P5). ---
  'sections.deleteContact.title': 'Delete contact at {name}?',
  'sections.deleteContact.body': 'This cannot be undone. The contact will be removed from the model and dependent surfaces will become stale.',
  'sections.findNoneFound': '0 found',
  'sections.glyph.elevationUnknown': ' · elevation unknown',
  'sections.glyph.deep': ' · {depth} m deep',
  'sections.glyph.offLine': ' · {offset} m off-line',
  'sections.glyph.clickForDetail': ' · click for detail',
  'sections.companion.lensNamedCreated': 'Lens "{name}" created.',
  'sections.companion.lensCreated': 'Lens created.',
  'sections.companion.blurb': 'A perpendicular cross-section through the lens centroid helps verify the lens geometry from a second direction.',
  'sections.companion.yesCreate': 'Yes, create section',
  'sections.contacts.refContactHint': '{name}. Right-click to edit in Stratigraphy stage',
  'sections.lithoMerge.title': 'Merge adjacent {litho} layers?',
  'sections.lithoMerge.body': 'Removing that contact left two {litho} units adjacent. Merging deletes the now-redundant boundary so they read as one continuous {litho} band.',
  'sections.keepSeparate': 'Keep separate',
  'sections.clampDrag.cannotMove': 'Can’t move further. Right-click and delete the adjacent layer first, then drag to the next boundary.',
  'sections.clampDrag.packingBoundary': 'Stops at this packing boundary. Drag again to take the next one.',
  'sections.copyComposition.title': 'Replace target composition?',
  'sections.copyComposition.body': 'The target layer already carries an edit. Replacing it will drop the existing composition.',
  'sections.copyComposition.from': 'From:',
  'sections.copyComposition.toCurrently': 'To (currently):',
  'sections.copyComposition.replace': 'Replace',
  'sections.crossingTie.countOne': '{n} crossing correlation tie',
  'sections.crossingTie.countMany': '{n} crossing correlation ties',
  'sections.crossingTie.labelFind': '⚠ {phrase}. Click to find',
  'sections.crossingTie.labelResolve': '⚠ {phrase}. Resolve to restore bands',
  'sections.crossingTie.aria': '{phrase}. Activate to centre the next one.',
  'sections.lens.candidateEither': 'Lens candidate. No correlation on either neighbour. Pinch it out rather than correlate it.',
  'sections.lens.pinchOutCandidateFull': 'Pinch-out lens candidate. This layer pinches out toward the neighbour, so the crossing correlation was not drawn. The 2/1/0 fill draws it as a lens automatically.',
  'sections.lens.styleStraight': 'straight',
  'sections.lens.styleBlocky': 'blocky',
  'sections.lens.styleRounded': 'rounded',
  'sections.nameBody.keptHint': 'A named lens is kept: it survives the detector’s reconcile and the next body recompute.',
  'sections.nameBody.placeholder': 'e.g. Sand lens, quay 7',
  'sections.lensPanel.bodyLabel': 'Body',
  'sections.lensPanel.confirming': 'Confirming…',
  'sections.lensPanel.confirmAllAuto': 'Confirm all auto ({count})',
  'sections.lensPanel.saving': 'Saving…',
  'sections.lensPanel.saveNameFirst': 'Save a lens name first',
  'sections.lensPanel.companionHint': 'Auto-create a perpendicular companion cross-section through the lens centroid',
  'sections.lensPanel.nameEmpty': 'Name cannot be empty.',
  'sections.lensPanel.bodyUnresolved': 'Body not yet resolved. Close and reopen the panel.',
  'sections.lensPanel.saveNameFailed': 'Could not save name. Try again.',
  'sections.lensPanel.saveNameForCompanion': 'Save a lens name first to create a companion section.',
  'sections.moveRestated.titleGeo': 'Move contact, litho and stratigraphy?',
  'sections.moveRestated.titleLitho': 'Move contact and litho?',
  'sections.moveRestated.body': 'This boundary is a lithological contact, not a packing boundary. Moving it to {depth} m changes more than the geotechnical model.',
  'sections.moveRestated.bullet1': 'the two packing bands either side: both re-derive their NAD class, because their depth range changed and so does the qc over it',
  'sections.moveRestated.bullet2': 'the lithological contact it restates',
  'sections.moveRestated.bullet3': 'the stratigraphic contact this unit is derived from: all three in one write, so they cannot disagree afterwards',
  'sections.moveRestated.undoNote': 'One step on the undo stack. Ctrl+Z puts all of it back.',
  'sections.moveRestated.moveIt': 'Move it',
  'sections.flaggedTies.titleOne': '{count} correlation no longer matches',
  'sections.flaggedTies.titleMany': '{count} correlations no longer match',
  'sections.flaggedTies.body1One': 'The packing class changed on one side of this tie, so the two ends no longer describe the same ground.',
  'sections.flaggedTies.body1Many': 'The packing class changed on one side of these ties, so the two ends no longer describe the same ground.',
  'sections.flaggedTies.body2One': 'It is kept and marked for review. Nothing has been lost. Delete it only if the correlation itself was wrong; keep it if the two columns still belong together and the class needs another look.',
  'sections.flaggedTies.body2Many': 'They are kept and marked for review. Nothing has been lost. Delete them only if the correlation itself was wrong; keep them if the two columns still belong together and the class needs another look.',
  'sections.flaggedTies.body3': 'Deleting is one step on the undo stack. While a mismatched tie waits for review it no longer joins its two bands into one body, so the 3-D model will not weld them together either way.',
  'sections.flaggedTies.deleteOne': 'Delete it',
  'sections.flaggedTies.deleteMany': 'Delete them',
  'sections.sampleLabel': 'Sample {n}',
  'sections.sampleGeotech.ariaClickable': 'Sample {label}. Click to highlight body',
  'sections.sampleGeotech.tooltip': 'Sample {label}\\n{top}–{base} m{tail}',
  'sections.psd.organic': 'organic {quantity} {pct} %',
  'sections.header.lengthBuffer': '{length} m · buffer ±{buffer} m',
  'sections.header.companionTitleActive': 'This section was auto-created as a perpendicular companion for a litho lens',
  'sections.header.companionTitleDeleted': 'This section was a lens companion (the lens has since been deleted)',
  'sections.header.companionOf': 'perp · Companion of {name}',
  'sections.header.lensCompanion': 'perp · Lens companion section',
  'sections.header.bufferHint': 'Lateral distance from the section line within which investigations are projected onto it',
  'sections.header.buffer': 'Buffer',
  'sections.header.channels': 'Channels',
  'sections.header.toggle': 'Toggle {label}',
  'sections.header.bore': 'Bore',
  'sections.header.snapHint': 'When on, click-to-place on a borehole snaps the contact depth to the nearest formal / informal stratigraphy boundary (within 8 px)',
  'sections.header.snap': 'Snap',
  'sections.header.spacing': 'Spacing',
  'sections.header.scaleH': 'H: {scale} px/m',
  'sections.header.scaleV': 'V: {scale} px/m',
  'sections.inspector.lengthEpsg': '{length} m · EPSG:{epsg}',
  'sections.focusLabel': 'Focus: {name}',
  'sections.emptyContacts.hintSeed': 'Click \'Seed\' in the toolbar to populate from the active model, or draw contacts manually.',
  'sections.emptyContacts.hintDefine': 'Define formations in the Stratigraphy stage first, then return here to seed or draw contacts manually.',
  'sections.hiddenFooter.count': '{n} hidden from this section',
  'sections.hiddenFooter.restoreAll': 'restore all',
  'sections.scrub.showing': 'Showing {shown} m of {total} m (data range)',
  'sections.staleColumn.title': '{name}: packing derived from an older lithology on this test. Press Subdivide (Onderverdelen) to re-derive it.',
  'sections.vb.depthHint': 'Show layers down to N metres below each investigation\'s surface. Empty = full DOV column.',
  'sections.vb.showOnSection': 'Show on section',
  'sections.vb.modelSlot': 'Model {label}',
  'sections.vb.noOverlay': 'No overlay in this slot',
  'sections.ghost.copyChip': 'Copy {litho}',
  'sections.geotech.qcLabel': 'qc: {statistic}',
  // The four representative-qc statistics as the user reads them (owner
  // 2026-09-13: "token of course needs translation in dutch version"). The
  // wire token stays English; only the display is translated.
  'sections.geotech.statisticName.median': 'median',
  'sections.geotech.statisticName.arithmetic': 'arithmetic',
  'sections.geotech.statisticName.harmonic': 'harmonic',
  'sections.geotech.statisticName.geometric': 'geometric',
  'sections.bands.dragMoveHint': 'Drag to move this packing boundary · right-click to merge the bands',
  'sections.bands.dragMoveHintAbsorbAll':
    'Drag to move this packing boundary · Ctrl+drag to absorb every band you pass · right-click to merge the bands',
  'sections.bands.rightClickMerge': 'Right-click to merge these two packing bands',
  'sections.bands.placeReadout': '{depth} m. Click to place, Esc to cancel',
  'sections.bands.mergeReadout': 'release to merge into the band {dir}: class re-derived over the union',
  'sections.bands.dirBelow': 'below',
  'sections.bands.dirAbove': 'above',
  'sections.bands.moveReadout': '{depth} m. Release to move, Esc to cancel',
  'sections.bands.absorbRunReadout':
    'release to absorb {n} {word} into the band {dir}: classes re-derived, Esc to cancel',
  'sections.bands.currentSuffix': ' (current)',
  // The "(current: X)" tag on the "Packing class ▸" submenu row (owner #35).
  'sections.bands.packingClassCurrent': '(current: {label})',
  'sections.bands.toast.splitHere': 'Band split.',
  'sections.bands.foreignClassSuffix': ' (current, a {family} class on this soil)',
  'sections.bandDialog.moveTitle': 'Move this packing boundary?',
  'sections.bandDialog.absorbTitle': 'Absorb the packing bands you passed?',
  'sections.bandDialog.mergeTitle': 'Merge these packing bands?',
  'sections.bandDialog.splitTitle': 'Split this packing band?',
  'sections.bandDialog.rederiveBlurb': 'The packing class is re-derived from the cone resistance over each resulting interval, inside the litho body at {range}. Only this column re-derives.',
  'sections.bandDialog.unchanged': '(unchanged)',
  'sections.bandDialog.representativeQc': 'Representative qc{statistic} {value} MPa',
  'sections.bandDialog.sameClass': 'The cone resistance gives the same packing class either way. This edit changes the boundary, not the classification.',
  'sections.bandDialog.needsReview': 'needs review',
  'sections.bandDialog.classLabel': 'class {n}',
  'sections.bandDialog.verbMove': 'Move boundary',
  'sections.bandDialog.verbAbsorb': 'Absorb bands',
  'sections.bandDialog.verbMerge': 'Merge bands',
  'sections.bandDialog.verbSplit': 'Split band',
  'sections.toast.loadFailed': 'Failed to load cross-sections.',
  'sections.toast.noCrs': 'No coordinate system found. Import investigations or set a Default horizontal CRS in Project metadata first.',
  'sections.toast.sameEndpoints': 'The two endpoints landed at the same point. Try again.',
  'sections.toast.createFailed': 'Could not create the cross-section.',
  'sections.toast.deleteFailed': 'Could not delete the cross-section.',
  'sections.toast.saveFailed': 'Could not save the section change.',
  'sections.toast.contactNotFound': 'Couldn\'t find the contact in the current project.',
  'sections.toast.noCleanTies': 'No clean tie-sections found. Try widening the tolerance in Settings.',
  'sections.toast.tieCreateFailed': 'Could not create the tie-section.',
  'sections.toast.tiesCreateFailed': 'Could not create the tie-sections.',
  'sections.toast.contactDepthUpdateFailed': 'Could not update the contact depth.',
  'sections.toast.contactMoveFailed': 'Could not move the existing contact to the new depth.',
  'sections.toast.contactPlaceFailed': 'Could not place the formation contact.',
  'sections.toast.copiedSomeFailed': 'Copied {total} contact(s); {failed} failed. Some may be missing.',
  'sections.toast.contactsUpdateFailed': 'Could not update the selected contacts.',
  'sections.toast.contactDeleteFailed': 'Could not delete the contact.',
  'sections.toast.unlinkFailed': 'Could not unlink the contact from stratigraphy.',
  'sections.toast.noGeoInTolerance': 'No stratigraphic contact within snap tolerance to link.',
  'sections.toast.linkFailed': 'Could not link the contact to stratigraphy.',
  'sections.toast.correlationAdded': 'Correlation added. A wedge forms when it spans the layer.',
  'sections.toast.correlationCreateFailed': 'Could not create the correlation. Try again.',
  'sections.toast.edgeRetargeted': 'Edge retargeted.',
  'sections.toast.edgeRetargetFailed': 'Could not retarget the edge. Try again.',
  'sections.scope.allSections': 'on all sections',
  'sections.scope.thisSection': 'on this section',
  'sections.geotechCorr.nothingNew': 'Auto-correlate {scope}: nothing new. All {n} automatic tie(s) are already correlated.',
  'sections.geotechCorr.noTies': 'Auto-correlate {scope}: no automatic packing ties found. Subdivide the bodies first.',
  'sections.geotechCorr.result': 'Auto-correlate {scope}: {accepted} {accWord} banded, {proposed} new {propWord} proposed, {skipped} left untouched{tail}',
  'sections.geotechCorr.accWordOne': 'litho-backed tie',
  'sections.geotechCorr.accWordMany': 'litho-backed ties',
  'sections.geotechCorr.propWordOne': 'packing tie',
  'sections.geotechCorr.propWordMany': 'packing ties',
  'sections.geotechCorr.resultTailReview': '. Review the ghosts, then "3 · Accept ties".',
  'sections.geotechCorr.autoFailed': 'Auto-correlate packing failed. See console.',
  'sections.geotechCorr.acceptFailed': 'Accept packing correlations failed. See console.',
  'sections.geotechCorr.noPending': 'No pending packing correlations to accept {scope}.',
  'sections.geotechCorr.accepted': 'Accepted {n} {word} {scope}.',
  'sections.geotechCorr.packingCorrOne': 'packing correlation',
  'sections.geotechCorr.packingCorrMany': 'packing correlations',
  'sections.bandEdit.splitPlanFailed': 'Could not work out what that split would do. Try again.',
  'sections.bandEdit.mergePlanFailed': 'Could not work out what that merge would do. Try again.',
  'sections.bandEdit.movePlanFailed': 'Could not work out what that move would do. Try again.',
  'sections.bandEdit.absorbPlanFailed': 'Could not work out what that absorb would do. Try again.',
  'sections.bandEdit.absorbRunPlanFailed':
    'Could not work out what absorbing those bands would do. Try again.',
  'sections.bandEdit.classSet': 'Class set to NAD {nadClass}.',
  'sections.bandEdit.classSetFlagged': 'Class set to NAD {nadClass}; {flagged} {word} flagged for review.',
  'sections.bandEdit.acceptedTieOne': 'accepted tie',
  'sections.bandEdit.acceptedTieMany': 'accepted ties',
  'sections.bandEdit.setClassFailed': 'Could not set the class. Try again.',
  'sections.bandEdit.cleared': 'Cleared {n} {word} on {name}. Press 1 (CPT) or 4 (borehole) to rebuild it.',
  'sections.bandEdit.bandWordOne': 'band',
  'sections.bandEdit.bandWordMany': 'bands',
  'sections.bandEdit.clearFailed': 'Could not clear the subdivision. Try again.',
  'sections.bandEdit.savedNotRefreshed': 'The edit was saved, but the correlations on screen could not be refreshed. Reopen the section before judging the ties.',
  'sections.bandEdit.applyFailed': 'Could not apply the edit. Try again.',
  'sections.packingCorr.added': 'Packing correlation added.',
  'sections.packingCorr.disconnectFailed': 'Could not disconnect the bands. The tie is still there. Try again.',
  'sections.packingCorr.acceptFailed': 'Could not accept the packing correlation. Try again or refresh.',
  'sections.packingCorr.confirmFailed': 'Could not confirm the tie. Try again or refresh.',
  'sections.stat.setBuild': 'Representative statistic set to {statistic}. Press "1 · Subdivide CPTs" to build the packing bands under it.',
  'sections.stat.setReclassify': 'Representative statistic set to {statistic}. Press "1 · Subdivide CPTs" to re-classify the bands under it.',
  'sections.stat.set': 'Representative statistic set to {statistic}.',
  'sections.lithoCorr.precheckFailed': 'Auto-correlate pre-check failed. See console.',
  'sections.lithoCorr.cleared': 'Cleared {n} {word}; re-running…',
  'sections.lithoCorr.autoEdgeOne': 'auto edge',
  'sections.lithoCorr.autoEdgeMany': 'auto edges',
  'sections.lithoCorr.reCorrelateFailed': 'Re-correlate failed. See console.',
  'sections.lithoCorr.accepted': 'Accepted {n} {word}.',
  'sections.lithoCorr.correlationOne': 'correlation',
  'sections.lithoCorr.correlationMany': 'correlations',
  'sections.lithoCorr.acceptFailed': 'Accept failed. Try again.',
  'sections.snap.failed': 'Snap failed: {message}',
  'sections.snap.moved': 'Stratigraphic contact moved; surfaces rebuilt.',
  'sections.snap.moveFailed': 'Move failed: {message}',
  'sections.canvas.newSectionTitle': 'Create a new cross-section with placeholder endpoints',
  'sections.canvasToast.admixturesUpdated': 'Updated admixtures on {n} {word}.',
  'sections.canvasToast.correlatedUnitOne': 'correlated unit',
  'sections.canvasToast.correlatedUnitMany': 'correlated units',
  'sections.canvasToast.admixturesFailed': 'Could not update the body’s admixtures. Try again.',
  'sections.canvasToast.lensShapeFailed': 'Could not save lens shape. See console.',
  'sections.canvasToast.boundaryCorrAdded': 'Boundary correlation added.',
  'sections.canvasToast.boundaryCorrFailed': 'Could not create the boundary correlation. Try again.',
  'sections.canvasToast.acceptCorrFailed': 'Could not accept the correlation. Try again or refresh.',
  'sections.canvasToast.bodyNamed': 'Body named: {name}',
  'sections.canvasToast.bodyNameFailed': 'Failed to name body.',
  'sections.canvasToast.dissolveConfirm': 'Dissolve this body? This removes the body and its extent data.',
  'sections.canvasToast.bodyDissolved': 'Body dissolved.',
  'sections.canvasToast.bodyDissolveFailed': 'Failed to dissolve body.',
  // Accepted-layer edit / split (installer #21).
  // Names the soil it saved (owner 2026-09-10: a stray key had turned a sand
  // piece into gravel and the old "updated." said nothing about it).
  'sections.canvasToast.compositionUpdated': 'Layer composition updated: {composition}.',
  'sections.canvasToast.compositionUpdateFailed': 'Could not update the layer’s composition. Try again.',
  'sections.canvasToast.layerSplit': 'Layer split.',
  'sections.canvasToast.layerSplitFailed': 'Could not split the layer. The split point may be too close to a boundary.',
  // Shift-drag an accepted litho contact onto another test (installer #35).
  'sections.canvasToast.lithoContactCopied': 'Litho contact copied: both units created.',
  'sections.canvasToast.lithoBoundaryCopied': 'Boundary copied, compositions kept.',
  // Multi-boundary Shift-drag (installer #40): both counts reported.
  'sections.canvasToast.lithoContactsCopiedOneUnit': 'Copied {boundaries} boundaries and 1 unit.',
  'sections.canvasToast.lithoContactsCopiedManyUnits': 'Copied {boundaries} boundaries and {units} units.',
  'sections.canvasToast.lithoContactCopyBelowTerminal': 'The boundary sits below this test’s depth and was not copied.',
  // Shift-drag onto a SHALLOW test (a CPTM): the units that fit land, the deeper
  // boundaries are clipped off (owner 2026-09-16). Appended to the success toast.
  'sections.canvasToast.lithoContactCopyClippedOne': '1 boundary lies below this test’s depth and was left out.',
  'sections.canvasToast.lithoContactCopyClippedMany': '{dropped} boundaries lie below this test’s depth and were left out.',
  'sections.canvasToast.lithoContactCopyFailed': 'Could not copy the litho contact. Try again.',
  // Shift-drag a GHOST boundary onto another test (installer #42): the target
  // gets a ghost column carrying the same units, still to accept.
  'sections.canvasToast.ghostColumnCopiedOne': 'Suggestion copied: 1 unit.',
  'sections.canvasToast.ghostColumnCopiedMany': 'Suggestions copied: {units} units.',
  'sections.canvasToast.ghostCopyTargetHasAccepted': 'This test already has accepted layers. A copy would draw over them.',
  'sections.canvasToast.ghostCopyTargetHasGhost': 'That test already has suggestions. Clear them first, then copy.',
  'sections.canvasToast.ghostCopyMixedSelection': 'That column mixes accepted and suggested boundaries. Copy one kind at a time.',
  'sections.canvasToast.ghostCopyNoPending': 'There are no pending suggestions on that test to copy.',
  'sections.canvasToast.noLithoContact': 'This boundary has no lithological contact to move. Edit it on the litho axis.',
  'sections.canvasToast.packingNotLithoCpt': 'That is a packing boundary, not a lithological contact. Drag it with the handle beside the column.',
  'sections.canvasToast.packingNotLithoBorehole': 'That is a packing boundary, not a lithological contact. A borehole’s packing bands were extrapolated from the CPTs around it, so they cannot be moved here.',
  'sections.canvasToast.perpCreated': 'Perpendicular section created.',
} as const
